import type {EntityRecord} from "./contracts.ts";

export interface NoteMapping {
  version:1;
  titleField:string;
  properties:Record<string,string>;
  sections:{assessment:boolean;attributes:boolean;provenance:boolean};
}
/** Portable, declarative and source-independent Markdown mapping. */
export const DEFAULT_NOTE_MAPPING:NoteMapping={
  version:1,titleField:"title",properties:{},
  sections:{assessment:true,attributes:true,provenance:true}
};
export const DEFAULT_NOTE_MAPPING_JSON=JSON.stringify(DEFAULT_NOTE_MAPPING,null,2);
const safeField=/^(?:projectId|key|type|title|url|category|score|confidence|review|updatedAt|observationCount|attributes(?:\.[A-Za-z_][A-Za-z0-9_-]{0,63}){1,5})$/;
const unsafe=new Set(["__proto__","prototype","constructor"]);
const reserved=new Set(["type","project","identity","entity_type","title","category","review",
  "score","confidence","observation_count","updated_at"]);
function validPath(value:unknown):string {
  if(typeof value!=="string"||value.length>300||!safeField.test(value)||
    value.split(".").some(token=>unsafe.has(token))){
    throw Error("Mapping field must use an allowed public entity field or attributes.a.b");
  }
  return value;
}
export function parseNoteMapping(text:string):NoteMapping {
  if(typeof text!=="string"||Buffer.byteLength(text,"utf8")>12000)
    throw Error("Mapping JSON exceeds 12 KB");
  let input:unknown;
  try{input=JSON.parse(text);}catch{throw Error("Invalid mapping JSON");}
  if(!input||typeof input!=="object"||Array.isArray(input))throw Error("Invalid mapping object");
  const data=input as Record<string,unknown>;
  if(data.version!==1)throw Error("Unsupported note mapping version");
  const titleField=validPath(data.titleField??"title");
  const properties=data.properties??{};
  if(!properties||typeof properties!=="object"||Array.isArray(properties))
    throw Error("Note properties must be a JSON object");
  const keys=Object.keys(properties);
  if(keys.length>20)throw Error("Too many mapped note properties");
  const mapped:Record<string,string>=Object.create(null) as Record<string,string>;
  for(const key of keys){
    if(!/^[a-z][a-z0-9_]{1,63}$/.test(key)||reserved.has(key)||unsafe.has(key))
      throw Error("Invalid or reserved note property: "+key);
    mapped[key]=validPath((properties as Record<string,unknown>)[key]);
  }
  const sections=data.sections??{};
  if(!sections||typeof sections!=="object"||Array.isArray(sections))
    throw Error("Mapping sections must be an object");
  const values=sections as Record<string,unknown>;
  const value=(name:keyof NoteMapping["sections"]):boolean=>{
    const raw=values[name];
    if(raw===undefined)return true;
    if(typeof raw!=="boolean")throw Error("Invalid mapping section toggle");
    return raw;
  };
  return {version:1,titleField,properties:mapped,
    sections:{assessment:value("assessment"),attributes:value("attributes"),provenance:value("provenance")}};
}
export function mappedEntityField(entity:EntityRecord,path:string):unknown {
  const valid=validPath(path);
  let value:unknown=entity;
  for(const key of valid.split(".")){
    if(!value||typeof value!=="object"||
      !Object.prototype.hasOwnProperty.call(value,key))return undefined;
    value=(value as Record<string,unknown>)[key];
  }
  return value;
}
