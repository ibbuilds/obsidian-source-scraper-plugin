import {Modal,Setting,type App} from "obsidian";
import {dialog,action,formStatus,labelFields,externalLink} from "./form-ui.ts";
import {categoryReferences,type QualityReview,type CurationPolicy} from "./curation-policy.ts";
import type {ReferenceBaseline} from "./reference-quality.ts";
type Context={policy:CurationPolicy;profileHash:string;baseline:ReferenceBaseline};
interface Host{load:()=>Promise<{context:Context;records:any[]}>;save:(items:Array<{key:string;review:QualityReview}>)=>Promise<unknown>;done:()=>void;error:(e:unknown)=>string}
/** Explicit per-resource evidence, batched saves; no bulk inference or external side effects. */
export class QualityReviewModal extends Modal{
 private active=false;private busy=false;private page=0;private drafts=new Map<string,QualityReview>();private chosen=new Set<string>();private expanded=new Set<string>();private context?:Context;private records:any[]=[];private message="";
 constructor(app:App,private host:Host){super(app);}
 onOpen(){this.active=true;const {body,footer}=dialog(this,"Review source quality",true);body.createEl("p",{text:"Loading selected resources and category criteria…"});action(footer,"Close",()=>this.close());void this.host.load().then(data=>{if(!this.active)return;this.context=data.context;this.records=data.records;this.render();},e=>{if(!this.active)return;body.empty();body.createEl("p",{text:this.host.error(e)});action(footer,"Retry",()=>this.onOpen());});}
 onClose(){this.active=false;this.contentEl.empty();this.host.done();}
 private draft(r:any):QualityReview{
  let draft=this.drafts.get(r.key);if(draft)return draft;
  const context=this.context!,old=r.resourceQuality;
  draft=old?structuredClone(old):{version:1,fingerprint:r.fingerprint,profileHash:context.profileHash,baselineHash:context.baseline.hash,category:context.policy.categories[0].id,decision:"pending",reason:"",relevance:"",access:{mode:"unknown",scope:"",evidence:[]},criteria:[],comparisons:[]};
  // Server fields are not submitted as evidence. Refresh hashes only on an explicit save.
  const {version,category,decision,reason,relevance,access,criteria,comparisons}=draft!;
  draft={version,category,decision,reason,relevance,access,criteria,comparisons,fingerprint:r.fingerprint,profileHash:context.profileHash,baselineHash:context.baseline.hash};
  if(!context.policy.categories.some(c=>c.id===draft!.category)){draft.category=context.policy.categories[0].id;draft.criteria=[];draft.comparisons=[];}
  this.drafts.set(r.key,draft);return draft;
 }
 private render(){
  if(!this.active||!this.context)return;
  const {body,footer}=dialog(this,"Review source quality",true);body.addClass("ss-quality-review");
  body.createEl("p",{text:"Review design or frontend resources against their category. Qualified requires a useful free core without trials or viewing limits. Keep/Hide and likes are separate."});
  const pageSize=8,count=Math.ceil(this.records.length/pageSize),list=body.createDiv({cls:"ss-quality-list"});
  for(const r of this.records.slice(this.page*pageSize,(this.page+1)*pageSize)){
   if(!r.entity?.url){list.createEl("p",{text:r.key+": Resource unavailable"});continue;}
   const draft=this.draft(r),card=list.createEl("details",{cls:"ss-quality-card"});card.dataset.key=r.key;
   const summary=card.createEl("summary",{text:r.entity.title});card.open=this.records.length===1||this.expanded.has(r.key);card.addEventListener("toggle",()=>{if(card.open)this.expanded.add(r.key);else this.expanded.delete(r.key);});
   externalLink(card,"Open resource",r.entity.url);
   if(r.resourceQuality?.stale)card.createEl("p",{text:"Previous evidence is stale. Verify it again before qualifying."});
   const updateSummary=()=>{summary.textContent=r.entity.title+(this.chosen.has(r.key)?" · "+draft.decision:"");save.setDisabled(this.busy||!this.chosen.size);status.setText(this.chosen.size+" reviews selected");status.hidden=false;};
   new Setting(card).setName("Category").addDropdown(d=>{for(const c of this.context!.policy.categories)d.addOption(c.id,c.label);d.setValue(draft.category).onChange(v=>{draft.category=v;draft.criteria=[];draft.comparisons=[];this.render();});});
   new Setting(card).setName("Decision").setDesc("Choose for this resource only. Nothing is selected by default.").addDropdown(d=>d.addOptions({unchanged:"Keep current",pending:"Needs evidence",qualified:"Qualified",excluded:"Does not meet criteria"}).setValue(this.chosen.has(r.key)?draft.decision:"unchanged").onChange(v=>{if(v==="unchanged")this.chosen.delete(r.key);else{draft.decision=v as QualityReview["decision"];this.chosen.add(r.key);}updateSummary();}));
   text(card,"Reason","Explain your decision (at least 20 characters).",draft.reason,v=>draft.reason=v);
   text(card,"Relevant use","What design or frontend task does the free core help with?",draft.relevance,v=>draft.relevance=v);
   const evidence=card.createEl("details");evidence.createEl("summary",{text:"Free access and category evidence"});if(draft.decision==="qualified")evidence.open=true;
   new Setting(evidence).setName("Core access").setDesc("Optional paid MCP/API or add-ons are allowed; trial, credits or metered core access are not.").addDropdown(d=>d.addOptions({"unknown":"Not verified","unmetered-free":"Free ongoing core use","metered":"Metered or limited views","trial":"Trial or credits","paid":"Paid core"}).setValue(draft.access.mode).onChange(v=>draft.access.mode=v as QualityReview["access"]["mode"]));
   text(evidence,"Free scope","Describe the useful function available continuously, and any paid restrictions.",draft.access.scope,v=>draft.access.scope=v);
   const access=draft.access.evidence[0]??{url:r.entity.url,quote:""};draft.access.evidence=[access];
   text(evidence,"Access evidence URL","A resource, pricing, license or documentation page.",access.url,v=>access.url=v,false);
   text(evidence,"Access evidence","Quote or describe the observed evidence for the free scope.",access.quote,v=>access.quote=v);
   const category=this.context.policy.categories.find(c=>c.id===draft.category)!,references=categoryReferences(category,this.context.baseline);
   const examples=evidence.createEl("details");examples.createEl("summary",{text:"Category reference examples"});for(const ref of references)externalLink(examples,ref.label,ref.url);
   for(const c of category.criteria){
    let entry=draft.criteria.find(x=>x.id===c.id);if(!entry){entry={id:c.id,verdict:"unknown",note:"",evidence:[]};draft.criteria.push(entry);}const item=entry;
    new Setting(evidence).setName(c.label).addDropdown(d=>d.addOptions({unknown:"Not verified",meets:"Meets standard",below:"Below standard"}).setValue(item.verdict).onChange(v=>item.verdict=v as typeof item.verdict));
    const proof=item.evidence[0]??{url:r.entity.url,quote:""};item.evidence=[proof];
    text(evidence,"Evidence URL",c.label,proof.url,v=>proof.url=v,false);
    text(evidence,"Observed evidence","Specific quote or observed behavior, and why it meets the criterion.",item.note,v=>{item.note=v;proof.quote=v;});
   }
   evidence.createEl("p",{text:"Compare two distinct examples with two references from the same category. For tools, compare API, integration and reliability; for research, compare evidence and usefulness."});
   if(references.length<2)evidence.createEl("p",{text:"Add at least two references in this category's configured reference sections before qualifying."});
   for(let i=0;i<2;i++){
    const comparison=draft.comparisons[i]??{referenceUrl:"",sampleUrl:"",note:""};draft.comparisons[i]=comparison;
    new Setting(evidence).setName("Reference "+(i+1)).addDropdown(d=>{d.addOption("","Choose a category reference");for(const ref of references)d.addOption(ref.url,ref.label+" — "+ref.section);d.setValue(comparison.referenceUrl).onChange(v=>comparison.referenceUrl=v);});
    if(comparison.referenceUrl)externalLink(evidence,"Open reference "+(i+1),comparison.referenceUrl);
    text(evidence,"Resource sample "+(i+1),"A distinct example or documentation page within this resource.",comparison.sampleUrl,v=>comparison.sampleUrl=v,false);
    text(evidence,"Comparison "+(i+1),"Specific category comparison (at least 40 characters).",comparison.note,v=>comparison.note=v);
   }
   updateSummarySafe(summary,r.entity.title,this.chosen.has(r.key)?draft.decision:undefined);
  }
  if(count>1){const paging=body.createDiv({cls:"ss-pagination"});action(paging,"Previous resources",()=>{this.page--;this.render();}).setDisabled(this.page===0||this.busy);paging.createSpan({text:(this.page*pageSize+1)+"–"+Math.min((this.page+1)*pageSize,this.records.length)+" of "+this.records.length});action(paging,"Next resources",()=>{this.page++;this.render();}).setDisabled(this.page+1>=count||this.busy);}
  const status=formStatus(footer);status.addClass("ss-quality-summary");status.toggleClass("ss-quality-error",Boolean(this.message&&!this.busy));status.setText(this.message||(this.chosen.size?this.chosen.size+" reviews selected":""));status.hidden=!status.textContent;
  action(footer,"Close",()=>this.close()).setDisabled(this.busy);
  const save=action(footer,"Save reviews",()=>{if(this.busy||!this.chosen.size)return;this.busy=true;this.message="Saving reviews…";this.render();
   const items=[...this.chosen].map(key=>{const review=structuredClone(this.drafts.get(key)!);if(review.decision!=="qualified"){review.access.evidence=review.access.evidence.filter(e=>e.quote.trim());review.criteria=review.criteria.filter(c=>c.note.trim()).map(c=>({...c,evidence:c.evidence.filter(e=>e.quote.trim())}));review.comparisons=review.comparisons.filter(c=>c.referenceUrl&&c.sampleUrl&&c.note.trim());}return {key,review};});
   void this.host.save(items).then(()=>{if(this.active)this.close();},e=>{this.busy=false;this.message=this.host.error(e);if(this.active)this.render();});
  },true);save.setDisabled(this.busy||!this.chosen.size);
  for(const input of Array.from(body.querySelectorAll<HTMLInputElement>("input,select,textarea")))input.disabled=this.busy;
  labelFields(body);
 }
}
function text(root:HTMLElement,name:string,help:string,value:string,change:(v:string)=>void,multiline=true){const row=new Setting(root).setName(name).setDesc(help);if(multiline)row.addTextArea(t=>t.setValue(value).onChange(change));else row.addText(t=>t.setValue(value).onChange(change));}
function updateSummarySafe(root:HTMLElement,title:string,state?:string){root.textContent=title+(state?" · "+state:"");}
