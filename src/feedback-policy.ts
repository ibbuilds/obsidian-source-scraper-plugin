import {parseCurationPolicy,type CurationPolicy} from "./curation-policy.ts";
import {createHash} from "node:crypto";

export const RESOURCE_POLICY="resource-rules-v1" as const;
export const OPTIONAL_CHECKS=["reusableOutput","freeAccess","documentation","automatedChecks","examples","activeSource"] as const;
export const LOCAL_CHECKS=["focus",...OPTIONAL_CHECKS,"suitablePost"] as const;
export type LocalCheckName=typeof LOCAL_CHECKS[number];
/** User-owned data. No topic or quality requirements are supplied by the application. */
export interface FeedbackProfile {
 curation?:CurationPolicy;
 referencePaths?:string[];
 version:1;includeTerms:string[];reuseTerms:string[];excludeTerms:string[];blockedPostTerms:string[];
 requiredChecks:Array<typeof OPTIONAL_CHECKS[number]>;
}
export function parseFeedbackProfile(input:unknown):FeedbackProfile {
 if(!input||typeof input!=="object"||Array.isArray(input))throw Error("Invalid feedback criteria");
 const value=input as Record<string,unknown>;
 if(value.version!==1||Object.keys(value).some(k=>!["curation","referencePaths","version","includeTerms","reuseTerms","excludeTerms","blockedPostTerms","requiredChecks"].includes(k)))throw Error("Unsupported feedback criteria");
 const terms=(key:string)=>{const items=value[key];if(!Array.isArray(items)||items.length>64||items.some(s=>typeof s!=="string"||!s.trim()||s.length>128))throw Error("Invalid feedback terms: "+key);return [...new Set((items as string[]).map(s=>s.trim().toLowerCase()))].sort();};
 if(!Array.isArray(value.requiredChecks)||value.requiredChecks.length>OPTIONAL_CHECKS.length||value.requiredChecks.some(k=>!OPTIONAL_CHECKS.includes(k)))throw Error("Invalid feedback requirements");
 if(value.referencePaths!==undefined&&(!Array.isArray(value.referencePaths)||value.referencePaths.length>25||value.referencePaths.some(p=>typeof p!=="string"||!p.trim()||p.length>1000||p.startsWith("/")||p.includes("..")||p.includes(":"))))throw Error("Invalid reference paths");
 return {...(value.curation!==undefined?{curation:parseCurationPolicy(value.curation)}:{}),...(value.referencePaths?{referencePaths:[...new Set(value.referencePaths as string[])].sort()}:{}),version:1,includeTerms:terms("includeTerms"),reuseTerms:terms("reuseTerms"),excludeTerms:terms("excludeTerms"),blockedPostTerms:terms("blockedPostTerms"),requiredChecks:[...new Set(value.requiredChecks)].sort()};
}
export function parseFeedbackProfiles(raw:string):Record<string,FeedbackProfile> {
 if(raw.length>1_000_000)throw Error("Feedback criteria limit");
 const input=JSON.parse(raw);if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).length>100)throw Error("Invalid feedback profiles");
 return Object.fromEntries(Object.entries(input).map(([id,value])=>{if(!/^[a-z][a-z0-9_-]{1,63}$/.test(id))throw Error("Invalid feedback project");return [id,parseFeedbackProfile(value)];}));
}
export const feedbackProfileHash=(projectId:string,profile:FeedbackProfile)=>createHash("sha256").update(JSON.stringify({projectId,profile:parseFeedbackProfile(profile)})).digest("hex");
export function matchesTerms(text:string,terms:readonly string[]){return terms.some(term=>new RegExp("(?:^|[^\\p{L}\\p{N}_])"+term.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"(?=$|[^\\p{L}\\p{N}_])","iu").test(text));}
export interface LocalResourceCheck {
 policy:typeof RESOURCE_POLICY;profileHash:string;fingerprint:string;eligible:boolean;postSuitable:boolean;
 requiredChecks:LocalCheckName[];checks:Record<LocalCheckName,boolean>;reasons:string[];evidence:Array<{url:string;quote:string}>;
 checkedAt:string;expiresAt:string;relatedResources?:string[];
}
export interface PublicResourceEvidence {
 version:1;url:string;checkedAt:string;status:"checked"|"pending";reason?:string;retryAfterSeconds?:number;rateLimited?:boolean;
 repository?:{url:string;name:string;description:string;topics:string[];license:string;openSource:boolean;archived:boolean;disabled:boolean;homepage:string};
 rootEntries?:string[];readme?:string;
 package?:{name:string;description:string;main:string;module:string;exports:boolean;bin:boolean;workspaces:boolean;testScript:string};
 evidence:Array<{url:string;quote:string}>;
}
export function hasMixedRepositories(urls:readonly string[]){const repos=new Set<string>();for(const raw of urls){try{const url=new URL(raw);if(url.hostname==="github.com"){const parts=url.pathname.split("/").filter(Boolean);if(parts.length>=2)repos.add(parts.slice(0,2).join("/").replace(/\.git$/i,"").toLowerCase());}}catch{return true;}}return repos.size>1;}
export function relatedResourceUrl(raw:string,related:readonly string[]){
 try{const url=new URL(raw);if(!["https:","http:"].includes(url.protocol)||url.username||url.password)return false;return related.some(value=>{const base=new URL(value);if(url.hostname!==base.hostname||url.port!==base.port)return false;const path=base.pathname.replace(/\/+$/,"")||"/";return path==="/"||url.pathname.replace(/\/+$/,"")===path||url.pathname.startsWith(path+"/");});}catch{return false;}
}
/** User topics select candidates; only verified evidence can authorize feedback. */
export function resourceCandidate(entity:{title:string;attributes:Record<string,unknown>},profile:FeedbackProfile){const text=entity.title+" "+String(entity.attributes.description??"")+" "+String(entity.attributes.discoveryText??"");return (!profile.includeTerms.length||matchesTerms(text,profile.includeTerms))&&!matchesTerms(text,profile.excludeTerms);}
/** Evaluates explicit local criteria. No aesthetics, human decisions or AI records. */
export function checkResource(entity:{attributes:Record<string,unknown>},fingerprint:string,proof:PublicResourceEvidence,profile:FeedbackProfile,profileHash:string,now=Date.now(),postUrls?:string[]):LocalResourceCheck {
 const repo=proof.repository,p=proof.package,readme=proof.readme??"",entries=proof.rootEntries??[];
 const scope=[repo?.description,...repo?.topics??[],p?.description,readme.slice(0,3000)].join(" ");
 const relatedResources=[...new Set([proof.url,repo?.url,repo?.homepage].filter((url):url is string=>typeof url==="string"&&/^https?:\/\//.test(url)))];
 const checks:Record<LocalCheckName,boolean>={
  focus:Boolean(repo)&&(!profile.includeTerms.length||matchesTerms(scope,profile.includeTerms))&&!matchesTerms(scope,profile.excludeTerms),
  reusableOutput:(Boolean(p&&(p.main||p.module||p.exports||p.bin||p.workspaces))||entries.some(s=>/^(?:src|lib|include|skills?|SKILL\.md)$/.test(s)))&&(!profile.reuseTerms.length||matchesTerms(scope,profile.reuseTerms)),
  freeAccess:repo?.openSource===true&&Boolean(repo.license),
  documentation:/^#{1,4}\s/m.test(readme)&&/```/.test(readme)&&/\b(?:installation|install|usage|getting started|quick start|how to use|instala\S*|uso)\b/i.test(readme),
  automatedChecks:Boolean(p&&/(?:\b(?:vitest|jest|playwright|pytest|mocha|ava|bun test|node\s+(?:--[\w-]+\s+)*--test|cargo test)\b|\bnode\s+[\w./-]*(?:test|check)[\w./-]*\.(?:mjs|cjs|js|ts)\b|\b(?:turbo|nx|npm|pnpm|yarn)\b[^;]*\btest\b)/.test(p.testScript)&&!/(?:no test specified|echo\s+["']?test)/i.test(p.testScript)&&entries.some(s=>/^(?:tests?|__tests__|packages)$/.test(s))),
  examples:/\b(?:examples?|demo|storybook|screenshots?|preview)\b/i.test(readme)&&/(?:!\[[^\]]*\]\(|https:\/\/)/.test(readme),
  activeSource:Boolean(repo&&!repo.archived&&!repo.disabled),
  suitablePost:Boolean(postUrls?.length)&&postUrls!.every(url=>relatedResourceUrl(url,relatedResources))&&String(entity.attributes.discoveryText??"").length>0&&!matchesTerms(String(entity.attributes.discoveryText??""),profile.blockedPostTerms)
 };
 const requiredChecks:LocalCheckName[]=["focus",...profile.requiredChecks,"suitablePost"];
 const eligible=proof.status==="checked"&&requiredChecks.every(k=>checks[k]);
 const reasons=requiredChecks.filter(k=>!checks[k]).map(k=>`Needs verification: ${k}`);if(proof.reason)reasons.unshift(proof.reason);
 if(eligible)reasons.push("Configured resource checks passed. Structural evidence does not certify aesthetics or upstream test results.");
 return {policy:RESOURCE_POLICY,profileHash,requiredChecks,fingerprint,eligible,postSuitable:eligible&&checks.suitablePost,checks,reasons,evidence:proof.evidence.slice(0,12),relatedResources,checkedAt:new Date(now).toISOString(),expiresAt:new Date(now+(eligible?86400000:(proof.retryAfterSeconds??3600)*1000)).toISOString()};
}
