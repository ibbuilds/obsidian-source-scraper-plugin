import {test} from "node:test";
import assert from "node:assert/strict";
import {runReviewBatch,selectReviewPage} from "../../src/review-batch.ts";
import type {EntityRecord} from "../../src/contracts.ts";
const row=(i:number)=>({projectId:"test",key:"r"+i} as EntityRecord);
test("select page keeps selections on other pages, deduplicates and enforces the 200 resource limit",()=>{
 const selected=new Set(Array.from({length:195},(_,i)=>row(i).key));
 assert.equal(selectReviewPage(selected,Array.from({length:40},(_,i)=>row(i+190))),30);assert.equal(selected.size,200);assert.ok(selected.has("r0"));assert.ok(selected.has("r199"));assert.ok(!selected.has("r200"));
});
test("mixed manual reviews persist individually, report partial failure and never run concurrently",async()=>{
 let running=0,peak=0;const saved:string[]=[],updates:number[]=[];
 const changes=[{entity:row(1),decision:"approved" as const},{entity:row(2),decision:"rejected" as const},{entity:row(3),decision:"pending" as const}];
 const result=await runReviewBatch(changes,async c=>{peak=Math.max(peak,++running);await Promise.resolve();running--;if(c.entity.key==="r2")throw Error("Fixture failure");saved.push(c.entity.key);},{stopped:()=>false,progress:r=>updates.push(r.length)});
 assert.equal(peak,1);assert.deepEqual(saved,["r1","r3"]);assert.deepEqual(result.map(r=>r.saved),[true,false,true]);assert.deepEqual(updates,[1,2,3]);
});
test("stopping keeps an in-flight confirmation and does not start remaining reviews",async()=>{
 let stop=false;const result=await runReviewBatch([1,2,3].map(i=>({entity:row(i),decision:"approved"})),async()=>{stop=true;},{stopped:()=>stop});assert.equal(result.length,1);assert.equal(result[0].saved,true);
});
test("invalid or repeated batches fail before any save",async()=>{
 let calls=0;const save=async()=>{calls++;},options={stopped:()=>false};
 for(const batch of [[],Array.from({length:201},(_,i)=>({entity:row(i),decision:"pending" as const})),[{entity:row(1),decision:"approved" as const},{entity:row(1),decision:"rejected" as const}]])await assert.rejects(runReviewBatch(batch,save,options));assert.equal(calls,0);
});
test("retrying only failed and unprocessed reviews never resubmits saved decisions",async()=>{
 const changes=[1,2,3].map(i=>({entity:row(i),decision:"approved" as const})),calls:string[]=[];let stop=false;
 const first=await runReviewBatch(changes,async c=>{calls.push(c.entity.key);if(c.entity.key==="r2"){stop=true;throw Error("Retryable failure");}},{stopped:()=>stop});
 const saved=new Set(first.filter(r=>r.saved).map(r=>r.entity.key));await runReviewBatch(changes.filter(c=>!saved.has(c.entity.key)),async c=>{calls.push(c.entity.key);},{stopped:()=>false});assert.deepEqual(calls,["r1","r2","r2","r3"]);
});
