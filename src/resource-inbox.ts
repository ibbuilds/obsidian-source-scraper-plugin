import {ButtonComponent,SearchComponent,DropdownComponent,setIcon} from "obsidian";
import type {EntityRecord} from "./contracts.ts";
import {selectedReviewRequest,resourceAccess} from "./resource-actions.ts";
interface InboxHost {
 qualityEnabled?:boolean;
 qualify?:(records:EntityRecord[])=>void;
 projectId:()=>string;
 query:(args:Record<string,unknown>)=>Promise<any>;
 review:(args:Record<string,unknown>)=>Promise<any>;
 detail:(entity:EntityRecord)=>void;
 drafts:(records:EntityRecord[])=>void;
 error:(error:unknown)=>string;
}
export interface ResourceViewState {search:string;review:string;offset:number;selected:EntityRecord[]}
/** Paged browsing with actions limited to concrete user selections. */
export class ResourceInbox {
 private root?:HTMLElement;
 private search="";
 private review="all";
 private offset=0;
 private selectionId?:string;
 private selected=new Map<string,EntityRecord>();
 private generation=0;
 private timer?:ReturnType<typeof setTimeout>;
 private loading=false;
 private queued=false;
 private disposed=true;
 private busy=false;
 private dirty=true;
 private lastMessage="";
 private loadFailed=false;
 private recovery:Array<{projectId:string;requestId:string}>=[];
 private rows:EntityRecord[]=[];
 private total=0;
 constructor(private host:InboxHost,state?:ResourceViewState){if(host.qualityEnabled)this.review="qualified";if(state){this.search=state.search;this.review=state.review;this.offset=state.offset;this.selected=new Map(state.selected.map(e=>[e.key,e]));}}
 viewState():ResourceViewState{return {search:this.search,review:this.review,offset:this.offset,selected:[...this.selected.values()]};}
 mount(root:HTMLElement){
  this.unmount();this.root=root;this.disposed=false;this.selectionId=undefined;root.empty();root.addClass("source-scraper-view","ss-inbox");
  const summary=root.createDiv({cls:"ss-inbox-summary"});const count=summary.createSpan({cls:"ss-count",text:"Loading resources…"});
  const selectLabel=summary.createEl("label",{cls:"ss-select-page"});const pageBox=selectLabel.createEl("input",{type:"checkbox",attr:{"aria-label":"Select visible resources"}});selectLabel.createSpan({text:"Select page"});
  const bar=root.createDiv({cls:"ss-inbox-filters"});const search=new SearchComponent(bar).setPlaceholder("Search resources").setValue(this.search);search.inputEl.setAttribute("aria-label","Search resources");
  const icon=search.inputEl.parentElement!.createSpan({cls:"ss-search-icon",attr:{"aria-hidden":"true"}});setIcon(icon,"search");
  const view=new DropdownComponent(bar);for(const [value,label] of (this.host.qualityEnabled?[["qualified","Qualified"],["quality-pending","To review"],["quality-excluded","Excluded"],["all","Captured"],["approved","Kept"],["rejected","Hidden"]]:[["all","All resources"],["pending","Unreviewed"],["approved","Kept"],["rejected","Hidden"]]))view.addOption(value,label);view.setValue(this.review);const filter=view.selectEl;filter.setAttribute("aria-label","Resource view");
  if(this.host.qualityEnabled){const hint=bar.createEl("p",{cls:"ss-quality-hint",text:"To review narrows by topic. Captured keeps all links. Qualified requires evidence."});hint.setAttribute("role","note");}
  const list=root.createDiv({cls:"ss-candidate-list",attr:{tabindex:"0","aria-label":"Resources"}});list.createDiv({cls:"ss-empty-results",text:"Loading resources…"});
  const pagination=root.createDiv({cls:"ss-pagination"});
  const previous=button(pagination,"Previous",()=>{this.offset=Math.max(0,this.offset-40);request(false);});const range=pagination.createSpan();
  const next=button(pagination,"Next",()=>{this.offset+=40;request(false);});
  const status=root.createDiv({cls:"ss-inbox-status",attr:{role:"status","aria-live":"polite"}});
  const retry=button(status,"Retry operation",()=>{if(this.recovery.length)void reconcile();else request(false);});const message=status.createSpan();
  const footer=root.createDiv({cls:"ss-inbox-footer"});
  const selectionLine=footer.createDiv({cls:"ss-inbox-selection"});const selection=selectionLine.createSpan({attr:{role:"status","aria-live":"polite"}});
  const clear=button(selectionLine,"Clear",()=>{this.selected.clear();syncCheckboxes();update();});clear.setAttribute("aria-label","Clear selection");
  const qualify=this.host.qualityEnabled?button(selectionLine,"Review quality",()=>{if(this.selected.size)this.host.qualify?.([...this.selected.values()]);}):undefined;
  const drafts=button(selectionLine,"Preview drafts",()=>{if(this.selected.size)this.host.drafts([...this.selected.values()]);});
  const actions=footer.createDiv({cls:"ss-inbox-actions"});
  const copy=button(actions,"Copy links",()=>{if(!this.selected.size)return;void navigator.clipboard.writeText([...this.selected.values()].map(e=>e.url).filter(Boolean).join("\n")).then(()=>{this.lastMessage="Links copied";update();},e=>{this.lastMessage=this.host.error(e);update();});},true);
  const keep=button(actions,"Keep",()=>{void apply(this.review==="approved"?"pending":"approved");});const hide=button(actions,"Hide",()=>{void apply(this.review==="rejected"?"pending":"rejected");});hide.title="Hide selected resources and future duplicates. Restore them from Hidden.";
  const syncCheckboxes=()=>{for(const box of Array.from(list.querySelectorAll<HTMLInputElement>(".ss-select-control")))box.checked=this.selected.has(box.dataset.key!);};
  const update=()=>{
   if(this.disposed)return;
   const n=this.selected.size,blocked=this.loading||this.dirty||this.busy||this.recovery.length>0,format=(n:number)=>n.toLocaleString("en-US");
   count.textContent=format(this.total)+(this.review==="qualified"?(this.total===1?" qualified source":" qualified sources"):(this.total===1?" resource":" resources"));selection.textContent=n?`${format(n)} selected`:"Select resources to copy, keep or hide";
   clear.hidden=drafts.hidden=actions.hidden=!n;clear.disabled=this.busy;if(qualify){qualify.hidden=!n;qualify.disabled=blocked||!n||n>50;qualify.title="Review up to 50 selected sources against category criteria";}drafts.disabled=blocked||n>200;drafts.title=n>200?"Select up to 200 resources for Markdown previews":"Preview the selected resources as Markdown";copy.disabled=keep.disabled=hide.disabled=blocked||!n||n>5000;
   keep.hidden=this.review==="rejected";keep.textContent=this.review==="approved"?"Undo keep":"Keep";if(this.review!=="approved"&&n>0&&[...this.selected.values()].every(e=>e.review==="approved")){keep.textContent="Kept";keep.disabled=true;}hide.textContent=this.review==="rejected"?"Restore":"Hide";
   retry.hidden=!this.recovery.length&&!this.loadFailed;retry.textContent=this.recovery.length?"Retry operation":"Retry loading";retry.disabled=this.busy||this.loading;
   filter.disabled=search.inputEl.disabled=this.busy;root.setAttribute("aria-busy",String(this.loading||this.busy));
   const checked=this.rows.filter(e=>this.selected.has(e.key)).length;pageBox.checked=this.rows.length>0&&checked===this.rows.length;pageBox.indeterminate=checked>0&&checked<this.rows.length;pageBox.disabled=blocked||!this.rows.length;
   for(const box of Array.from(list.querySelectorAll<HTMLInputElement>(".ss-select-control")))box.disabled=blocked;
   for(const details of Array.from(list.querySelectorAll<HTMLButtonElement>(".ss-resource-details")))details.disabled=blocked;
   previous.disabled=this.offset===0||this.loading||this.busy;next.disabled=this.offset+40>=this.total||this.loading||this.busy;pagination.hidden=this.total<=40;
   range.textContent=this.total?`${format(this.offset+1)}–${format(Math.min(this.offset+40,this.total))} of ${format(this.total)}`:"0 resources";
   message.textContent=this.recovery.length?"An earlier operation needs recovery before saving new choices":this.lastMessage;
   status.hidden=!message.textContent&&!this.recovery.length;
  };
  const renderRows=()=>{
   list.empty();
   if(!this.rows.length){const empty=list.createDiv({cls:"ss-empty-results"});empty.createEl("strong",{text:this.search?"No matches":this.review==="approved"?"No kept resources":this.review==="rejected"?"No hidden resources":this.review==="qualified"?"No qualified sources yet":"No resources here"});empty.createEl("p",{text:this.search?"Try another search or view.":this.review==="qualified"?"Open To review or Captured, select sources, then Review quality.":"Collect links or choose another view."});}
   for(const e of this.rows){
    const row=list.createEl("article",{cls:"ss-record"}),head=row.createDiv({cls:"ss-resource-heading"});
    const box=head.createEl("input",{type:"checkbox",cls:"ss-select-control",attr:{"aria-label":"Select "+e.title}});box.dataset.key=e.key;box.checked=this.selected.has(e.key);box.disabled=this.busy;box.onchange=()=>{if(box.checked){if(this.selected.size>=5000){box.checked=false;this.lastMessage="Choose up to 5,000 resources per action";}else this.selected.set(e.key,e);}else this.selected.delete(e.key);update();};
    const title=head.createEl("a",{cls:"ss-resource-title",href:e.url??"#",attr:{target:"_blank",rel:"noopener noreferrer","aria-label":"Open resource: "+e.title}});title.createSpan({cls:"ss-resource-title-text",text:e.title});
    const details=iconButton(head,"info","Details: "+e.title,()=>this.host.detail(e));details.classList.add("ss-resource-details");
    if(typeof e.attributes.description==="string")row.createEl("p",{cls:"ss-record-description",text:e.attributes.description});
    const source=row.createDiv({cls:"ss-record-source"});source.createSpan({text:e.url?new URL(e.url).hostname.replace(/^www\./,""):""});
    if(e.resourceQuality)source.createSpan({cls:"ss-resource-state",text:e.resourceQuality.state==="qualified"?"Qualified · "+e.resourceQuality.category:e.resourceQuality.state==="excluded"?"Below criteria":"Needs evidence"});
    if(e.review==="approved")source.createSpan({cls:"ss-resource-state",text:"Kept"});else if(e.review==="rejected")source.createSpan({cls:"ss-resource-state",text:"Hidden"});
    else if(e.resourceAssessment?.decision==="recommended"&&!e.resourceAssessment.stale)source.createSpan({cls:"ss-resource-state",text:"AI recommended"});
    if(e.localResourceCheck?.eligible&&!e.localResourceCheck.stale)source.createSpan({cls:"ss-resource-state",text:"Local checks passed"});
    row.createEl("p",{cls:"ss-resource-access",text:e.resourceQuality?.state==="qualified"?"Verified free core":resourceAccess(e.attributes)});
   }
  };
  pageBox.onchange=()=>{if(pageBox.checked)for(const e of this.rows){if(this.selected.size<5000)this.selected.set(e.key,e);else this.lastMessage="Choose up to 5,000 resources per action";}else for(const e of this.rows)this.selected.delete(e.key);syncCheckboxes();update();};
  const request=(reset=true)=>{this.dirty=true;if(reset){this.offset=0;this.selectionId=undefined;this.selected.clear();syncCheckboxes();}this.generation++;if(this.loading){this.queued=true;return;}void load();};
  const load=async()=>{
   if(this.disposed)return;this.loading=true;const generation=this.generation;update();
   try{const result=await this.host.query({projectId:this.host.projectId(),review:["qualified","quality-pending","quality-excluded"].includes(this.review)?"all":this.review,...(this.host.qualityEnabled?{quality:this.review==="qualified"?"qualified":this.review==="quality-pending"?"pending":this.review==="quality-excluded"?"excluded":"all"}:{}),search:this.search,selectionId:this.selectionId,offset:this.offset,limit:40});
    if(this.disposed||generation!==this.generation)return;if(this.loadFailed)this.lastMessage="";this.loadFailed=false;this.selectionId=result.selectionId;this.total=result.total;if(this.offset>=this.total&&this.offset>0){this.offset=Math.max(0,Math.floor((this.total-1)/40)*40);this.queued=true;return;}this.rows=result.records;this.recovery=result.recovery??[];this.dirty=false;renderRows();
   }catch(e){if(!this.disposed&&generation===this.generation){this.lastMessage=this.host.error(e);this.loadFailed=true;if(this.selectionId&&/SELECTION_CHANGED|SELECTION_EXPIRED/.test(this.lastMessage)){this.selectionId=undefined;this.selected.clear();this.offset=0;this.queued=true;}}}
   finally{this.loading=false;if(!this.disposed){update();if(this.queued){this.queued=false;void load();}}}
  };
  const apply=async(decision:"approved"|"rejected"|"pending")=>{
   if(this.busy||this.loading||this.dirty||this.recovery.length||!this.selected.size)return;
   const actual=decision;
   this.busy=true;this.lastMessage="Saving your choices…";update();
   const args=selectedReviewRequest(this.host.projectId(),crypto.randomUUID(),[...this.selected.values()],actual);
   try{const result=await this.host.review(args);if(this.disposed)return;this.selected.clear();this.lastMessage=`${result.saved} saved${result.failed?` · ${result.failed} changed or unavailable; refresh before reviewing them`:""}.`;this.selectionId=undefined;this.offset=0;this.generation++;this.queued=true;}
   catch(e){if(!this.disposed){this.lastMessage=this.host.error(e);this.recovery=[{projectId:args.projectId,requestId:args.requestId}];this.dirty=true;this.selectionId=undefined;this.generation++;this.queued=true;if(/SELECTION_CHANGED|SELECTION_EXPIRED/.test(this.lastMessage)){this.selected.clear();this.offset=0;}}}
   finally{this.busy=false;if(!this.disposed){update();if(this.queued){this.queued=false;void load();}}}
  };
  const reconcile=async()=>{if(this.busy||!this.recovery.length)return;this.busy=true;update();try{for(const pending of this.recovery)await this.host.review(pending);this.lastMessage="Previous review recovered.";}catch(e){this.lastMessage=this.host.error(e);}finally{this.busy=false;this.selectionId=undefined;request();}};
  search.onChange(value=>{this.search=value;this.generation++;this.dirty=true;this.lastMessage="";update();if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>request(),180);});view.onChange(value=>{this.review=value;request();});
  request(false);
 }
 unmount(){this.disposed=true;this.generation++;if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.root=undefined;}
}
function iconButton(root:HTMLElement,icon:string,label:string,run:()=>void){const b=new ButtonComponent(root).setIcon(icon).setTooltip(label).onClick(run);b.buttonEl.type="button";b.buttonEl.classList.add("clickable-icon");b.buttonEl.setAttribute("aria-label",label);return b.buttonEl;}
function button(root:HTMLElement,label:string,run:()=>void,primary=false){const b=new ButtonComponent(root).setButtonText(label).onClick(run);if(primary)b.setCta();b.buttonEl.type="button";return b.buttonEl;}
