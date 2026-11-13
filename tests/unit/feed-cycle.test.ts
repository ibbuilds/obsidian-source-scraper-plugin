import {test} from "node:test";import assert from "node:assert/strict";import {mkdtempSync,rmSync,writeFileSync} from "node:fs";import {join} from "node:path";import {tmpdir} from "node:os";import {FeedCycle} from "../../src/feed-cycle.ts";
const settle=()=>new Promise(r=>setImmediate(r));

test("explicit resume grants its new budget after reconciling stale counters",async()=>{
 const root=mkdtempSync(join(tmpdir(),"ss-stale-resume-")),path=join(root,"cycle.json");let calls=0;
 writeFileSync(path,JSON.stringify({version:1,projectId:"feed",cycleId:"previous-cycle-identity",state:"blocked",pages:1,observations:1,duplicates:0,cycles:0,nextAt:0,reason:"old read failure",maxPages:30,pagesPerBatch:10,intervalMs:600000,budgetStartPages:0}));
 const cycle=new FeedCycle(path,async state=>{calls++;return {pages:state.pagesPerBatch,observations:10,duplicates:0,endReason:"work-limit"};},()=>{},async()=>({pages:40,observations:40,duplicates:0}));
 try{cycle.start("feed",30);await settle();assert.equal(calls,1);assert.equal(cycle.snapshot().budgetStartPages,40);assert.equal(cycle.snapshot().pages,41);}finally{cycle.dispose();rmSync(root,{recursive:true,force:true});}
});
test("EOF waits, resumes after process restart and checks a new window without chat calls",async()=>{const root=mkdtempSync(join(tmpdir(),"ss-cycle-")),path=join(root,"cycle.json");let calls=0;const run=async()=>{calls++;return {pages:3,observations:100,duplicates:0,endReason:"end-of-window"};};let cycle=new FeedCycle(path,run,()=>{});try{cycle.start("feed",20);await settle();assert.equal(calls,1);assert.equal(cycle.snapshot().state,"waiting");const next=cycle.snapshot().nextAt;cycle.dispose();cycle=new FeedCycle(path,run,()=>{});await cycle.tick(next-1);assert.equal(calls,1);await cycle.tick(next+1);assert.equal(calls,2);assert.equal(cycle.snapshot().observations,200);}finally{cycle.dispose();rmSync(root,{recursive:true,force:true});}});
test("pause, stop and work limits persist without restarting interrupted work",async()=>{const root=mkdtempSync(join(tmpdir(),"ss-cycle-")),path=join(root,"cycle.json");let cancelled=0;const run=async (s:{pagesPerBatch:number})=>({pages:s.pagesPerBatch,observations:42,duplicates:2,endReason:"work-limit"});const cycle=new FeedCycle(path,run,()=>{cancelled++;});try{cycle.start("feed",2);await settle();await cycle.tick(cycle.snapshot().nextAt);await cycle.tick(cycle.snapshot().nextAt);assert.equal(cycle.snapshot().state,"paused");assert.equal(cycle.snapshot().pages,2);cycle.pause();cycle.stop();assert.equal(cycle.snapshot().state,"stopped");assert.ok(cancelled>=2);}finally{cycle.dispose();rmSync(root,{recursive:true,force:true});}});
test("X access failure blocks instead of retrying or deleting a session",async()=>{const root=mkdtempSync(join(tmpdir(),"ss-cycle-")),path=join(root,"cycle.json");let calls=0;const cycle=new FeedCycle(path,async()=>{calls++;throw Error("X_LOCAL_HTTP_401");},()=>{});try{cycle.start("feed");await settle();await cycle.tick(Date.now()+1000000);assert.equal(calls,1);assert.equal(cycle.snapshot().state,"blocked");assert.match(cycle.snapshot().reason,/401/);}finally{cycle.dispose();rmSync(root,{recursive:true,force:true});}});

test("restart reconstructs committed pages before enforcing the remaining budget",async()=>{const root=mkdtempSync(join(tmpdir(),"ss-cycle-progress-")),path=join(root,"cycle.json");let requested=0;const cycle=new FeedCycle(path,async state=>{requested=state.pagesPerBatch;return {pages:state.pagesPerBatch,observations:3,duplicates:0,endReason:"work-limit"};},()=>{},async()=>({pages:8,observations:80,duplicates:4}));try{cycle.start("feed",10);await settle();assert.equal(requested,1);assert.equal(cycle.snapshot().pages,9);assert.equal(cycle.snapshot().observations,83);}finally{cycle.dispose();rmSync(root,{recursive:true,force:true});}});

test("stop and immediate restart cannot mix an in-flight batch into a new cycle",async()=>{
 const root=mkdtempSync(join(tmpdir(),"ss-cycle-restart-"));let release!:()=>void;
 const cycle=new FeedCycle(join(root,"cycle.json"),async()=>{await new Promise<void>(r=>{release=r;});return {pages:2,observations:8,duplicates:0,endReason:"work-limit"};},()=>{});
 try{cycle.start("feed",10);const id=cycle.snapshot().cycleId;cycle.stop();assert.throws(()=>cycle.start("feed",10),/CYCLE_BUSY/);assert.equal(cycle.snapshot().cycleId,id);release();await settle();assert.equal(cycle.snapshot().state,"stopped");assert.equal(cycle.snapshot().pages,2);cycle.start("feed",10);assert.notEqual(cycle.snapshot().cycleId,id);release();await settle();assert.equal(cycle.snapshot().pages,2);}finally{release?.();cycle.dispose();rmSync(root,{recursive:true,force:true});}
});

test("explicit continuous mode repeats bounded windows after cooldown and still honors pause/stop",async()=>{
 const root=mkdtempSync(join(tmpdir(),"ss-continuous-"));let calls=0;
 const cycle=new FeedCycle(join(root,"cycle.json"),async state=>{calls++;return {pages:state.pagesPerBatch,observations:2,duplicates:0,endReason:"work-limit"};},()=>{});
 try{cycle.start("feed",1,true);await settle();await cycle.tick(cycle.snapshot().nextAt);const waiting=cycle.snapshot();assert.equal(waiting.state,"waiting");assert.equal(waiting.pages,1);assert.equal(waiting.budgetStartPages,1);await cycle.tick(waiting.nextAt-1);assert.equal(calls,1);await cycle.tick(waiting.nextAt+1);assert.equal(calls,2);await cycle.tick(cycle.snapshot().nextAt);assert.equal(cycle.snapshot().state,"waiting");cycle.setContinuous(false);assert.equal(cycle.snapshot().state,"paused");await cycle.tick(waiting.nextAt+999999);assert.equal(calls,2);cycle.pause();cycle.stop();assert.equal(cycle.snapshot().continuous,false);}finally{cycle.dispose();rmSync(root,{recursive:true,force:true});}
});

for(const code of [404,500,502,503,504])test(`temporary X ${code} waits before retry and resets failures after success`,async()=>{
 const root=mkdtempSync(join(tmpdir(),"ss-cycle-retry-"));let calls=0;const cycle=new FeedCycle(join(root,"cycle.json"),async()=>{if(++calls===1)throw Error(`X_LOCAL_HTTP_${code}`);return {pages:1,observations:20,duplicates:0,endReason:"end-of-window"};},()=>{});
 try{cycle.start("feed",10);await settle();const waiting=cycle.snapshot(),id=waiting.cycleId;assert.equal(waiting.state,"waiting");assert.equal(waiting.transientFailures,1);await cycle.tick(waiting.nextAt-1);assert.equal(calls,1);await cycle.tick(waiting.nextAt);assert.equal(calls,2);assert.equal(cycle.snapshot().transientFailures,0);assert.equal(cycle.snapshot().pages,1);assert.equal(cycle.snapshot().cycleId,id);}finally{cycle.dispose();rmSync(root,{recursive:true,force:true});}
});

test("transient retry budget and cooldown survive restart, then stop after two retries",async()=>{
 const root=mkdtempSync(join(tmpdir(),"ss-cycle-retry-restart-")),path=join(root,"cycle.json");let calls=0;const fail=async()=>{calls++;throw Error("X_LOCAL_HTTP_404");};let cycle=new FeedCycle(path,fail,()=>{});
 try{cycle.start("feed",10);await settle();const first=cycle.snapshot();cycle.dispose();cycle=new FeedCycle(path,fail,()=>{});await cycle.tick(first.nextAt-1);assert.equal(calls,1);await cycle.tick(first.nextAt);const second=cycle.snapshot();assert.equal(second.state,"waiting");assert.equal(second.transientFailures,2);assert.equal(second.nextAt-first.nextAt,120000);await cycle.tick(second.nextAt);assert.equal(calls,3);assert.equal(cycle.snapshot().state,"blocked");assert.match(cycle.snapshot().reason,/retries exhausted/);await cycle.tick(second.nextAt+999999);assert.equal(calls,3);cycle.start("feed",10);await settle();assert.equal(cycle.snapshot().transientFailures,1);}finally{cycle.dispose();rmSync(root,{recursive:true,force:true});}
});

for(const code of [403,400])test(`X ${code} remains blocked without automatic retries`,async()=>{
 const root=mkdtempSync(join(tmpdir(),"ss-cycle-no-retry-"));let calls=0;const cycle=new FeedCycle(join(root,"cycle.json"),async()=>{calls++;throw Error(`X_LOCAL_HTTP_${code}`);},()=>{});
 try{cycle.start("feed",10);await settle();await cycle.tick(Date.now()+999999);assert.equal(calls,1);assert.equal(cycle.snapshot().state,"blocked");}finally{cycle.dispose();rmSync(root,{recursive:true,force:true});}
});

test("pause cancels a scheduled read retry without losing the checkpoint",async()=>{
 const root=mkdtempSync(join(tmpdir(),"ss-cycle-pause-retry-"));let calls=0;const cycle=new FeedCycle(join(root,"cycle.json"),async()=>{calls++;throw Error("X_LOCAL_HTTP_503");},()=>{});
 try{cycle.start("feed",10);await settle();const waiting=cycle.snapshot();cycle.pause();await cycle.tick(waiting.nextAt+999999);assert.equal(calls,1);assert.equal(cycle.snapshot().state,"paused");assert.equal(cycle.snapshot().cycleId,waiting.cycleId);}finally{cycle.dispose();rmSync(root,{recursive:true,force:true});}
});

test("retry reconciles committed pages and obeys the remaining budget",async()=>{
 const root=mkdtempSync(join(tmpdir(),"ss-cycle-retry-progress-"));let committed=0;const requested:number[]=[];const cycle=new FeedCycle(join(root,"cycle.json"),async state=>{requested.push(state.pagesPerBatch);committed++;if(committed===1)throw Object.assign(Error("X_LOCAL_HTTP_404"),{progress:{pages:1,observations:10,duplicates:0}});return {pages:1,observations:10,duplicates:0,endReason:"work-limit"};},()=>{},async()=>({pages:committed,observations:committed*10,duplicates:0}));
 try{cycle.start("feed",2);await settle();assert.equal(cycle.snapshot().pages,1);await cycle.tick(cycle.snapshot().nextAt);assert.deepEqual(requested,[1,1]);assert.equal(cycle.snapshot().pages,2);assert.equal(cycle.snapshot().observations,20);await cycle.tick(cycle.snapshot().nextAt);assert.equal(cycle.snapshot().state,"paused");}finally{cycle.dispose();rmSync(root,{recursive:true,force:true});}
});


test("429 respects the larger server reset, survives restart and cannot be bypassed by pause/start",async()=>{
 const root=mkdtempSync(join(tmpdir(),"ss-429-")),path=join(root,"cycle.json");let calls=0;const fail=async()=>{calls++;throw Object.assign(Error("X_LOCAL_HTTP_429"),{retryAfterSeconds:2000});};let cycle=new FeedCycle(path,fail,()=>{});
 try{const before=Date.now();cycle.start("feed",10,true);await settle();const first=cycle.snapshot();assert.equal(first.state,"waiting");assert.ok(first.nextAt>=before+2000000);cycle.pause();cycle.start("feed",10,true);await settle();assert.equal(calls,1);assert.equal(cycle.snapshot().nextAt,first.nextAt);cycle.dispose();cycle=new FeedCycle(path,fail,()=>{});await cycle.tick(first.nextAt-1);assert.equal(calls,1);await cycle.tick(first.nextAt);assert.equal(calls,2);await cycle.tick(cycle.snapshot().nextAt);assert.equal(calls,3);await cycle.tick(cycle.snapshot().nextAt);assert.equal(calls,4);assert.equal(cycle.snapshot().state,"blocked");assert.match(cycle.snapshot().reason,/cooldown retries exhausted/);await cycle.tick(cycle.snapshot().nextAt+999999);assert.equal(calls,4);}finally{cycle.dispose();rmSync(root,{recursive:true,force:true});}
});
test("successful reads are paced and clear an expired rate-limit failure",async()=>{
 const root=mkdtempSync(join(tmpdir(),"ss-pacing-"));let calls=0;const cycle=new FeedCycle(join(root,"cycle.json"),async s=>{calls++;assert.equal(s.pagesPerBatch,1);return {pages:1,observations:2,duplicates:0,endReason:"work-limit"};},()=>{});
 try{const before=Date.now();cycle.start("feed",10);await settle();assert.ok(cycle.snapshot().nextAt>=before+120000);await cycle.tick(cycle.snapshot().nextAt-1);assert.equal(calls,1);await cycle.tick(cycle.snapshot().nextAt);assert.equal(calls,2);}finally{cycle.dispose();rmSync(root,{recursive:true,force:true});}
});
