import {parseCollectionFilters,type CollectionFilters} from "./collection-filters.ts";
import type {ReferenceBaseline} from "./reference-quality.ts";
import {relatedResourceUrl} from "./feedback-policy.ts";
export type QualityState="qualified"|"pending"|"excluded";
export type Criterion={id:string;label:string};
export type QualityCategory={id:string;label:string;referenceSections:string[];criteria:Criterion[]};
export type CurationPolicy={version:1;maxAgeDays:number;required?:boolean;candidateFilters?:CollectionFilters;categories:QualityCategory[]};
export type Proof={url:string;quote:string};
export type QualityReview={version:1;fingerprint:string;profileHash:string;baselineHash:string;category:string;decision:QualityState;reason:string;
 relevance:string;access:{mode:"unmetered-free"|"metered"|"trial"|"paid"|"unknown";scope:string;evidence:Proof[]};
 criteria:Array<{id:string;verdict:"meets"|"below"|"unknown";note:string;evidence:Proof[]}>;
 comparisons:Array<{referenceUrl:string;sampleUrl:string;note:string}>};
export type Qualification=QualityReview&{entityUpdatedAt:string;at:string;expiresAt:string;origin:"user-interface"|"agent-mcp"};
const object=(v:unknown):v is Record<string,any>=>Boolean(v)&&typeof v==="object"&&!Array.isArray(v);
const bounded=(v:unknown,min=1,max=1500):v is string=>typeof v==="string"&&v.trim().length>=min&&v.length<=max;
const keys=(v:Record<string,unknown>,allowed:string[])=>Object.keys(v).every(k=>allowed.includes(k));
const id=(v:unknown):v is string=>typeof v==="string"&&/^[a-z][a-z0-9-]{1,47}$/.test(v);
export function parseCurationPolicy(v:unknown):CurationPolicy{
 if(!object(v)||!keys(v,["version","maxAgeDays","required","candidateFilters","categories"])||v.version!==1||v.required!==undefined&&typeof v.required!=="boolean"||!Number.isInteger(v.maxAgeDays)||v.maxAgeDays<1||v.maxAgeDays>90||!Array.isArray(v.categories)||!v.categories.length||v.categories.length>20)throw Error("INVALID_CURATION_POLICY");
 const unique=new Set<string>();for(const c of v.categories){if(!object(c)||!keys(c,["id","label","referenceSections","criteria"])||!id(c.id)||unique.has(c.id)||!bounded(c.label,1,100)||!Array.isArray(c.referenceSections)||!c.referenceSections.length||c.referenceSections.length>20||c.referenceSections.some((s:unknown)=>!bounded(s,1,150))||!Array.isArray(c.criteria)||!c.criteria.length||c.criteria.length>8)throw Error("INVALID_QUALITY_CATEGORY");unique.add(c.id);const seen=new Set<string>();for(const r of c.criteria){if(!object(r)||!keys(r,["id","label"])||!id(r.id)||seen.has(r.id)||!bounded(r.label,10,400))throw Error("INVALID_CATEGORY_CRITERION");seen.add(r.id);}}
 if(v.candidateFilters!==undefined)parseCollectionFilters(v.candidateFilters);
 return structuredClone(v) as CurationPolicy;
}
export const categoryReferences=(category:QualityCategory,baseline:ReferenceBaseline)=>baseline.links.filter(l=>category.referenceSections.some(s=>s.toLowerCase()===l.section.toLowerCase()));
/** Validates evidence contracts and freshness; reviewers own factual and aesthetic judgments. */
export function validateQualityReview(input:unknown,policy:CurationPolicy,profileHash:string,baseline:ReferenceBaseline,resourceUrls:readonly string[],fingerprint:string):QualityReview{
 const r=input as QualityReview;if(!object(r)||!keys(r,["version","fingerprint","profileHash","baselineHash","category","decision","reason","relevance","access","criteria","comparisons"])||r.version!==1||r.fingerprint!==fingerprint||r.profileHash!==profileHash||r.baselineHash!==baseline.hash)throw Error("QUALITY_REVIEW_REQUIRED_OR_STALE");
 const category=policy.categories.find(c=>c.id===r.category);if(!category||!["qualified","pending","excluded"].includes(r.decision)||!bounded(r.reason,20)||typeof r.relevance!=="string"||r.relevance.length>1500||!object(r.access)||!keys(r.access,["mode","scope","evidence"])||!["unmetered-free","metered","trial","paid","unknown"].includes(r.access.mode)||typeof r.access.scope!=="string"||r.access.scope.length>1500)throw Error("INVALID_QUALITY_REVIEW");
 const proof=(e:unknown,required:boolean)=>{if(!Array.isArray(e)||e.length>10||required&&!e.length)throw Error("QUALITY_EVIDENCE_REQUIRED");for(const item of e){if(!object(item)||!keys(item,["url","quote"])||!bounded(item.quote,20,4000)||!relatedResourceUrl(item.url,resourceUrls)||new URL(item.url).protocol!=="https:")throw Error("INVALID_QUALITY_EVIDENCE");}};
 const qualified=r.decision==="qualified";proof(r.access.evidence,qualified);
 if(!Array.isArray(r.criteria)||r.criteria.length>8||!Array.isArray(r.comparisons)||r.comparisons.length>10)throw Error("INVALID_QUALITY_REVIEW");
 const seen=new Set<string>();for(const c of r.criteria){if(!object(c)||!keys(c,["id","verdict","note","evidence"])||!category.criteria.some(x=>x.id===c.id)||seen.has(c.id)||!["meets","below","unknown"].includes(c.verdict)||!bounded(c.note,20))throw Error("INVALID_CRITERION_REVIEW");seen.add(c.id);proof(c.evidence,qualified);}
 const refs=new Set(categoryReferences(category,baseline).map(x=>x.url)),seenRefs=new Set<string>(),samples=new Set<string>();
 for(const c of r.comparisons){if(!object(c)||!keys(c,["referenceUrl","sampleUrl","note"])||!refs.has(c.referenceUrl)||!bounded(c.note,40)||!relatedResourceUrl(c.sampleUrl,resourceUrls)||new URL(c.sampleUrl).protocol!=="https:"||resourceUrls.some(u=>relatedResourceUrl(c.referenceUrl,[u])))throw Error("CATEGORY_COMPARISON_REQUIRED");seenRefs.add(c.referenceUrl);samples.add(new URL(c.sampleUrl).href);}
 if(qualified&&(r.access.mode!=="unmetered-free"||!bounded(r.access.scope,40)||!bounded(r.relevance,40)||category.criteria.some(c=>!r.criteria.some(x=>x.id===c.id&&x.verdict==="meets"))||seenRefs.size<2||samples.size<2))throw Error("QUALITY_NOT_ESTABLISHED: verify free ongoing core use, each category criterion, and two matching reference comparisons");
 return structuredClone(r);
}
