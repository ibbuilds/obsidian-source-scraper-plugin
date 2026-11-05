import {Modal,Setting,Notice,type App} from "obsidian";
import {dialog,action,formStatus,labelFields} from "./form-ui.ts";
import type {EntityRecord} from "./contracts.ts";
import {MAX_REVIEW_SELECTION,type ReviewChange,type ReviewDecision,type ReviewResult} from "./review-batch.ts";
interface BatchHost {
  saveReviewBatch:(changes:ReviewChange[],reason:string,stopped:()=>boolean,progress:(results:ReviewResult[])=>void)=>Promise<ReviewResult[]>;
}
const labels:Record<ReviewDecision,string>={pending:"Pending",approved:"Approved",rejected:"Rejected"};
const errorText=(e:unknown)=>String(e instanceof Error?e.message:e).replace(/https?:\/\/[^\s"'<>()]+/gi,"[redacted-url]").replace(/(?:token|password|secret|cookie|session|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,"[redacted]").slice(0,250);
/** Compare multiple resources and submit mixed or shared decisions without AI. */
export class BatchReviewModal extends Modal {
  private decisions=new Map<string,ReviewDecision>();
  private saved=new Set<string>();
  private failures=new Map<string,string>();
  private page=0;
  private busy=false;
  private stopped=false;
  private mounted=false;
  private reason="";
  constructor(app:App,private host:BatchHost,private records:EntityRecord[]){super(app);}
  onOpen(){
    this.mounted=true;
    const {body,footer}=dialog(this,`Review ${this.records.length} resources`,true);body.addClass("ss-batch-body");
    if(!this.records.length||this.records.length>MAX_REVIEW_SELECTION){body.createEl("p",{text:"Select 1–200 resources first."});action(footer,"Close",()=>this.close());return;}
    body.createEl("p",{text:"Compare the resources and choose what to keep."});
    const controls=body.createDiv({cls:"ss-batch-controls"});
    let refresh=()=>{};
    new Setting(controls).setName("Apply to all selected").addDropdown(d=>d.addOptions({none:"Choose a decision…",approved:"Approve all",rejected:"Reject all",pending:"Mark all pending"}).onChange(v=>{if(v==="none")return;for(const e of this.records)if(!this.saved.has(e.key))this.decisions.set(e.key,v as ReviewDecision);d.setValue("none");refresh();}));
    const reasonDisclosure=controls.createEl("details",{cls:"ss-batch-reason"});reasonDisclosure.createEl("summary",{text:"Add a shared reason (optional)"});
    new Setting(reasonDisclosure).setName("Reason (optional)").addText(t=>t.setPlaceholder("Applies to this batch").onChange(v=>{this.reason=v;}).inputEl.maxLength=1000);
    const status=formStatus(body);status.addClass("ss-batch-status");status.setText("Reviews only · No likes or note writes.");
    const cards=body.createDiv({cls:"ss-batch-grid"});
    const paging=body.createDiv({cls:"ss-pagination ss-batch-pagination"});
    const close=action(footer,"Close",()=>{if(this.busy){this.stopped=true;close.setDisabled(true);status.setText("Stopping after the current review. Saved decisions are kept.");}else this.close();});
    const save=action(footer,"Save reviews",()=>{void submit();},true);
    const update=()=>{const count=[...this.decisions.keys()].filter(k=>!this.saved.has(k)).length;save.setButtonText(count?`Save ${count} ${count===1?"review":"reviews"}`:"Save reviews").setDisabled(this.busy||!count);};
    refresh=()=>{
      cards.empty();paging.empty();const pageSize=8,pageCount=Math.ceil(this.records.length/pageSize);
      for(const e of this.records.slice(this.page*pageSize,(this.page+1)*pageSize)){
        const card=cards.createEl("article",{cls:"ss-batch-card"});card.dataset.key=e.key;
        card.createEl("h3",{text:e.title});
        const links=card.createDiv({cls:"ss-detail-links"});
        if(e.url)links.createEl("a",{text:"Open resource ↗",href:e.url,attr:{target:"_blank",rel:"noopener noreferrer"}});
        const post=e.attributes.discoveryPost;
        if(typeof post==="string"&&/^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+$/.test(post))links.createEl("a",{text:"Source post ↗",href:post,attr:{target:"_blank",rel:"noopener noreferrer"}});
        card.createEl("p",{cls:"ss-batch-description",text:typeof e.attributes.description==="string"?e.attributes.description:"No description provided. Open the resource to check what it offers."});
        const access=typeof e.attributes.access==="string"?e.attributes.access.replace(/_/g," "):"Not verified";
        const license=typeof e.attributes.license==="string"?e.attributes.license:"Not verified";
        card.createEl("p",{cls:"ss-batch-facts",text:`Access: ${access} · License: ${license}`});
        const details=card.createEl("details");details.createEl("summary",{text:"Evidence and match reasons"});
        details.addEventListener("toggle",()=>{if(details.open&&!details.querySelector("pre"))details.createEl("pre",{cls:"ss-preview",text:JSON.stringify({reasons:e.reasons,attributes:e.attributes,provenance:e.provenance??"Not included"},null,2)});});
        if(this.saved.has(e.key))card.createEl("p",{cls:"ss-batch-saved",text:`Saved: ${labels[e.review]}`});
        else{
          new Setting(card).setName("My decision").setDesc(`Current: ${labels[e.review]}`).addDropdown(d=>d.addOptions({unchanged:"Keep current",approved:"Approve",rejected:"Reject",pending:"Pending"}).setValue(this.decisions.get(e.key)??"unchanged").onChange(v=>{if(v==="unchanged")this.decisions.delete(e.key);else this.decisions.set(e.key,v as ReviewDecision);update();}));
          if(this.failures.has(e.key))card.createEl("p",{cls:"ss-form-status",text:this.failures.get(e.key)});
        }
      }
      paging.hidden=pageCount===1;
      const prev=action(paging,"Previous resources",()=>{this.page--;refresh();});prev.setDisabled(this.page===0||this.busy);
      paging.createSpan({text:`${this.page*pageSize+1}–${Math.min((this.page+1)*pageSize,this.records.length)} of ${this.records.length}`});
      const next=action(paging,"Next resources",()=>{this.page++;refresh();});next.setDisabled(this.page===pageCount-1||this.busy);
      for(const field of Array.from(body.querySelectorAll<HTMLInputElement>("select,input")))field.disabled=this.busy;
      update();labelFields(body);
    };
    const submit=async()=>{
      if(this.busy)return;
      const changes=this.records.filter(e=>this.decisions.has(e.key)&&!this.saved.has(e.key)).map(entity=>({entity,decision:this.decisions.get(entity.key)!}));
      if(!changes.length)return;
      this.busy=true;this.stopped=false;close.setButtonText("Stop saving");refresh();
      let results:ReviewResult[]=[];
      try{
        results=await this.host.saveReviewBatch(changes,this.reason,()=>this.stopped,progress=>{
          for(const r of progress){if(r.saved){this.saved.add(r.entity.key);this.failures.delete(r.entity.key);}else this.failures.set(r.entity.key,errorText(r.error));}
          if(this.mounted)status.setText(`Processed ${progress.length} of ${changes.length} · ${progress.filter(r=>r.saved).length} saved · ${progress.filter(r=>!r.saved).length} failed`);
        });
        if(this.mounted)status.setText(`${results.filter(r=>r.saved).length} saved · ${results.filter(r=>!r.saved).length} failed · ${changes.length-results.length} not processed. Saved reviews are kept. Unsaved decisions can be retried.`);
        else new Notice(`${results.filter(r=>r.saved).length} reviews saved. Remaining resources were not changed.`);
      }catch(e){if(this.mounted)status.setText(errorText(e));}
      finally{this.busy=false;if(this.mounted){close.setButtonText("Close").setDisabled(false);refresh();}}
    };
    refresh();
  }
  onClose(){this.stopped=true;this.mounted=false;this.contentEl.empty();}
}
