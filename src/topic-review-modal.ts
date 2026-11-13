import {Modal,Setting,ButtonComponent,type App} from "obsidian";
import {dialog,formStatus,labelFields,externalLink} from "./form-ui.ts";
import {checkedUrl} from "./contracts.ts";
const paragraph=(root:HTMLElement,text:string)=>root.createEl("p",{text});

export interface TopicReviewHost {
 projectId:string;kind:"posts"|"resources";feedbackEnabled:()=>boolean;
 query:(args:Record<string,unknown>)=>Promise<any>;
 save:(args:Record<string,unknown>)=>Promise<any>;
 changed:()=>void;
}
/** Native review of actual supplied evidence. Opening this dialog sends no feedback. */
export class TopicReviewModal extends Modal {
 private disposed=false;private busy=false;private packet:any;private index=0;private cursor?:string;
 private body!:HTMLElement;private footer!:HTMLElement;private status!:HTMLElement;
 private reason="";private queueLike=false;private seen=new Set<string>();private pending?:Record<string,unknown>;
 constructor(app:App,private host:TopicReviewHost){super(app);}
 onOpen(){const layout=dialog(this,this.host.kind==="posts"?"Review post relevance":"Review resource relevance",true);this.body=layout.body;this.footer=layout.footer;this.status=formStatus(this.footer);void this.load();}
 onClose(){this.disposed=true;}
 private async load(){
  if(this.busy||this.disposed)return;this.busy=true;this.status.setText("Loading retained evidence…");
  try{const packet=await this.host.query({projectId:this.host.projectId,cursor:this.cursor,limit:25});if(this.disposed)return;this.packet=packet;this.index=0;this.pending=undefined;this.resetDraft();this.render();this.status.setText("");}
  catch(error){if(!this.disposed){this.status.setText(error instanceof Error?error.message:"Could not load relevance evidence");this.body.empty();new ButtonComponent(this.body).setButtonText("Retry").onClick(()=>{void this.load();});}}
  finally{this.busy=false;}
 }
 private resetDraft(){const d=this.packet?.records?.[this.index];this.reason=d?.decision?.id?d.decision.reason:"";this.seen.clear();}
 private render(){
  this.body.empty();for(const button of Array.from(this.footer.querySelectorAll("button")))button.remove();
  const detail=this.packet?.records?.[this.index];
  if(!detail){paragraph(this.body,"No more evidence in this pass. You can close this dialog and collect or review another source.");if(this.packet?.nextCursor)new ButtonComponent(this.footer).setButtonText("Continue pass").onClick(()=>{this.cursor=this.packet.nextCursor;void this.load();});return;}
  const post=this.host.kind==="posts",value=post?detail.observation:detail.entity;
  paragraph(this.body,post?"Decide whether the complete post matches your topic. This is separate from resource quality; posts without links can be reviewed.":"Decide whether this resource matches your topic. Quality and Keep/Hide remain separate choices.");
  this.body.createEl("p",{cls:"ss-count",text:`${this.index+1} of ${this.packet.records.length} in this packet`});
  if(this.packet.profile.description)paragraph(this.body,this.packet.profile.description);
  this.body.createEl("h3",{text:value.title||"Source post"});
  this.body.createEl("div",{cls:"ss-topic-text",text:post?(value.text||value.title||"No post text supplied"):detail.corpus});
  const url=checkedUrl(value.url);if(url)externalLink(this.body,post?"Open original post":"Open resource",url);
  if(post){const metrics=value.attributes?.metrics;paragraph(this.body,Number.isSafeInteger(metrics?.likes)?`${metrics.likes} observed likes. Likes are a supporting signal, not a topic decision.`:"Like count unavailable. This cannot authorize an automatic like.");if(value.attributes?.mediaEvidenceComplete!==true)paragraph(this.body,"This snapshot lacks complete post context or playable media. Leave it unsure until complete evidence is available.");}
  for(const media of detail.media??[]){let parsed:URL;try{parsed=new URL(media);}catch{continue;}if(parsed.protocol!=="https:"||!["pbs.twimg.com","video.twimg.com"].includes(parsed.hostname))continue;
   if(parsed.hostname==="video.twimg.com"){const video=this.body.createEl("video",{cls:"ss-topic-media"});video.controls=true;video.preload="none";video.crossOrigin="anonymous";video.src=media;}
   else{const image=this.body.createEl("img",{cls:"ss-topic-media",attr:{alt:"Visual supplied with the original post",loading:"lazy",referrerpolicy:"no-referrer"}});image.crossOrigin="anonymous";image.src=media;}
   new Setting(this.body).setName("I reviewed this visual").addToggle(t=>t.setValue(false).onChange(v=>{if(v)this.seen.add(media);else this.seen.delete(media);}));
  }
  new Setting(this.body).setName("Reason and observed evidence").setDesc("For a relevant decision, describe what in the supplied evidence matches your topic.").addTextArea(t=>{t.setValue(this.reason).onChange(value=>{this.reason=value;});t.inputEl.rows=3;});
  if(post)new Setting(this.body).setName("Queue eligible likes").setDesc(this.host.feedbackEnabled()?"Applies to your relevant decisions while this dialog is open. The source and existing rate limits are checked again before sending.":"Automatic likes is off. Saving a topic decision does not enable it.").addToggle(t=>t.setValue(this.queueLike).setDisabled(!this.host.feedbackEnabled()).onChange(v=>{this.queueLike=v;}));
  for(const [state,label] of [["pertinent","Relevant"],["irrelevant","Not relevant"],["uncertain","Unsure"]])new ButtonComponent(this.footer).setButtonText(label).onClick(()=>{void this.save(state);});
  new ButtonComponent(this.footer).setButtonText("Skip").onClick(()=>{if(!this.busy&&!this.pending)this.next();});labelFields(this.body);
 }
 private next(){this.index++;this.resetDraft();if(this.index>=this.packet.records.length&&this.packet.nextCursor){this.cursor=this.packet.nextCursor;void this.load();}else this.render();}
 private async save(state:string){
  if(this.busy||this.disposed)return;const detail=this.packet.records[this.index];
  if(!this.pending){
   if(state==="pertinent"&&(this.host.kind==="posts"&&detail.observation?.attributes?.mediaEvidenceComplete!==true||this.reason.trim().length<20||(detail.media??[]).some((url:string)=>!this.seen.has(url)))){this.status.setText("Describe the evidence and review each supplied visual in a complete snapshot before marking this relevant.");return;}
   const quote=String(detail.observation?.text||detail.observation?.title||detail.corpus||"").slice(0,4000);
   const review={fingerprint:detail.fingerprint,profileHash:this.packet.profileHash,state,reason:this.reason.trim()||`The user reviewed the supplied evidence and marked it ${state}.`,wholePostReviewed:state==="pertinent",uncertainties:state==="uncertain"?[this.reason.trim()||"Further topic evidence is needed"]:[],evidence:[...(quote.length>=3?[{kind:"text",quote}]:[]),...[...this.seen].map(url=>({kind:"visual",url,note:this.reason.trim()}))]};
   this.pending={projectId:this.host.projectId,requestId:crypto.randomUUID(),items:[{key:detail.key,review,...(this.host.kind==="posts"?{queueLike:state==="pertinent"&&this.queueLike}:{})}]};
  }
  this.busy=true;for(const button of Array.from(this.footer.querySelectorAll("button")))button.disabled=true;this.status.setText("Saving your decision…");
  try{await this.host.save(this.pending);this.pending=undefined;this.host.changed();if(!this.disposed){this.status.setText("Saved.");this.busy=false;this.next();}}
  catch(error){if(!this.disposed){const message=error instanceof Error?error.message:"The save outcome is unknown";this.status.setText(message);for(const button of Array.from(this.footer.querySelectorAll("button")))button.remove();const terminal=/INVALID_|STALE_|_CHANGED|EXPLICIT_USER_DECISION|TOPIC_NOT_ESTABLISHED|_NOT_OBSERVED|_REQUIRED|NOT_ALLOWED|NOT_FOUND|REJECTED/.test(message);if(terminal)new ButtonComponent(this.footer).setButtonText("Reload current evidence").onClick(()=>{this.pending=undefined;this.cursor=undefined;void this.load();});else new ButtonComponent(this.footer).setButtonText("Retry save").onClick(()=>{void this.save(state);});}}
  finally{this.busy=false;}
 }
}
