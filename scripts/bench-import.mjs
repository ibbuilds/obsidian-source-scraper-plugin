import {performance} from "node:perf_hooks";
import {parseExport} from "../src/contracts.ts";
import {renderNote} from "../src/render.ts";
import {selectedPlans} from "../src/vault-writer.ts";

const count=4000;
const entities=Array.from({length:count},(_,i)=>({
  projectId:"performance-project",key:"resource:"+String(i).padStart(5,"0"),
  type:"sample-record",title:"Record "+i,
  attributes:{source:"test",ordinal:i,nested:{description:"Neutral data ".repeat(10)}},
  category:"unassessed",score:50,confidence:0.5,reasons:["Synthetic evidence"],
  review:"pending",updatedAt:"2026-10-24T00:00:00Z",observationCount:1
}));
const raw=JSON.stringify({schemaVersion:1,dataset:"entities",projectId:"performance-project",
  exportedAt:"2026-10-24T00:00:00Z",limit:5000,offset:0,count,records:entities});
let actual;
const samples=[];
for(let sample=0;sample<3;sample++){
  const start=performance.now();
  actual=parseExport(raw);
  if(actual.records.length!==count)throw Error("Data lost during performance test");
  samples.push(performance.now()-start);
}
samples.sort((a,b)=>a-b);
const importMs=Number(samples[1].toFixed(2));
const renderStart=performance.now();
const plans=selectedPlans("Source Scraper/Imported",actual.records.slice(0,200));
const renderMs=Number((performance.now()-renderStart).toFixed(2));
if(plans.length!==200||new Set(plans.map(x=>x.path)).size!==200)
  throw Error("Render identity collision or missing notes");
for(const plan of plans){
  if(!plan.content.includes("source-scraper-entity")||
    !plan.content.includes("Synthetic evidence"))throw Error("Rendered note lost metadata");
}
if(importMs>5000||renderMs>3000)throw Error(
  "Large import or note preview exceeds conservative 5/3-second smoke budget");
process.stdout.write(JSON.stringify({records:count,jsonBytes:Buffer.byteLength(raw),
  importMedianMs:importMs,render200Ms:renderMs,node:process.version})+"\n");
