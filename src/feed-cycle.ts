import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from "node:fs";
import {dirname} from "node:path";
import {randomUUID} from "node:crypto";
export type CycleState={version:1;projectId:string;cycleId:string;state:"stopped"|"running"|"paused"|"waiting"|"blocked";pages:number;observations:number;duplicates:number;cycles:number;nextAt:number;reason:string;maxPages:number;pagesPerBatch:number;intervalMs:number;budgetStartPages:number;continuous?:boolean;transientFailures?:number;pendingBudgetReset?:boolean;cooldownUntil?:number;rateLimitFailures?:number};
const READ_RETRY_DELAYS_MS=[30000,120000];
const RATE_LIMIT_DELAYS_MS=[900000,1800000,3600000];
const READ_PACING_MS=120000;
const transientReadFailure=(error:unknown)=>error instanceof Error&&/^X_LOCAL_(?:HTTP_(404|500|502|503|504)|READ_FAILED|TIMEOUT|TRANSPORT_FAILED)(?::.*)?$/.test(error.message);
/** Runs in Obsidian's process, never depends on an open chat or panel. */
export class FeedCycle{
  private value:CycleState;private active=false;private disposed=false;private timer?:ReturnType<typeof setInterval>;
  private path:string;
  private run:(s:CycleState)=>Promise<{pages:number;observations:number;duplicates:number;endReason:string}>;
  private cancel:()=>void;
  private progress?: (state:CycleState)=>Promise<{pages:number;observations:number;duplicates:number}>;
  constructor(path:string,run:(s:CycleState)=>Promise<{pages:number;observations:number;duplicates:number;endReason:string}>,cancel:()=>void,progress?:(state:CycleState)=>Promise<{pages:number;observations:number;duplicates:number}>){
    this.path=path;this.run=run;this.cancel=cancel;this.progress=progress;
    this.value=existsSync(path)?JSON.parse(readFileSync(path,"utf8")):{version:1,projectId:"",cycleId:randomUUID(),state:"stopped",pages:0,observations:0,duplicates:0,cycles:0,nextAt:0,reason:"Not started",maxPages:100,pagesPerBatch:10,intervalMs:600000,budgetStartPages:0};
    this.value.budgetStartPages??=0;this.value.cycleId??=randomUUID();
    if(this.value.cooldownUntil!==undefined&&(!Number.isSafeInteger(this.value.cooldownUntil)||this.value.cooldownUntil<0)||this.value.rateLimitFailures!==undefined&&(!Number.isInteger(this.value.rateLimitFailures)||this.value.rateLimitFailures<0||this.value.rateLimitFailures>RATE_LIMIT_DELAYS_MS.length+1))throw Error("INVALID_CYCLE_STATE");
    // Existing 429 blocks do not contain a trustworthy server reset time.
    if(this.value.continuous&&this.value.state==="blocked"&&this.value.reason==="X_LOCAL_HTTP_429"&&!this.value.cooldownUntil){this.value.rateLimitFailures=1;this.value.cooldownUntil=Date.now()+RATE_LIMIT_DELAYS_MS[0];this.value.nextAt=this.value.cooldownUntil;this.value.state="waiting";this.value.reason="X_LOCAL_HTTP_429; conservative cooldown after upgrade";this.save();}
    if(this.value.version!==1||!["stopped","running","paused","waiting","blocked"].includes(this.value.state)||!Number.isInteger(this.value.maxPages)||this.value.maxPages<1||this.value.maxPages>1000)throw Error("INVALID_CYCLE_STATE");
    if(this.value.transientFailures!==undefined&&(!Number.isInteger(this.value.transientFailures)||this.value.transientFailures<0||this.value.transientFailures>READ_RETRY_DELAYS_MS.length+1))throw Error("INVALID_CYCLE_STATE");
  }
  snapshot(){return {...this.value,active:this.active,execution:"Runs while Obsidian and this computer are open; resumes saved checkpoints after restart",evaluation:"Review resources directly in the plugin, or use an AI through MCP"};}
  private save(){mkdirSync(dirname(this.path),{recursive:true,mode:0o700});const tmp=this.path+"."+randomUUID()+".tmp";writeFileSync(tmp,JSON.stringify(this.value),{flag:"wx",mode:0o600});renameSync(tmp,this.path);}
  attach(){if(this.timer)return;this.timer=setInterval(()=>{void this.tick();},5000);this.timer.unref?.();}
  start(projectId:string,maxPages=100,continuous=false){if(!Number.isInteger(maxPages)||maxPages<1||maxPages>1000)throw Error("INVALID_CYCLE_BUDGET");if(this.active)throw Error("CYCLE_BUSY: wait for the current batch to finish stopping");const restart=this.value.projectId!==projectId||this.value.state==="stopped";const cooling=(this.value.cooldownUntil??0)>Date.now();Object.assign(this.value,{projectId,maxPages,continuous,transientFailures:0,rateLimitFailures:cooling?this.value.rateLimitFailures:0,state:cooling?"waiting":"running",nextAt:cooling?this.value.cooldownUntil:0,reason:cooling?"X_LOCAL_HTTP_429; waiting for saved cooldown":"Collecting direct resource links",pendingBudgetReset:!restart,budgetStartPages:restart?0:this.value.pages,...(restart?{cycleId:randomUUID(),pages:0,observations:0,duplicates:0,cycles:0}:{})});this.save();this.attach();void this.tick();return this.snapshot();}
  pause(){this.value.state="paused";this.value.reason="Paused; checkpoint retained";this.save();this.cancel();return this.snapshot();}
  setContinuous(enabled:boolean){if(this.value.continuous!==enabled){this.value.continuous=enabled;if(!enabled&&this.value.state==="waiting"&&this.value.reason.startsWith("Window budget reached")){this.value.state="paused";this.value.nextAt=0;this.value.reason="Work budget reached; resume explicitly to extend it";}this.save();}}
  stop(){this.value.state="stopped";this.value.reason="Stopped; checkpoint retained";this.save();this.cancel();return this.snapshot();}
  dispose(){this.disposed=true;if(this.timer)clearInterval(this.timer);this.cancel();}
  async tick(now=Date.now()){
    if(this.disposed||this.active||!["running","waiting"].includes(this.value.state)||this.value.nextAt>now)return;
    this.active=true;this.value.state="running";
    try{
      if(this.progress){const progress=await this.progress({...this.value});if(this.disposed||this.value.state!=="running")return;this.value.pages=progress.pages;this.value.observations=progress.observations;this.value.duplicates=progress.duplicates;}
      if(this.value.pendingBudgetReset){this.value.budgetStartPages=this.value.pages;delete this.value.pendingBudgetReset;}
      const remaining=this.value.maxPages-(this.value.pages-this.value.budgetStartPages);
      if(remaining<=0){if(this.value.continuous){this.value.state="waiting";this.value.reason="Window budget reached; next bounded window after cooldown";this.value.nextAt=now+this.value.intervalMs;this.value.budgetStartPages=this.value.pages;this.value.cycles++;}else{this.value.state="paused";this.value.reason="Work budget reached; resume explicitly to extend it";}this.save();return;}
      const r=await this.run({...this.value,pagesPerBatch:Math.min(this.value.pagesPerBatch,remaining,1)});
      this.value.transientFailures=0;this.value.rateLimitFailures=0;delete this.value.cooldownUntil;this.value.pages+=r.pages;this.value.observations+=r.observations;this.value.duplicates+=r.duplicates;
      if(this.disposed)return;
      if(this.value.state!=="running"){this.save();return;}
      if(["end-of-window","no-new-items"].includes(r.endReason)){this.value.state="waiting";this.value.cycles++;this.value.reason=r.endReason;this.value.nextAt=now+this.value.intervalMs;}
      else{this.value.reason=r.endReason;this.value.nextAt=now+READ_PACING_MS;}
      this.save();
    }catch(error){const progress=(error as {progress?:{pages:number;observations:number;duplicates:number}})?.progress;if(progress){this.value.pages+=progress.pages;this.value.observations+=progress.observations;this.value.duplicates+=progress.duplicates;}if(this.disposed)return;if(["paused","stopped"].includes(this.value.state)){this.save();return;}if(error instanceof Error&&/COLLECTOR_BUSY|Another Source Scraper command/.test(error.message)){this.value.state="waiting";this.value.reason="Waiting for current engine command";this.value.nextAt=now+5000;}else if(error instanceof Error&&error.message==="X_LOCAL_HTTP_429"){
      const failures=(this.value.rateLimitFailures??0)+1;this.value.rateLimitFailures=failures;const fallback=RATE_LIMIT_DELAYS_MS[failures-1];
      const supplied=(error as Error&{retryAfterSeconds?:number}).retryAfterSeconds;
      const delay=Math.max(fallback??RATE_LIMIT_DELAYS_MS.at(-1)!,Number.isSafeInteger(supplied)&&Number(supplied)>0&&Number(supplied)<=604801?Number(supplied)*1000:0);
      this.value.cooldownUntil=Math.max(now,Date.now())+delay;this.value.nextAt=this.value.cooldownUntil;
      if(fallback!==undefined){this.value.state="waiting";this.value.reason=`X_LOCAL_HTTP_429; cooldown ${failures}/${RATE_LIMIT_DELAYS_MS.length} until ${new Date(this.value.nextAt).toISOString()}`;}
      else{this.value.state="blocked";this.value.reason="X_LOCAL_HTTP_429; cooldown retries exhausted. Check the X connection before resuming";}
    }else if(transientReadFailure(error)){
      const failures=(this.value.transientFailures??0)+1;this.value.transientFailures=failures;
      const delay=READ_RETRY_DELAYS_MS[failures-1];
      if(delay!==undefined){this.value.state="waiting";this.value.nextAt=Math.max(now,Date.now())+delay;this.value.reason=`${(error as Error).message}; read retry ${failures}/${READ_RETRY_DELAYS_MS.length} in ${delay/1000}s`;}
      else{this.value.state="blocked";this.value.nextAt=0;this.value.reason=`${(error as Error).message}; automatic read retries exhausted. Resume after checking the X connection`;}
    }else{this.value.state="blocked";this.value.reason=error instanceof Error?error.message.slice(0,300):"Collection failed";}this.save();}
    finally{this.active=false;}
  }
}
