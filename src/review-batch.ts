import type {EntityRecord} from "./contracts.ts";
export const MAX_REVIEW_SELECTION=200;
export type ReviewDecision=EntityRecord["review"];
export interface ReviewChange {entity:EntityRecord;decision:ReviewDecision}
export interface ReviewResult extends ReviewChange {saved:boolean;error?:unknown}
/** A user submits one batch. Writes stay sequential on the existing bounded CLI lane. */
export async function runReviewBatch(changes:ReviewChange[],save:(change:ReviewChange)=>Promise<void>,options:{stopped:()=>boolean;progress?:(results:ReviewResult[])=>void}){
  if(!changes.length||changes.length>MAX_REVIEW_SELECTION)throw Error("Choose 1–200 resources to review.");
  const identities=new Set<string>();
  for(const c of changes){const id=JSON.stringify([c.entity.projectId,c.entity.key]);if(identities.has(id)||!["pending","approved","rejected"].includes(c.decision))throw Error("Invalid or repeated resource in review batch.");identities.add(id);}
  const results:ReviewResult[]=[];
  for(const change of changes){
    if(options.stopped())break;
    try{await save(change);results.push({...change,saved:true});}
    catch(error){results.push({...change,saved:false,error});}
    options.progress?.([...results]);
  }
  return results;
}
export function selectReviewPage(selected:Set<string>,visible:EntityRecord[]){
  let skipped=0;
  for(const e of visible){if(selected.has(e.key))continue;if(selected.size>=MAX_REVIEW_SELECTION){skipped++;continue;}selected.add(e.key);}
  return skipped;
}
