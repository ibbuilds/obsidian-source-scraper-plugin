import {ButtonComponent,SearchComponent} from "obsidian";
import type {EntityRecord} from "./contracts.ts";
interface InboxHost {
 projectId:()=>string;
 query:(args:Record<string,unknown>)=>Promise<any>;
 review:(args:Record<string,unknown>)=>Promise<any>;
 detail:(entity:EntityRecord)=>void;
 drafts:(records:EntityRecord[])=>void;
 error:(error:unknown)=>string;
}
/** Query-sized rendering and snapshot-sized actions. No selection/dialog tour is required. */
export class ResourceInbox {
 private root?:HTMLElement;
 private search="";
 private review="pending";
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
 private recovery:Array<{projectId:string;requestId:string}>=[];
 private rows:EntityRecord[]=[];
 private total=0;
 constructor(private host:InboxHost){}
 mount(root:HTMLElement){
  this.unmount();this.root=root;this.disposed=false;this.selectionId=undefined;this.offset=0;root.empty();root.addClass("source-scraper-view","ss-inbox");
  const summary=root.createDiv({cls:"ss-inbox-summary"});const count=summary.createSpan({cls:"ss-count",text:"Loading resources…"});
  const bar=root.createDiv({cls:"ss-inbox-filters"});const search=new SearchComponent(bar).setPlaceholder("Filter resources").setValue(this.search);search.inputEl.setAttribute("aria-label","Filter resources");
  const filter=bar.createEl("select",{attr:{"aria-label":"Review status"}});for(const [value,label] of [["pending","Needs review"],["all","All resources"],["approved","Approved"],["rejected","Rejected"]])filter.createEl("option",{value,text:label});filter.value=this.review;
  const scope=root.createDiv({cls:"ss-inbox-scope"});const scopeText=scope.createSpan();const clear=button(scope,"Clear selection",()=>{this.selected.clear();renderRows();update();});
  const list=root.createDiv({cls:"ss-candidate-list",attr:{tabindex:"0","aria-label":"Resource inbox"}});
  const pagination=root.createDiv({cls:"ss-pagination"});
  const status=root.createDiv({cls:"ss-inbox-status",attr:{role:"status","aria-live":"polite"}});
  const footer=root.createDiv({cls:"ss-inbox-footer"});
  const actions=footer.createDiv({cls:"ss-inbox-actions"});const approve=button(actions,"Approve matches",()=>{void apply(this.review==="approved"?"pending":"approved");},true),reject=button(actions,"Reject matches",()=>{void apply("rejected");});
  const utility=footer.createDiv({cls:"ss-inbox-utility"});
  const copy=button(utility,"Copy page links",()=>{void navigator.clipboard.writeText([...this.selected.size?this.selected.values():this.rows].map(e=>e.url).filter(Boolean).join("\n")).then(()=>{status.textContent="Links copied.";},e=>{status.textContent=this.host.error(e);});});
  const drafts=button(utility,"Preview drafts",()=>{const records=this.selected.size?[...this.selected.values()]:this.rows;this.host.drafts(records);});
  const retry=button(utility,"Retry operation",()=>{void reconcile();});
  const update=()=>{
   const n=this.selected.size||this.total,selected=this.selected.size>0;
   count.textContent=this.total+(this.total===1?" resource":" resources");scopeText.textContent=selected?`${n} selected across pages`:`Actions apply to all ${this.total} matching resources`;clear.hidden=!selected;
   approve.textContent=this.review==="approved"?`Mark pending ${n}`:`Approve ${n}`;reject.textContent=this.review==="rejected"?`Restore ${n}`:`Reject ${n}`;
   approve.disabled=reject.disabled=this.loading||this.dirty||this.busy||this.recovery.length>0||!n||n>5000;approve.hidden=this.review==="rejected";
   copy.disabled=this.busy||this.dirty||!this.rows.length;copy.textContent=selected?`Copy ${n} links`:"Copy page links";drafts.disabled=this.busy||this.dirty||!(selected?n:this.rows.length)||(selected?n:this.rows.length)>200;
   retry.hidden=!this.recovery.length;retry.disabled=this.busy||this.loading;
   filter.disabled=search.inputEl.disabled=this.busy;root.setAttribute("aria-busy",String(this.loading||this.busy));
   if(n>5000)status.textContent="More than 5,000 matches. Narrow the filter or select the resources to review.";
  };
  const renderRows=()=>{
   list.empty();pagination.empty();
   if(!this.rows.length){const empty=list.createDiv({cls:"ss-empty-results"});empty.createEl("strong",{text:this.search?"No matches":"Nothing to review"});empty.createEl("p",{text:this.search?"Try a different filter.":"Collect resources or choose another review status."});}
   for(const e of this.rows){
    const row=list.createEl("article",{cls:"ss-record"}),head=row.createDiv({cls:"ss-record-head"});
    const box=head.createEl("input",{type:"checkbox",cls:"ss-select-control",attr:{"aria-label":"Select "+e.title}});box.checked=this.selected.has(e.key);box.disabled=this.busy;box.onchange=()=>{if(box.checked)this.selected.set(e.key,e);else this.selected.delete(e.key);update();};
    const title=button(head,e.title,()=>this.host.detail(e));title.classList.add("ss-record-title");title.setAttribute("aria-label","View details: "+e.title);
    const source=row.createDiv({cls:"ss-record-source"});if(e.url)source.createEl("a",{href:e.url,text:new URL(e.url).hostname.replace(/^www\./,""),attr:{target:"_blank",rel:"noopener noreferrer"}});
    if(e.resourceAssessment&&e.resourceAssessment.decision!=="pending")row.createEl("span",{cls:"ss-review-decision",text:e.resourceAssessment.decision==="recommended"?"AI recommended":"AI discarded"});
    if(typeof e.attributes.description==="string")row.createEl("p",{cls:"ss-record-description",text:e.attributes.description});
   }
   const previous=button(pagination,"Previous",()=>{this.offset=Math.max(0,this.offset-40);request(false);});previous.disabled=this.offset===0||this.busy;
   pagination.createSpan({text:this.total?`${this.offset+1}–${Math.min(this.offset+40,this.total)} of ${this.total}`:"0 resources"});
   const next=button(pagination,"Next",()=>{this.offset+=40;request(false);});next.disabled=this.offset+40>=this.total||this.busy;pagination.hidden=this.total<=40;
  };
  const request=(reset=true)=>{this.dirty=true;if(reset){this.offset=0;this.selectionId=undefined;this.selected.clear();}this.generation++;if(this.loading){this.queued=true;return;}void load();};
  const load=async()=>{
   if(this.disposed)return;this.loading=true;const generation=this.generation;update();
   try{const result=await this.host.query({projectId:this.host.projectId(),review:this.review,search:this.search,selectionId:this.selectionId,offset:this.offset,limit:40});
    if(this.disposed||generation!==this.generation)return;this.selectionId=result.selectionId;this.total=result.total;this.rows=result.records;this.recovery=result.recovery??[];this.dirty=false;status.textContent=this.recovery.length?"An earlier review needs reconciliation. Retry it before saving more decisions.":this.lastMessage;renderRows();
   }catch(e){if(!this.disposed&&generation===this.generation)status.textContent=this.host.error(e);}
   finally{this.loading=false;if(!this.disposed){update();if(this.queued){this.queued=false;void load();}}}
  };
  const apply=async(decision:"approved"|"rejected"|"pending")=>{
   if(this.busy||this.loading||this.dirty||this.recovery.length||!this.selectionId)return;
   const actual=this.review==="rejected"?"pending":decision;
   this.busy=true;status.textContent="Saving the matching resources…";renderRows();update();
   const args={projectId:this.host.projectId(),requestId:crypto.randomUUID(),...(this.selected.size?{changes:[...this.selected.values()].map(e=>({key:e.key,decision:actual,revision:e.revision}))}:{selectionId:this.selectionId,decision:actual})};
   try{const result=await this.host.review(args);if(this.disposed)return;this.selected.clear();this.lastMessage=`${result.saved} saved${result.failed?` · ${result.failed} changed or unavailable; refresh before reviewing them`:""}.`;status.textContent=this.lastMessage;this.selectionId=undefined;this.offset=0;this.generation++;this.queued=true;}
   catch(e){if(!this.disposed){this.lastMessage=this.host.error(e);status.textContent=this.lastMessage;if(/SELECTION_CHANGED|SELECTION_EXPIRED/.test(this.lastMessage)){this.selectionId=undefined;this.selected.clear();this.offset=0;this.generation++;this.queued=true;}}}
   finally{this.busy=false;if(!this.disposed){update();if(this.queued){this.queued=false;void load();}}}
  };
  const reconcile=async()=>{if(this.busy||!this.recovery.length)return;this.busy=true;update();try{for(const pending of this.recovery)await this.host.review(pending);this.lastMessage="Previous review recovered.";}catch(e){this.lastMessage=this.host.error(e);}finally{this.busy=false;this.selectionId=undefined;request();}};
  search.onChange(value=>{this.search=value;this.generation++;this.dirty=true;this.lastMessage="";update();if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>request(),180);});filter.onchange=()=>{this.review=filter.value;request();};
  request();
 }
 unmount(){this.disposed=true;this.generation++;if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.root=undefined;}
}
function button(root:HTMLElement,label:string,run:()=>void,primary=false){const b=new ButtonComponent(root).setButtonText(label).onClick(run);if(primary)b.setCta();b.buttonEl.type="button";return b.buttonEl;}
