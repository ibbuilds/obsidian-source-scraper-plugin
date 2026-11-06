import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from "node:fs";
import {dirname} from "node:path";
import {randomUUID} from "node:crypto";
export type CycleState={version:1;projectId:string;cycleId:string;state:"stopped"|"running"|"paused"|"waiting"|"blocked";pages:number;observations:number;duplicates:number;cycles:number;nextAt:number;reason:string;maxPages:number;pagesPerBatch:number;intervalMs:number;budgetStartPages:number;continuous?:boolean};
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
    if(this.value.version!==1||!["stopped","running","paused","waiting","blocked"].includes(this.value.state)||!Number.isInteger(this.value.maxPages)||this.value.maxPages<1||this.value.maxPages>1000)throw Error("INVALID_CYCLE_STATE");
  }
  snapshot(){return {...this.value,active:this.active,execution:"Runs while Obsidian and this computer are open; resumes saved checkpoints after restart",evaluation:"Review resources directly in the plugin, or use an AI through MCP"};}
  private save(){mkdirSync(dirname(this.path),{recursive:true,mode:0o700});const tmp=this.path+"."+randomUUID()+".tmp";writeFileSync(tmp,JSON.stringify(this.value),{flag:"wx",mode:0o600});renameSync(tmp,this.path);}
  attach(){if(this.timer)return;this.timer=setInterval(()=>{void this.tick();},5000);this.timer.unref?.();}
  start(projectId:string,maxPages=100,continuous=false){if(!Number.isInteger(maxPages)||maxPages<1||maxPages>1000)throw Error("INVALID_CYCLE_BUDGET");if(this.active)throw Error("CYCLE_BUSY: wait for the current batch to finish stopping");const restart=this.value.projectId!==projectId||this.value.state==="stopped";Object.assign(this.value,{projectId,maxPages,continuous,state:"running",nextAt:0,reason:"Collecting direct resource links",budgetStartPages:restart?0:this.value.pages,...(restart?{cycleId:randomUUID(),pages:0,observations:0,duplicates:0,cycles:0}:{})});this.save();this.attach();void this.tick();return this.snapshot();}
  pause(){this.value.state="paused";this.value.reason="Paused; checkpoint retained";this.save();this.cancel();return this.snapshot();}
  setContinuous(enabled:boolean){if(this.value.continuous!==enabled){this.value.continuous=enabled;if(!enabled&&this.value.state==="waiting"&&this.value.reason.startsWith("Window budget reached")){this.value.state="paused";this.value.nextAt=0;this.value.reason="Work budget reached; resume explicitly to extend it";}this.save();}}
  stop(){this.value.state="stopped";this.value.reason="Stopped; checkpoint retained";this.save();this.cancel();return this.snapshot();}
  dispose(){this.disposed=true;if(this.timer)clearInterval(this.timer);this.cancel();}
  async tick(now=Date.now()){
    if(this.disposed||this.active||!["running","waiting"].includes(this.value.state)||this.value.nextAt>now)return;
    this.active=true;this.value.state="running";
    try{
      if(this.progress){const progress=await this.progress({...this.value});if(this.disposed||this.value.state!=="running")return;this.value.pages=progress.pages;this.value.observations=progress.observations;this.value.duplicates=progress.duplicates;}
      const remaining=this.value.maxPages-(this.value.pages-this.value.budgetStartPages);
      if(remaining<=0){if(this.value.continuous){this.value.state="waiting";this.value.reason="Window budget reached; next bounded window after cooldown";this.value.nextAt=now+this.value.intervalMs;this.value.budgetStartPages=this.value.pages;this.value.cycles++;}else{this.value.state="paused";this.value.reason="Work budget reached; resume explicitly to extend it";}this.save();return;}
      const r=await this.run({...this.value,pagesPerBatch:Math.min(this.value.pagesPerBatch,remaining)});
      this.value.pages+=r.pages;this.value.observations+=r.observations;this.value.duplicates+=r.duplicates;
      if(this.disposed)return;
      if(this.value.state!=="running"){this.save();return;}
      if(["end-of-window","no-new-items"].includes(r.endReason)){this.value.state="waiting";this.value.cycles++;this.value.reason=r.endReason;this.value.nextAt=now+this.value.intervalMs;}
      else{this.value.reason=r.endReason;this.value.nextAt=now+5000;}
      this.save();
    }catch(error){const progress=(error as {progress?:{pages:number;observations:number;duplicates:number}})?.progress;if(progress){this.value.pages+=progress.pages;this.value.observations+=progress.observations;this.value.duplicates+=progress.duplicates;}if(this.disposed)return;if(["paused","stopped"].includes(this.value.state)){this.save();return;}if(error instanceof Error&&/COLLECTOR_BUSY|Another Source Scraper command/.test(error.message)){this.value.state="waiting";this.value.reason="Waiting for current engine command";this.value.nextAt=now+5000;}else{this.value.state="blocked";this.value.reason=error instanceof Error?error.message.slice(0,300):"Collection failed";}this.save();}
    finally{this.active=false;}
  }
}
