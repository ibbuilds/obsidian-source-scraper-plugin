import {parseProjectManifest,type ProjectManifest} from "./project-manifest.ts";
export interface FeedFilterForm {include:string;exclude:string;mode:"any"|"all";days:string;likes:string;reposts:string;pages:string;minimum:string}
export function feedFilterForm(project:ProjectManifest):FeedFilterForm{
  const obs=project.filters?.observation;
  return {include:obs?.includeTerms?.join(", ")??"",exclude:obs?.excludeTerms?.join(", ")??"",mode:obs?.includeMode??"any",
    days:String(obs?.dateRanges?.find(r=>r.field==="occurredAt"&&r.maxAgeDays!==undefined)?.maxAgeDays??""),
    likes:String(obs?.numericRanges?.find(r=>r.field==="attributes.metrics.likes"&&r.min!==undefined)?.min??""),
    reposts:String(obs?.numericRanges?.find(r=>r.field==="attributes.metrics.reposts"&&r.min!==undefined)?.min??""),
    minimum:String(project.policy.minimumScore),pages:String(project.sources.find(s=>s.adapter==="x-for-you-local")?.config.pagesPerRun??1)};
}
export function applyFeedFilterForm(project:ProjectManifest,form:FeedFilterForm):ProjectManifest{
  const next=structuredClone(project),filters=next.filters??{version:1 as const};
  const obs={...filters.observation};
  const terms=(s:string)=>s.split(/[,\n]/).map(v=>v.trim()).filter(Boolean);
  for(const [key,value] of [["includeTerms",form.include],["excludeTerms",form.exclude]] as const){const list=terms(value);if(list.length)obs[key]=list;else delete obs[key];}
  if(obs.includeTerms)obs.includeMode=form.mode;else delete obs.includeMode;
  const number=(value:string,label:string,min:number,max:number)=>{if(!value.trim())return undefined;const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error(label+": use a whole number from "+min+" to "+max+".");return n;};
  const days=number(form.days,"Maximum age",1,36500);
  // Keep fixed date boundaries and all ranges not owned by these controls.
  const dates=(obs.dateRanges??[]).flatMap(r=>{if(r.field!=="occurredAt")return [r];const copy={...r};delete copy.maxAgeDays;return copy.from||copy.to?[copy]:[];});
  if(days!==undefined)dates.push({field:"occurredAt",maxAgeDays:days});
  if(dates.length)obs.dateRanges=dates;else delete obs.dateRanges;
  const ranges=(obs.numericRanges??[]).flatMap(r=>{if(!["attributes.metrics.likes","attributes.metrics.reposts"].includes(r.field))return [r];return r.max===undefined?[]:[{field:r.field,max:r.max}];});
  for(const [field,value,label] of [["attributes.metrics.likes",form.likes,"Likes"],["attributes.metrics.reposts",form.reposts,"Reposts"]]){const min=number(value,label,0,Number.MAX_SAFE_INTEGER);if(min!==undefined)ranges.push({field,min});}
  if(ranges.length)obs.numericRanges=ranges;else delete obs.numericRanges;
  if(Object.keys(obs).length)filters.observation=obs;else delete filters.observation;
  // This screen collects links. Preserve any stricter existing type/domain rules.
  filters.entity={...filters.entity,types:filters.entity?.types??["web-resource"],requiredFields:[...new Set([...(filters.entity?.requiredFields??[]),"url"])]};
  next.filters=filters;
  next.policy.minimumScore=number(form.minimum,"Minimum score",0,100)??0;
  const pages=number(form.pages,"Pages",1,10);if(pages===undefined)throw Error("Enter 1 to 10 pages per collection.");
  for(const source of next.sources)if(source.adapter==="x-for-you-local")source.config.pagesPerRun=pages;
  return parseProjectManifest(JSON.stringify(next));
}
