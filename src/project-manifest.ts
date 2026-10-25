import {checkedUrl} from "./contracts.ts";
import {folderPath} from "./render.ts";
import {createOnlyDocument,type VaultLike} from "./vault-writer.ts";

/** A generic project manifest; actual adapters and processors are validated by the engine. */
export interface ProjectManifest {
  id:string;
  name:string;
  sources:Array<{id:string;adapter:string;config:Record<string,unknown>}>;
  pipeline:string[];
  evaluator:string;
  policy:{includeKeywords:string[];excludeKeywords:string[];minimumScore:number};
  outputs:Array<{id:string;adapter:string;config:Record<string,unknown>}>;
  watch?:unknown;
  entitySchemas?:unknown;
}
const idPattern=/^[a-z][a-z0-9_-]{1,63}$/;
const sensitiveKey=/(?:^|[_-])(?:api[_-]?key|secret|token|password|passwd|cookie|session|authorization|auth)(?:$|[_-])/i;
function object(value:unknown,label:string):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))
    throw Error("Project "+label+" must be an object");
  return value as Record<string,unknown>;
}
function ident(value:unknown,label:string):string{
  if(typeof value!=="string"||!idPattern.test(value))throw Error("Invalid project "+label);
  return value;
}
function array(value:unknown,name:string,max:number):unknown[]{
  if(!Array.isArray(value)||value.length>max)throw Error("Invalid "+name+" (max "+max+")");
  return value;
}
function safe(value:unknown,depth=0):void{
  if(depth>12)throw Error("Project JSON is too deeply nested");
  if(typeof value==="string"){
    if(value.length>20000)throw Error("Project field is too long");
    if(/^https?:\/\//i.test(value))checkedUrl(value,"project URL");
    return;
  }
  if(value===null||typeof value==="boolean"||
    (typeof value==="number"&&Number.isFinite(value)))return;
  if(Array.isArray(value)){
    if(value.length>500)throw Error("Project array too large");
    for(const part of value)safe(part,depth+1);
    return;
  }
  const entries=Object.entries(object(value,"value"));
  if(entries.length>150)throw Error("Project object has too many properties");
  for(const [key,item] of entries){
    if(!key||key.length>120||["__proto__","constructor","prototype"].includes(key))
      throw Error("Unsafe project JSON property");
    if(sensitiveKey.test(key))throw Error("Credentials must not be stored in a vault manifest");
    safe(item,depth+1);
  }
}
function keywords(value:unknown,label:string):string[]{
  const words=array(value,label,60);
  const result:string[]=[];
  const seen=new Set<string>();
  for(const raw of words){
    if(typeof raw!=="string"||raw.length>100||!raw.trim())
      throw Error("Invalid "+label+" term");
    const word=raw.trim(),norm=word.toLowerCase();
    if(!seen.has(norm)){result.push(word);seen.add(norm);}
  }
  return result;
}
export const GENERIC_TEMPLATE=JSON.stringify({
  id:"my-research",name:"My research project",
  sources:[{id:"local",adapter:"json-file",config:{path:"./observations.json"}}],
  pipeline:["observation-entity"],evaluator:"keyword",
  policy:{includeKeywords:[],excludeKeywords:[],minimumScore:0},
  outputs:[]
},null,2);
export function parseProjectManifest(raw:string):ProjectManifest{
  if(typeof raw!=="string"||Buffer.byteLength(raw,"utf8")>200000)
    throw Error("Project JSON exceeds 200 KB");
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}catch{throw Error("Invalid project JSON");}
  safe(parsed);
  const v=object(parsed,"manifest");
  const id=ident(v.id,"id");
  if(typeof v.name!=="string"||!v.name.trim()||v.name.length>200)
    throw Error("Invalid project name");
  const sources=array(v.sources,"sources",30);
  if(sources.length<1)throw Error("Project requires at least one source");
  const outputs=array(v.outputs??[],"outputs",10);
  const connection=(value:unknown,kind:string)=>{
    const entry=object(value,kind);
    return {id:ident(entry.id,kind+" id"),adapter:ident(entry.adapter,kind+" adapter"),
      config:object(entry.config??{},kind+" config")};
  };
  const checkedSources=sources.map(v=>connection(v,"source"));
  const checkedOutputs=outputs.map(v=>connection(v,"output"));
  for(const items of [checkedSources,checkedOutputs]){
    if(new Set(items.map(v=>v.id)).size!==items.length)
      throw Error("Duplicate project connection IDs");
  }
  const pipeline=array(v.pipeline??["observation-entity"],"pipeline",25)
    .map(value=>ident(value,"pipeline step"));
  if(!pipeline.length)throw Error("Project pipeline cannot be empty");
  const evaluator=ident(v.evaluator??"keyword","evaluator");
  const p=object(v.policy??{},"policy");
  const minimum=p.minimumScore??0;
  if(typeof minimum!=="number"||!Number.isFinite(minimum)||minimum<0||minimum>100)
    throw Error("Invalid minimumScore");
  if(v.watch!==undefined){
    const watch=object(v.watch,"watch");
    array(watch.rules??[],"watch rules",40);
  }
  if(v.entitySchemas!==undefined)object(v.entitySchemas,"entitySchemas");
  return {...v,id,name:v.name.trim(),sources:checkedSources,pipeline,evaluator,
    policy:{...p,includeKeywords:keywords(p.includeKeywords??[],"includeKeywords"),
      excludeKeywords:keywords(p.excludeKeywords??[],"excludeKeywords"),minimumScore:minimum},
    outputs:checkedOutputs} as ProjectManifest;
}
export async function createNewProjectFile(vault:VaultLike,folder:string,raw:string,
  rootPath?:string):Promise<{path:string;created:boolean}>{
  const manifest=parseProjectManifest(raw);
  const selectedFolder=folderPath(folder);
  const path=selectedFolder+"/"+manifest.id+".json";
  const content=JSON.stringify(manifest,null,2)+"\n";
  return createOnlyDocument(vault,path,content,rootPath);
}
