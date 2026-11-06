import {createHash} from "node:crypto";
export type ReferenceBaseline={hash:string;notes:Array<{path:string;sha256:string}>;links:Array<{url:string;label:string;section:string}>};
export type VisualComparison={referenceUrl:string;sampleUrl:string;composition:string;typography:string;interaction:string;usefulness:string;verdict:"meets"|"below"|"unknown"};
export type VisualReview={baselineHash:string;comparisons:VisualComparison[]};
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
export async function referenceBaseline(paths:readonly string[],read:(path:string)=>Promise<string>):Promise<ReferenceBaseline>{
 const notes:ReferenceBaseline["notes"]=[],links:ReferenceBaseline["links"]=[];
 for(const path of paths){const content=await read(path);notes.push({path,sha256:digest(content)});let section="";for(const line of content.split("\n")){if(/^#{1,6}\s/.test(line))section=line.replace(/^#+\s*/,"").trim();for(const m of line.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)){const url=new URL(m[2]);if(!url.username&&!url.password)links.push({url:url.href,label:m[1],section});}}}
 return {hash:digest(JSON.stringify(notes)),notes,links:[...new Map(links.map(l=>[l.url,l])).values()]};
}
/** Validates the reviewer's evidence contract, not the truth of visual judgments. */
export function validateVisualReview(input:unknown,baseline:ReferenceBaseline,resourceUrls?:readonly string[]):VisualReview{
 const r=input as VisualReview;if(!r||r.baselineHash!==baseline.hash)throw Error("REFERENCE_REVIEW_REQUIRED_OR_STALE");
 if(!Array.isArray(r.comparisons)||r.comparisons.length<2||r.comparisons.length>10)throw Error("VISUAL_COMPARISONS_REQUIRED");
 const refs=new Set(baseline.links.map(l=>l.url)),seenRefs=new Set<string>(),samples=new Set<string>();
 for(const c of r.comparisons){if(!c||!refs.has(c.referenceUrl)||c.verdict!=="meets")throw Error("VISUAL_QUALITY_NOT_ESTABLISHED");const u=new URL(c.sampleUrl);if(u.protocol!=="https:"||u.username||u.password)throw Error("INVALID_VISUAL_SAMPLE");
  if(resourceUrls&&!resourceUrls.some(raw=>{const root=new URL(raw),path=root.pathname.replace(/\/+$/,"");return root.host===u.host&&(!path||u.pathname===path||u.pathname.startsWith(path+"/"));}))throw Error("VISUAL_SAMPLE_OUTSIDE_RESOURCE");
  for(const key of ["composition","typography","interaction","usefulness"] as const)if(typeof c[key]!=="string"||c[key].trim().length<40||c[key].length>1500)throw Error("COMPARISON_EVIDENCE_REQUIRED: "+key);
  seenRefs.add(c.referenceUrl);samples.add(u.href);
 }
 if(seenRefs.size<2||samples.size<2)throw Error("DISTINCT_REFERENCES_AND_SAMPLES_REQUIRED");return structuredClone(r);
}
