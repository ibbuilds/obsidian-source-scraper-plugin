/**
 * Source Scraper's public version-1 interchange contract.
 * Runtime validation is deliberately independent from engine internals.
 */
export interface EntityRecord {
  projectId:string;
  key:string;
  type:string;
  title:string;
  url?:string;
  attributes:Record<string,unknown>;
  category:string;
  score:number;
  confidence:number;
  reasons:string[];
  review:"pending"|"approved"|"rejected";
  updatedAt:string;
  observationCount:number;
  provenance?:{
    mentions:Record<string,unknown>[];
    reviews:Record<string,unknown>[];
    assessmentHistory:Record<string,unknown>[];
    mentionsTruncated:boolean;
  };
}
export interface EntityExport {
  schemaVersion:1;
  dataset:"entities";
  projectId:string;
  exportedAt?:string;
  records:EntityRecord[];
}
export const MAX_BYTES=8_000_000;
export const MAX_RECORDS=5000;
const id=/^[a-z][a-z0-9_-]{1,63}$/;
const unsafeKey=new Set(["__proto__","constructor","prototype"]);
const secretQuery=/(?:^|[_-])(?:token|accesskey|apikey|api[_-]?key|key|secret|password|passwd|pwd|session|sessionid|auth|authorization|jwt|signature|sig|cookie)(?:$|[_-])/i;
/** Match credential names without treating metrics such as sessionCount as secrets. */
export function isCredentialKey(key:string):boolean{
  const words=key.replace(/([a-z0-9])([A-Z])/g,"$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g,"$1_$2");
  return /(?:^|[_-])(?:api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|(?:access|refresh|auth|id)token|token|secret|password|passwd|pwd|session(?:[_-]?id)?|auth|authorization|jwt|signature|sig|cookie)$/i.test(words);
}
function fail(reason:string):never{throw new Error("Invalid Source Scraper export: "+reason);}
function object(v:unknown,label:string):Record<string,unknown>{
  if(v===null||typeof v!=="object"||Array.isArray(v))fail(label+" must be an object");
  return v as Record<string,unknown>;
}
function str(v:unknown,label:string,max=2000):string{
  if(typeof v!=="string"||v.length===0||v.length>max||/[\u0000-\u0008\u000B\u000E-\u001F]/.test(v))
    fail(label+" must be nonempty bounded text");
  return v;
}
function jsonSafe(value:unknown,depth=0):void{
  if(depth>12)fail("nested data exceeds 12 levels");
  if(value===null||typeof value==="boolean"||typeof value==="string") {
    if(typeof value==="string"&&value.length>20000)fail("field too long");
    return;
  }
  if(typeof value==="number"&&Number.isFinite(value))return;
  if(Array.isArray(value)){
    if(value.length>500)fail("array is too large");
    for(const item of value)jsonSafe(item,depth+1);
    return;
  }
  const record=object(value,"nested field");
  const keys=Object.keys(record);
  if(keys.length>150)fail("object has too many fields");
  for(const key of keys){
    if(key.length>120||unsafeKey.has(key))fail("unsafe property key");
    jsonSafe(record[key],depth+1);
  }
}
export function checkedUrl(value:unknown,label="URL"):string|undefined{
  if(value===undefined||value===null||value==="")return undefined;
  const input=str(value,label,3000);
  let url:URL;
  try{url=new URL(input);}
  catch{fail(label+" is not a valid URL");}
  if(!["https:","http:"].includes(url.protocol)||url.username||url.password)
    fail(label+" uses unsafe URL credentials or protocol");
  const checkParameters=(params:URLSearchParams):void=>{
    for(const key of params.keys())if(secretQuery.test(key)||isCredentialKey(key))
      fail(label+" contains credential-like URL parameters");
  };
  checkParameters(url.searchParams);
  // OAuth responses can carry credentials in a fragment rather than a query.
  // Keep ordinary document anchors and text fragments usable.
  const fragment=url.hash.slice(1);
  const fragmentParameters=fragment.includes("?")?fragment.slice(fragment.indexOf("?")+1):fragment;
  if(fragmentParameters.includes("="))checkParameters(new URLSearchParams(fragmentParameters));
  if(/[\u0000-\u001F<>]/.test(input))fail(label+" has unsupported characters");
  return url.toString();
}
function recordsArray(value:unknown,label:string,max:number):Record<string,unknown>[]{
  if(!Array.isArray(value)||value.length>max)fail(label+" must be a bounded array");
  for(const item of value){object(item,label+" item");jsonSafe(item);}
  return value as Record<string,unknown>[];
}
function readEntity(raw:unknown,projectId:string):EntityRecord{
  const value=object(raw,"entity");
  const ownProject=str(value.projectId,"entity projectId",64);
  if(!id.test(ownProject)||ownProject!==projectId)fail("entity belongs to a different project");
  const key=str(value.key,"entity key",1000);
  const type=str(value.type,"entity type",64);
  if(!id.test(type))fail("invalid entity type");
  const title=str(value.title,"entity title",2000);
  const attributes=object(value.attributes,"attributes");
  jsonSafe(attributes);
  const category=str(value.category,"category",100);
  const score=value.score,confidence=value.confidence;
  if(typeof score!=="number"||!Number.isFinite(score)||score<0||score>100||
    typeof confidence!=="number"||!Number.isFinite(confidence)||confidence<0||confidence>1)
    fail("score or confidence is outside its range");
  const review=value.review;
  if(!["pending","approved","rejected"].includes(String(review)))fail("invalid review decision");
  const reasons=value.reasons;
  if(!Array.isArray(reasons)||reasons.length>30||reasons.some(x=>typeof x!=="string"||x.length>2000))
    fail("invalid assessment reasons");
  const count=value.observationCount;
  if(!Number.isSafeInteger(count)||Number(count)<0)fail("invalid observation count");
  const updatedAt=str(value.updatedAt,"updatedAt",100);
  const url=checkedUrl(value.url,"entity URL");
  let provenance:EntityRecord["provenance"];
  if(value.provenance!==undefined){
    const p=object(value.provenance,"provenance");
    if(typeof p.mentionsTruncated!=="boolean")fail("invalid provenance truncated status");
    provenance={mentions:recordsArray(p.mentions,"mentions",50),
      reviews:recordsArray(p.reviews,"reviews",30),
      assessmentHistory:recordsArray(p.assessmentHistory,"assessment history",30),
      mentionsTruncated:p.mentionsTruncated};
  }
  return {projectId,key,type,title,url,attributes,category,score,confidence,
    reasons:reasons as string[],review:review as EntityRecord["review"],
    updatedAt,observationCount:count as number,provenance};
}
function envelope(source:unknown):EntityExport{
  const data=object(source,"envelope");
  if(data.schemaVersion!==1)fail("unsupported schemaVersion; expected 1");
  if(data.dataset!=="entities")fail("dataset must be entities for note import");
  const projectId=str(data.projectId,"projectId",64);
  if(!id.test(projectId))fail("invalid projectId");
  const records=data.records;
  if(!Array.isArray(records)||records.length>MAX_RECORDS)fail("record limit exceeded (5000)");
  if(data.count!==undefined&&data.count!==records.length)fail("envelope count does not match records");
  const exportedAt=data.exportedAt===undefined?undefined:str(data.exportedAt,"exportedAt",100);
  const seen=new Set<string>();
  const validated=records.map(raw=>{
    const e=readEntity(raw,projectId);
    if(seen.has(e.key))fail("duplicate entity key");
    seen.add(e.key);
    return e;
  });
  return {schemaVersion:1,dataset:"entities",projectId,exportedAt,records:validated};
}
export function parseExport(content:string):EntityExport{
  if(typeof content!=="string")fail("file is empty");
  if(Buffer.byteLength(content,"utf8")>MAX_BYTES)fail("file exceeds 8 MB");
  if(!content.trim())fail("file is empty");
  let value:unknown;
  const trimmed=content.trim();
  try{value=JSON.parse(trimmed);}
  catch{
    // Each NDJSON line contains one v1 record and its own project identity.
    const lines=trimmed.split(/\r?\n/);
    if(lines.length>MAX_RECORDS)fail("NDJSON exceeds 5000 records");
    const records:unknown[]=[];
    let projectId:string|undefined;
    for(const [n,line] of lines.entries()){
      if(!line.trim())fail("blank NDJSON line "+(n+1));
      let data:Record<string,unknown>;
      try{data=object(JSON.parse(line),"NDJSON line "+(n+1));}
      catch{fail("invalid NDJSON line "+(n+1));}
      if(data.schemaVersion!==1||data.dataset!=="entities")fail("unsupported NDJSON version or dataset");
      const current=str(data.projectId,"NDJSON projectId",64);
      if(projectId!==undefined&&projectId!==current)fail("mixed NDJSON projects");
      projectId=current;
      records.push(data.record);
    }
    value={schemaVersion:1,dataset:"entities",projectId,count:records.length,records};
  }
  // A valid NDJSON export can contain exactly one JSON object. It parses as
  // ordinary JSON, so recognize its singular "record" envelope explicitly.
  if(value!==null&&typeof value==="object"&&!Array.isArray(value)){
    const item=value as Record<string,unknown>;
    if(Object.prototype.hasOwnProperty.call(item,"record")&&
      !Object.prototype.hasOwnProperty.call(item,"records")){
      value={schemaVersion:item.schemaVersion,dataset:item.dataset,
        projectId:item.projectId,count:1,records:[item.record]};
    }
  }
  return envelope(value);
}
