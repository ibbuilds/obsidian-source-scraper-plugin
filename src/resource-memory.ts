import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from "node:fs";
import {dirname} from "node:path";
import {randomUUID} from "node:crypto";
import type {VisualReview} from "./reference-quality.ts";
import {LOCAL_CHECKS,RESOURCE_POLICY,type LocalResourceCheck} from "./feedback-policy.ts";

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
  evidence:Array<{url:string;quote:string}>;postSuitable:boolean;at:string;visualReview?:VisualReview};
export type FeedbackAction={id:string;scope:string;resource:string;projectId:string;key:string;accountId:string;postId:string;postUrl:string;postTextHash:string;directUrl?:string;fingerprint:string;origin?:"local-policy";profileHash?:string;
  state:"pending"|"in-progress"|"confirmed"|"failed"|"uncertain"|"cancelled";requestedAt:string;updatedAt:string;error?:string;attempts:number};
export type HumanReview={decision:"pending"|"approved"|"rejected";reason:string;fingerprint:string;postSuitable:boolean;verifiedUsefulFreeAndQuality:boolean;at:string;origin:"user-interface"|"user-mcp"};
type Rejection={scope:string;resource:string;reason:string;at:string;origin:string;active:boolean};
type State={version:1;aliases:Record<string,string>;rejections:Rejection[];history:unknown[];assessments:Record<string,Recommendation>;humanReviews:Record<string,HumanReview>;actions:FeedbackAction[];feedbackEnabled:boolean;localChecks?:Record<string,LocalResourceCheck>};
/** One provider owns this ledger. Scope is the authenticated account, shared across projects. */
export class ResourceMemory{
  private data:State;
  private busy=false;
  private batchDepth=0;
  private rejectionIndex?:Map<string,Rejection[]>;
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
  private save(){if(this.closed||this.batchDepth)return;mkdirSync(dirname(this.file),{recursive:true,mode:0o700});const raw=JSON.stringify(this.data);if(Buffer.byteLength(raw)>32_000_000)throw Error("RESOURCE_MEMORY_LIMIT");const tmp=this.file+"."+randomUUID()+".tmp";writeFileSync(tmp,raw,{flag:"wx",mode:0o600});renameSync(tmp,this.file);}
  identity(scope:string,url:string){let id=resourceIdentity(url);const seen=new Set<string>();while(this.data.aliases[scope+"|"+id]){if(seen.has(id))throw Error("ALIAS_CYCLE");seen.add(id);id=this.data.aliases[scope+"|"+id];}return id;}
  private rejectionRows(scope:string,url:string){if(!this.rejectionIndex){this.rejectionIndex=new Map();for(const r of this.data.rejections){const key=r.scope+"|"+this.identity(r.scope,r.resource),rows=this.rejectionIndex.get(key)??[];rows.push(r);this.rejectionIndex.set(key,rows);}}return this.rejectionIndex.get(scope+"|"+this.identity(scope,url))??[];}
  hasDecision(scope:string,url:string){return this.rejectionRows(scope,url).length>0;}
  rejected(scope:string,url:string){return this.rejectionRows(scope,url).some(r=>r.active);}
  reject(scope:string,url:string,reason="",origin="user"){
    const resource=this.identity(scope,url),at=new Date().toISOString();if(reason.length>1000)throw Error("REASON_LIMIT");const rows=this.rejectionRows(scope,resource);if(rows.some(r=>r.active&&r.reason===reason&&r.origin===origin))return;for(const r of rows)r.active=false;
    const row={scope,resource,reason,at,origin,active:true};this.data.rejections.push(row);rows.push(row);this.rejectionIndex!.set(scope+"|"+resource,rows);
    const previousHuman=this.data.humanReviews[scope+"|"+resource];if(previousHuman)this.data.humanReviews[scope+"|"+resource]={...previousHuman,decision:"rejected",reason,postSuitable:false,verifiedUsefulFreeAndQuality:false,at};this.data.history.push({kind:"reject",scope,resource,reason,at,origin});for(const a of this.data.actions)if(a.scope===scope&&this.identity(scope,a.resource)===resource&&a.state==="pending"){a.state="cancelled";a.updatedAt=at;}this.save();
  }
  restore(scope:string,url:string){const resource=this.identity(scope,url);for(const r of this.rejectionRows(scope,resource))r.active=false;const old=this.humanReview(scope,resource);if(old?.decision==="rejected")this.data.humanReviews[scope+"|"+resource]={...old,decision:"pending",postSuitable:false,verifiedUsefulFreeAndQuality:false,at:new Date().toISOString()};this.data.history.push({kind:"restore",scope,resource,at:new Date().toISOString()});this.save();}
  transaction<T>(work:()=>T):T{if(this.batchDepth)return work();const before=structuredClone(this.data);this.batchDepth++;try{const result=work();this.batchDepth--;this.save();return result;}catch(e){this.batchDepth=0;this.data=before;this.rejectionIndex=undefined;throw e;}}
  queryContext(scope="user"){
    const prefix=scope+"|",aliases=Object.fromEntries(Object.entries(this.data.aliases).filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k.slice(prefix.length),v]));
    const reviews:Record<string,"pending"|"approved"|"rejected">={};for(const r of this.data.rejections)if(r.scope===scope&&!r.active)reviews[this.identity(scope,r.resource)]="pending";
    for(const [k,v] of Object.entries(this.data.humanReviews))if(k.startsWith(prefix))reviews[this.identity(scope,k.slice(prefix.length))]=v.decision;
    for(const r of this.listRejected(scope))reviews[this.identity(scope,r.resource)]="rejected";
    const assessments=Object.fromEntries(Object.entries(this.data.assessments).filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[this.identity(scope,k.slice(prefix.length)),{decision:v.decision,at:v.at,utility:v.utility.slice(0,400)}]));
    return {aliases,rejected:this.listRejected(scope).map(r=>this.identity(scope,r.resource)),reviews,assessments};
  }
  listRejected(scope:string){return this.data.rejections.filter(r=>r.scope===scope&&r.active);}
  alias(scope:string,alias:string,target:string){const a=this.identity(scope,alias),b=this.identity(scope,target);if(a===b)return;this.data.aliases[scope+"|"+a]=b;this.rejectionIndex=undefined;for(const action of this.data.actions)if(action.scope===scope&&action.state==="pending"&&this.rejected(scope,action.resource))action.state="cancelled";this.data.history.push({kind:"alias",scope,alias:a,target:b,at:new Date().toISOString()});this.save();}
  assess(scope:string,url:string,input:unknown){
    const x=input as Recommendation;
    if(!x||!["recommended","pending","discarded"].includes(x.decision)||!/^([a-f0-9]{64})$/.test(x.fingerprint))throw Error("INVALID_RESOURCE_ASSESSMENT");
    for(const k of ["utility","reuse","quality","freeAccess","usableOutput"] as const)if(typeof x[k]!=="string"||x[k].length>4000||(x.decision==="recommended"&&x[k].trim().length<20))throw Error("ASSESSMENT_EVIDENCE_REQUIRED: "+k);
    if(!Array.isArray(x.unknowns)||x.unknowns.length>30||x.unknowns.some(s=>typeof s!=="string"||s.length>1000)||x.postSuitable!==undefined&&typeof x.postSuitable!=="boolean")throw Error("INVALID_RESOURCE_ASSESSMENT");
    if(!Array.isArray(x.evidence)||x.evidence.length>20||x.evidence.some(e=>!e||typeof e.url!=="string"||typeof e.quote!=="string"||e.quote.length>4000||(x.decision==="recommended"&&e.quote.trim().length<20)))throw Error("INVALID_RESOURCE_EVIDENCE");
    for(const e of x.evidence)resourceIdentity(e.url);
    if(x.decision==="recommended"&&(!x.evidence.length||x.unknowns.length))throw Error("UNRESOLVED_RECOMMENDATION");
    const record={...structuredClone(x),postSuitable:x.postSuitable===true,at:new Date().toISOString()};this.data.assessments[scope+"|"+this.identity(scope,url)]=record;this.data.history.push({kind:"assessment",scope,resource:this.identity(scope,url),record});this.save();return record;
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
  private canLike(scope:string,resource:string,fingerprint:string,origin?:"local-policy",profileHash?:string){
    if(origin==="local-policy")return Boolean(profileHash)&&this.localEligible(scope,resource,fingerprint,profileHash);
    const human=this.humanReview(scope,resource),assessment=this.assessment(scope,resource);
    return Boolean(human?.decision==="approved"&&human.postSuitable&&human.verifiedUsefulFreeAndQuality&&human.fingerprint===fingerprint)||Boolean(assessment?.decision==="recommended"&&assessment.postSuitable&&assessment.fingerprint===fingerprint);
  }
  localCheck(scope:string,url:string){return this.data.localChecks?.[scope+"|"+this.identity(scope,url)];}
  localEligible(scope:string,url:string,fingerprint?:string,profileHash?:string){const check=this.localCheck(scope,url);return Boolean(check?.policy===RESOURCE_POLICY&&(!profileHash||check.profileHash===profileHash)&&check.eligible&&check.postSuitable&&(!fingerprint||check.fingerprint===fingerprint)&&Date.parse(check.expiresAt)>Date.now()&&!this.rejected(scope,url)&&!check.relatedResources?.some(related=>this.rejected(scope,related)));}
  recordLocalCheck(scope:string,url:string,input:LocalResourceCheck){
    if(typeof input.eligible!=="boolean"||typeof input.postSuitable!=="boolean"||input.reasons?.length>20)throw Error("INVALID_LOCAL_RESOURCE_CHECK");
    if(input.policy!==RESOURCE_POLICY||!/^[a-f0-9]{64}$/.test(input.profileHash)||!Array.isArray(input.requiredChecks)||!input.requiredChecks.includes("focus")||!input.requiredChecks.includes("suitablePost")||input.requiredChecks.length>LOCAL_CHECKS.length||input.requiredChecks.some(k=>!LOCAL_CHECKS.includes(k))||!/^[a-f0-9]{64}$/.test(input.fingerprint)||!Number.isFinite(Date.parse(input.expiresAt))||Date.parse(input.expiresAt)>Date.now()+86400000+1000||!Array.isArray(input.evidence)||input.evidence.length>12||input.evidence.some(e=>typeof e.quote!=="string"||e.quote.length>4000)||!Array.isArray(input.reasons)||input.reasons.some(r=>typeof r!=="string"||r.length>2000)||LOCAL_CHECKS.some(k=>typeof input.checks?.[k]!=="boolean")||input.eligible&&(!input.requiredChecks.every(k=>input.checks[k])||!input.postSuitable||!input.evidence.length))throw Error("INVALID_LOCAL_RESOURCE_CHECK");
    for(const e of input.evidence)resourceIdentity(e.url);if(input.relatedResources&&(!Array.isArray(input.relatedResources)||input.relatedResources.length>4))throw Error("INVALID_LOCAL_RESOURCE_CHECK");for(const url of input.relatedResources??[])resourceIdentity(url);
    this.data.localChecks??={};const resource=this.identity(scope,url),record=structuredClone(input),previous=this.data.localChecks[scope+"|"+resource];this.data.localChecks[scope+"|"+resource]=record;
    if(record.eligible&&previous?.policy!==record.policy)for(const a of this.data.actions)if(a.scope===scope&&this.identity(scope,a.resource)===resource&&a.origin==="local-policy"&&a.state==="failed"&&a.attempts===0&&a.error==="X_POST_ADDITIONAL_LINKS_NEED_REVIEW"){a.state="cancelled";this.data.history.push({kind:"retired-unsent-policy-preflight",actionId:a.id,at:new Date().toISOString()});}
    for(const a of this.data.actions)if(a.scope===scope&&this.identity(scope,a.resource)===resource&&a.origin==="local-policy"&&a.state==="pending"&&(!record.eligible||record.fingerprint!==a.fingerprint||record.profileHash!==a.profileHash))a.state="cancelled";
    this.data.history.push({kind:"local-resource-check",scope,resource,record});this.save();return record;
  }
  assessment(scope:string,url:string){return this.data.assessments[scope+"|"+this.identity(scope,url)];}
  get enabled(){return !this.closed&&this.data.feedbackEnabled;}
  setFeedback(enabled:boolean){this.data.feedbackEnabled=enabled;this.save();}
  queue(scope:string,details:Omit<FeedbackAction,"scope"|"id"|"state"|"requestedAt"|"updatedAt"|"attempts">){
    const resource=this.identity(scope,details.resource);
    if(this.rejected(scope,resource))throw Error("RESOURCE_REJECTED");
    if(!this.canLike(scope,resource,details.fingerprint,details.origin,details.profileHash))throw Error("RESOURCE_NOT_EVALUATED");
    if(!/^[a-f0-9]{64}$/.test(details.postTextHash))throw Error("POST_SNAPSHOT_REQUIRED");
    if(!/^\d{1,30}$/.test(details.postId)||!/^\d{1,30}$/.test(details.accountId)||!new RegExp("^https://x\\.com/[A-Za-z0-9_]{1,15}/status/"+details.postId+"$").test(details.postUrl))throw Error("INVALID_POST_IDENTITY");
    const prior=this.data.actions.find(a=>a.accountId===details.accountId&&a.postId===details.postId&&a.state!=="cancelled");if(prior){if(prior.state==="pending"&&prior.attempts===0){this.data.history.push({kind:"action-refreshed",previous:structuredClone(prior),at:new Date().toISOString()});Object.assign(prior,details,{resource,scope,updatedAt:new Date().toISOString()});this.save();}return prior;}
    const at=new Date().toISOString(),a:FeedbackAction={...details,resource,scope,id:randomUUID(),state:"pending",requestedAt:at,updatedAt:at,attempts:0};this.data.actions.push(a);this.save();return a;
  }
  actions(scope?:string){return structuredClone(this.data.actions.filter(a=>!scope||a.scope===scope));}
  hasAction(accountId:string,postId:string){return this.data.actions.some(a=>a.accountId===accountId&&a.postId===postId&&a.state!=="cancelled");}
  async dispatch(io:{verify:(a:FeedbackAction)=>Promise<boolean>;send:(a:FeedbackAction)=>Promise<void>;stillValid:(a:FeedbackAction)=>Promise<boolean>},now=Date.now()){
    if(this.busy||!this.enabled)return;this.busy=true;
    try{
      const recent=this.data.actions.filter(a=>a.attempts&&Date.parse(a.updatedAt)>now-3600000);
      if(recent.length>=5||recent.some(a=>Date.parse(a.updatedAt)>now-60000))return;
      const a=this.data.actions.find(a=>["pending","uncertain"].includes(a.state));if(!a)return;
      try{
      if(!this.canLike(a.scope,a.resource,a.fingerprint,a.origin,a.profileHash)||this.rejected(a.scope,a.resource)||!(await io.stillValid(a))){a.state="cancelled";a.updatedAt=new Date(now).toISOString();this.save();return;}
        if(await io.verify(a)){a.state="confirmed";a.updatedAt=new Date(now).toISOString();this.save();return;}
        if(a.state==="uncertain"){a.error="Still unconfirmed; manual reconciliation required";this.save();return;}
        // Reviews and assessments can change while X's preflight is awaiting I/O.
        if(a.state!=="pending"||!this.canLike(a.scope,a.resource,a.fingerprint,a.origin,a.profileHash)||this.rejected(a.scope,a.resource)){a.state="cancelled";a.updatedAt=new Date(now).toISOString();this.save();return;}
        if(!this.enabled)return;
        if(!(await io.stillValid(a))||!this.enabled||a.state!=="pending"||!this.canLike(a.scope,a.resource,a.fingerprint,a.origin,a.profileHash)||this.rejected(a.scope,a.resource)){a.state="cancelled";a.updatedAt=new Date(now).toISOString();this.save();return;}
        a.state="in-progress";a.attempts++;a.updatedAt=new Date(now).toISOString();this.save();
        await io.send(a);a.state=(await io.verify(a))?"confirmed":"uncertain";a.updatedAt=new Date(now).toISOString();this.save();
      }catch(error){a.state=a.attempts?"uncertain":"failed";a.error=error instanceof Error?error.message.slice(0,160):"Feedback request failed";a.updatedAt=new Date(now).toISOString();if(/401|403|429/.test(a.error))this.data.feedbackEnabled=false;this.save();}
    }finally{this.busy=false;}
  }
}
