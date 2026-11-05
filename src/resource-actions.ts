import type {EntityRecord} from "./contracts.ts";
export function selectedReviewRequest(projectId:string,requestId:string,records:EntityRecord[],decision:EntityRecord["review"]){
 if(!records.length||records.length>5000)throw Error("Select 1–5,000 resources first");
 if(!["pending","approved","rejected"].includes(decision))throw Error("Invalid resource choice");
 if(new Set(records.map(r=>r.key)).size!==records.length||records.some(r=>r.projectId!==projectId))throw Error("The selection must belong to this project");
 return {projectId,requestId,changes:records.map(r=>({key:r.key,decision,revision:r.revision}))};
}
export function resourceAccess(attributes:Record<string,unknown>){
 const labels:Record<string,string>={open_source:"Open source",free:"Free access",freemium:"Free tier",paid:"Paid"};
 const access=labels[String(attributes.access)]||"Access not checked";
 const license=typeof attributes.license==="string"&&attributes.license.trim()?attributes.license.trim():"";
 return access+(license?" · "+license:"");
}
