import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from "node:fs";
import {dirname} from "node:path";
import {randomUUID} from "node:crypto";

export function resourceIdentity(raw:string):string{
  const u=new URL(raw);
  if(!["http:","https:"].includes(u.protocol)||u.username||u.password)throw Error("INVALID_RESOURCE_URL");
  u.protocol="https:";u.hash="";u.hostname=u.hostname.toLowerCase();
  for(const k of [...u.searchParams.keys()])if(/^utm_/i.test(k)||["fbclid","gclid","ref_src","ref_url"].includes(k.toLowerCase()))u.searchParams.delete(k);
  u.searchParams.sort();u.pathname=u.pathname.replace(/\/+$/,"")||"/";
  return u.toString();
}
export type Recommendation={decision:"recommended"|"pending"|"discarded";fingerprint:string;
  utility:string;reuse:string;quality:string;freeAccess:string;usableOutput:string;unknowns:string[];
  evidence:Array<{url:string;quote:string}>;postSuitable:boolean;at:string};
export type FeedbackAction={id:string;scope:string;resource:string;projectId:string;key:string;accountId:string;postId:string;postUrl:string;postTextHash:string;directUrl?:string;fingerprint:string;
  state:"pending"|"in-progress"|"confirmed"|"failed"|"uncertain"|"cancelled";requestedAt:string;updatedAt:string;error?:string;attempts:number};
export type HumanReview={decision:"pending"|"approved"|"rejected";reason:string;fingerprint:string;postSuitable:boolean;verifiedUsefulFreeAndQuality:boolean;at:string;origin:"user-interface"|"user-mcp"};
type Rejection={scope:string;resource:string;reason:string;at:string;origin:string;active:boolean};
type State={version:1;aliases:Record<string,string>;rejections:Rejection[];history:unknown[];assessments:Record<string,Recommendation>;humanReviews:Record<string,HumanReview>;actions:FeedbackAction[];feedbackEnabled:boolean};
/** One provider owns this ledger. Scope is the authenticated account, shared across projects. */
export class ResourceMemory{
  private data:State;
  private busy=false;
  private closed=false;
  private file:string;
  constructor(file:string){
    this.file=file;
    this.data=existsSync(file)?JSON.parse(readFileSync(file,"utf8")):{version:1,aliases:{},rejections:[],history:[],assessments:{},humanReviews:{},actions:[],feedbackEnabled:false};
    this.data.humanReviews??={};
    if(this.data.version!==1||!Array.isArray(this.data.actions)||!Array.isArray(this.data.rejections))throw Error("RESOURCE_MEMORY_UNSUPPORTED");
    for(const a of this.data.actions)if(a.state==="in-progress"){a.state="uncertain";a.error="Interrupted; reconcile before retry";}
    this.save();
  }
  close(){this.closed=true;}
  private save(){if(this.closed)return;mkdirSync(dirname(this.file),{recursive:true,mode:0o700});const raw=JSON.stringify(this.data);if(Buffer.byteLength(raw)>32_000_000)throw Error("RESOURCE_MEMORY_LIMIT");const tmp=this.file+"."+randomUUID()+".tmp";writeFileSync(tmp,raw,{flag:"wx",mode:0o600});renameSync(tmp,this.file);}
  identity(scope:string,url:string){let id=resourceIdentity(url);const seen=new Set<string>();while(this.data.aliases[scope+"|"+id]){if(seen.has(id))throw Error("ALIAS_CYCLE");seen.add(id);id=this.data.aliases[scope+"|"+id];}return id;}
  hasDecision(scope:string,url:string){const id=this.identity(scope,url);return this.data.rejections.some(r=>r.scope===scope&&this.identity(scope,r.resource)===id);}
  rejected(scope:string,url:string){const id=this.identity(scope,url);return this.data.rejections.some(r=>r.scope===scope&&r.active&&this.identity(scope,r.resource)===id);}
  reject(scope:string,url:string,reason="",origin="user"){const resource=this.identity(scope,url),at=new Date().toISOString();if(reason.length>1000)throw Error("REASON_LIMIT");if(this.data.rejections.some(r=>r.scope===scope&&r.active&&this.identity(scope,r.resource)===resource&&r.reason===reason&&r.origin===origin))return;for(const r of this.data.rejections)if(r.scope===scope&&this.identity(scope,r.resource)===resource)r.active=false;this.data.rejections.push({scope,resource,reason,at,origin,active:true});const previousHuman=this.data.humanReviews[scope+"|"+resource];if(previousHuman)this.data.humanReviews[scope+"|"+resource]={...previousHuman,decision:"rejected",reason,postSuitable:false,verifiedUsefulFreeAndQuality:false,at};this.data.history.push({kind:"reject",scope,resource,reason,at,origin});for(const a of this.data.actions)if(a.scope===scope&&this.identity(scope,a.resource)===resource&&a.state==="pending"){a.state="cancelled";a.updatedAt=at;}this.save();}
  restore(scope:string,url:string){const resource=this.identity(scope,url);for(const r of this.data.rejections)if(r.scope===scope&&this.identity(scope,r.resource)===resource)r.active=false;const old=this.humanReview(scope,resource);if(old?.decision==="rejected")this.data.humanReviews[scope+"|"+resource]={...old,decision:"pending",postSuitable:false,verifiedUsefulFreeAndQuality:false,at:new Date().toISOString()};this.data.history.push({kind:"restore",scope,resource,at:new Date().toISOString()});this.save();}
  listRejected(scope:string){return this.data.rejections.filter(r=>r.scope===scope&&r.active);}
  alias(scope:string,alias:string,target:string){const a=this.identity(scope,alias),b=this.identity(scope,target);if(a===b)return;this.data.aliases[scope+"|"+a]=b;for(const action of this.data.actions)if(action.scope===scope&&action.state==="pending"&&this.rejected(scope,action.resource))action.state="cancelled";this.data.history.push({kind:"alias",scope,alias:a,target:b,at:new Date().toISOString()});this.save();}
  assess(scope:string,url:string,input:unknown){
    const x=input as Recommendation;
    if(!x||!["recommended","pending","discarded"].includes(x.decision)||!/^([a-f0-9]{64})$/.test(x.fingerprint))throw Error("INVALID_RESOURCE_ASSESSMENT");
    for(const k of ["utility","reuse","quality","freeAccess","usableOutput"] as const)if(typeof x[k]!=="string"||x[k].length>4000||(x.decision==="recommended"&&x[k].trim().length<20))throw Error("ASSESSMENT_EVIDENCE_REQUIRED: "+k);
    if(!Array.isArray(x.unknowns)||x.unknowns.length>30||x.unknowns.some(s=>typeof s!=="string"||s.length>1000)||typeof x.postSuitable!=="boolean")throw Error("INVALID_RESOURCE_ASSESSMENT");
    if(!Array.isArray(x.evidence)||x.evidence.length>20||x.evidence.some(e=>!e||typeof e.url!=="string"||typeof e.quote!=="string"||e.quote.length>4000||(x.decision==="recommended"&&e.quote.trim().length<20)))throw Error("INVALID_RESOURCE_EVIDENCE");
    for(const e of x.evidence)resourceIdentity(e.url);
    if(x.decision==="recommended"&&(!x.evidence.length||x.unknowns.length))throw Error("UNRESOLVED_RECOMMENDATION");
    const record={...structuredClone(x),at:new Date().toISOString()};this.data.assessments[scope+"|"+this.identity(scope,url)]=record;this.data.history.push({kind:"assessment",scope,resource:this.identity(scope,url),record});this.save();return record;
  }
  recordHumanReview(scope:string,url:string,review:Omit<HumanReview,"at">){
    if(!["pending","approved","rejected"].includes(review.decision)||typeof review.reason!=="string"||review.reason.length>1000||!/^[a-f0-9]{64}$/.test(review.fingerprint)||typeof review.postSuitable!=="boolean"||typeof review.verifiedUsefulFreeAndQuality!=="boolean"||!["user-interface","user-mcp"].includes(review.origin))throw Error("INVALID_HUMAN_REVIEW");
    const resource=this.identity(scope,url),record={...review,at:new Date().toISOString()};
    if(review.decision==="rejected")this.reject(scope,resource,review.reason,review.origin);
    else if(this.rejected(scope,resource))this.restore(scope,resource);
    this.data.humanReviews[scope+"|"+resource]=record;this.data.history.push({kind:"human-review",scope,resource,record});
    if(review.decision!=="approved")for(const action of this.data.actions)if(action.scope===scope&&this.identity(scope,action.resource)===resource&&action.state==="pending")action.state="cancelled";
    this.save();return record;
  }
  humanReview(scope:string,url:string){return this.data.humanReviews[scope+"|"+this.identity(scope,url)];}
  private canLike(scope:string,resource:string,fingerprint:string){
    const human=this.humanReview(scope,resource),assessment=this.assessment(scope,resource);
    return Boolean(human?.decision==="approved"&&human.postSuitable&&human.verifiedUsefulFreeAndQuality&&human.fingerprint===fingerprint)||Boolean(assessment?.decision==="recommended"&&assessment.postSuitable&&assessment.fingerprint===fingerprint);
  }
  assessment(scope:string,url:string){return this.data.assessments[scope+"|"+this.identity(scope,url)];}
  get enabled(){return !this.closed&&this.data.feedbackEnabled;}
  setFeedback(enabled:boolean){this.data.feedbackEnabled=enabled;this.save();}
  queue(scope:string,details:Omit<FeedbackAction,"scope"|"id"|"state"|"requestedAt"|"updatedAt"|"attempts">){
    const resource=this.identity(scope,details.resource);
    if(this.rejected(scope,resource))throw Error("RESOURCE_REJECTED");
    if(!this.canLike(scope,resource,details.fingerprint))throw Error("RESOURCE_NOT_EVALUATED");
    if(!/^[a-f0-9]{64}$/.test(details.postTextHash))throw Error("POST_SNAPSHOT_REQUIRED");
    if(!/^\d{1,30}$/.test(details.postId)||!/^\d{1,30}$/.test(details.accountId)||!new RegExp("^https://x\\.com/[A-Za-z0-9_]{1,15}/status/"+details.postId+"$").test(details.postUrl))throw Error("INVALID_POST_IDENTITY");
    const prior=this.data.actions.find(a=>a.accountId===details.accountId&&a.postId===details.postId&&a.state!=="cancelled");if(prior){if(prior.state==="pending"&&prior.attempts===0){this.data.history.push({kind:"action-refreshed",previous:structuredClone(prior),at:new Date().toISOString()});Object.assign(prior,details,{resource,scope,updatedAt:new Date().toISOString()});this.save();}return prior;}
    const at=new Date().toISOString(),a:FeedbackAction={...details,resource,scope,id:randomUUID(),state:"pending",requestedAt:at,updatedAt:at,attempts:0};this.data.actions.push(a);this.save();return a;
  }
  actions(scope?:string){return structuredClone(this.data.actions.filter(a=>!scope||a.scope===scope));}
  async dispatch(io:{verify:(a:FeedbackAction)=>Promise<boolean>;send:(a:FeedbackAction)=>Promise<void>;stillValid:(a:FeedbackAction)=>Promise<boolean>},now=Date.now()){
    if(this.busy||!this.enabled)return;this.busy=true;
    try{
      const recent=this.data.actions.filter(a=>a.attempts&&Date.parse(a.updatedAt)>now-3600000);
      if(recent.length>=5||recent.some(a=>Date.parse(a.updatedAt)>now-60000))return;
      const a=this.data.actions.find(a=>["pending","uncertain"].includes(a.state));if(!a)return;
      try{
      if(!this.canLike(a.scope,a.resource,a.fingerprint)||this.rejected(a.scope,a.resource)||!(await io.stillValid(a))){a.state="cancelled";a.updatedAt=new Date(now).toISOString();this.save();return;}
        if(await io.verify(a)){a.state="confirmed";a.updatedAt=new Date(now).toISOString();this.save();return;}
        if(a.state==="uncertain"){a.error="Still unconfirmed; manual reconciliation required";this.save();return;}
        if(!this.enabled||this.rejected(a.scope,a.resource))return;
        a.state="in-progress";a.attempts++;a.updatedAt=new Date(now).toISOString();this.save();
        await io.send(a);a.state=(await io.verify(a))?"confirmed":"uncertain";a.updatedAt=new Date(now).toISOString();this.save();
      }catch(error){a.state=a.attempts?"uncertain":"failed";a.error=error instanceof Error?error.message.slice(0,160):"Feedback request failed";a.updatedAt=new Date(now).toISOString();if(/401|403|429/.test(a.error))this.data.feedbackEnabled=false;this.save();}
    }finally{this.busy=false;}
  }
}
