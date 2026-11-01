import {createHash,randomUUID} from "node:crypto";
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,renameSync,writeFileSync} from "node:fs";
import {dirname,isAbsolute,join,relative,resolve,sep} from "node:path";
import {CliBridge,CliCommandError,type CliConfig} from "./cli-bridge.ts";
import {parseExport,type EntityExport} from "./contracts.ts";
import {parseProjectManifest} from "./project-manifest.ts";
import {parseNoteMapping} from "./note-mapping.ts";
import {selectedPlans} from "./vault-writer.ts";

const hash=(value:unknown)=>createHash("sha256").update(typeof value==="string"?value:JSON.stringify(value)).digest("hex");
export interface RegisteredProject {id:string;configPath:string;manifestHash:string}
export interface ProviderOptions {
  allowXProvider?:boolean;
  cliPath:string;cliHash:string;nodeExecutable:string;projects:RegisteredProject[];
  workspacePath:string;statePath:string;vaultPath:string;
  mapping:()=>string;pathExists:(path:string)=>boolean;stage:(value:EntityExport)=>void;
  checkRead:(path:string)=>void;
  readReference:(path:string)=>Promise<string>;
}
type Job={id:string;requestId:string;signature:string;projectId:string;state:string;startedAt:string;endedAt?:string;result?:unknown;error?:string};
type Queue={projectId:string;keys:string[]};
type State={version:1;projects:RegisteredProject[];jobs:Job[];queues:Queue[]};
const empty=():State=>({version:1,projects:[],jobs:[],queues:[]});
const string={type:"string",minLength:1,maxLength:4000};
const keys={type:"array",items:string,minItems:1,maxItems:200,uniqueItems:true};
const number={type:"integer",minimum:0,maximum:1000000};
type Definition={name:string;description:string;inputSchema:{type:"object";properties:Record<string,unknown>;required:string[];additionalProperties:false};annotations:{readOnlyHint:boolean;destructiveHint:boolean;openWorldHint:boolean}};
const definitions:Array<[string,string,Record<string,unknown>,string[],boolean]>=[
  ["capabilities","Read installed integration versions and locally granted capabilities.",{},[],true],
  ["list_projects","List locally registered projects; paths are not executable arguments.",{},[],true],
  ["validate_project","Validate a registered project without running sources.",{projectId:string},["projectId"],true],
  ["create_project","Explicitly create a safe project manifest in the registered workspace; never runs sources.",{manifest:{type:"object"}},["manifest"],false],
  ["run_project","Run authorized sources into engine SQLite only; never creates notes.",{projectId:string,requestId:string,pageSize:{...number,minimum:1,maximum:500},maxPages:{...number,minimum:1,maximum:1000}},["projectId","requestId"],false],
  ["get_run_status","Read a job status without starting or retrying it.",{jobId:string},["jobId"],true],
  ["cancel_run","Cancel the owned active job; preserve committed checkpoints.",{jobId:string},["jobId"],false],
  ["list_findings","Page registered project entities in engine score/key order. Filters apply before pagination.",{projectId:string,limit:{...number,minimum:1,maximum:500},offset:number,search:string,type:string,minScore:{...number,maximum:100}},["projectId"],true],
  ["inspect_finding","Read entity evidence, human reviews, evaluator history and evidence fingerprint.",{projectId:string,key:string},["projectId","key"],true],
  ["reprocess_project","Explicit offline reassessment; preserves human reviews and writes no notes.",{projectId:string,requestId:string},["projectId","requestId"],false],
  ["record_ai_assessment","Record an agent recommendation, never a human approval. Read selected references first.",{projectId:string,key:string,assessment:{type:"object"}},["projectId","key","assessment"],false],
  ["list_assessments","Read separate agent recommendations and their evidence freshness.",{projectId:string,key:string,limit:{...number,minimum:1,maximum:200},offset:number},["projectId","key"],true],
  ["stage_findings","Show selected candidates in the Obsidian review view, without creating notes.",{projectId:string,keys},["projectId","keys"],false],
  ["get_review_queue","Reload persistent candidate references and current evidence without collection.",{projectId:string},["projectId"],true],
  ["preview_selected_notes","Prepare Markdown drafts for ChatGPT. This project never writes vault notes; only the separate connector can write on user instruction.",{projectId:string,keys,folder:string},["projectId","keys","folder"],true]
];
function text(value:unknown,name:string,max=4000):string{
  if(typeof value!=="string"||!value.trim()||value.length>max)throw Error("INVALID_INPUT: "+name);
  return value;
}
function integer(value:unknown,fallback:number,min:number,max:number):number{
  if(value===undefined)return fallback;
  if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)throw Error("INVALID_INPUT: integer limit");
  return Number(value);
}
function selection(value:unknown):string[]{
  if(!Array.isArray(value)||!value.length||value.length>200)throw Error("INVALID_INPUT: select 1–200 keys");
  const result=value.map(v=>text(v,"key"));
  if(new Set(result).size!==result.length)throw Error("INVALID_INPUT: duplicate keys");
  if(Buffer.byteLength(JSON.stringify(result),"utf8")>12000)throw Error("OUTPUT_LIMIT: select fewer keys for the portable subprocess argument budget");
  return result;
}
function safePath(root:string,file:string):void{
  const lexicalRoot=resolve(root),lexicalFile=resolve(file),lexicalRelative=relative(lexicalRoot,lexicalFile);
  if(!lexicalRelative||lexicalRelative===".."||lexicalRelative.startsWith(".."+sep)||isAbsolute(lexicalRelative))
    throw Error("PROJECT_NOT_ALLOWED: file outside configured workspace");
  const base=realpathSync.native(root),target=realpathSync.native(file),rel=relative(base,target);
  if(!rel||rel===".."||rel.startsWith(".."+sep)||isAbsolute(rel))throw Error("PROJECT_NOT_ALLOWED: file outside workspace");
  // The trusted root may have a system alias (macOS /var -> /private/var).
  // Inspect descendants using the same lexical root instead of walking back
  // through unrelated ancestors between canonical and lexical path spellings.
  let current=lexicalRoot;
  for(const part of lexicalRelative.split(sep)){
    current=join(current,part);
    if(lstatSync(current).isSymbolicLink())throw Error("PROJECT_NOT_ALLOWED: linked project path");
  }
}
/** Shared by local setup and remote public-only project creation; always outside the vault. */
export function writeWorkspaceProject(workspacePath:string,vaultPath:string,manifest:ReturnType<typeof parseProjectManifest>):RegisteredProject{
  const vaultRoot=realpathSync.native(vaultPath),projectRoot=realpathSync.native(workspacePath);
  const inside=relative(vaultRoot,projectRoot);
  if(!inside||(!isAbsolute(inside)&&inside!==".."&&!inside.startsWith(".."+sep)))throw Error("WORKSPACE_IS_VAULT: project creation must stay outside user content");
  const folder=join(workspacePath,"created-projects");mkdirSync(folder,{recursive:true,mode:0o700});safePath(workspacePath,folder);
  const configPath=join(folder,manifest.id+".json"),raw=JSON.stringify(manifest,null,2)+"\n";
  writeFileSync(configPath,raw,{flag:"wx",mode:0o600});
  return {id:manifest.id,configPath,manifestHash:hash(raw)};
}

/** Composable provider using public CLI contracts, with no SQLite access. */
export class SourceScraperProvider {
  readonly apiVersion=1 as const;
  readonly id="source-scraper";
  readonly tools:Definition[]=definitions.map(([name,description,properties,required,readOnlyHint])=>({
    name:"source_scraper_"+name,description,inputSchema:{type:"object",properties,required,additionalProperties:false},
    annotations:{readOnlyHint,destructiveHint:false,openWorldHint:name==="run_project"}
  }));
  private state:State;
  private bridge=new CliBridge();
  private activeJob?:Job;
  private engineChecked=false;
  private engineCapabilities:string[]=[];
  private closed=false;
  private options:ProviderOptions;
  constructor(options:ProviderOptions){
    this.options=options;
    this.state=empty();
    if(existsSync(options.statePath)){
      const raw=readFileSync(options.statePath,"utf8");
      if(Buffer.byteLength(raw)>32_000_000)throw Error("STATE_LIMIT");
      const value=JSON.parse(raw) as State;
      if(value.version!==1||![value.projects,value.jobs,value.queues].every(Array.isArray))throw Error("STATE_UNSUPPORTED");
      this.state=value;
      for(const job of value.jobs)if(["queued","running","cancelling"].includes(job.state))job.state="interrupted";
    }
  }
  private persist():void{
    const raw=JSON.stringify(this.state);
    if(Buffer.byteLength(raw)>32_000_000)throw Error("STATE_LIMIT: archive state locally before continuing");
    mkdirSync(dirname(this.options.statePath),{recursive:true,mode:0o700});
    const tmp=this.options.statePath+"."+randomUUID()+".tmp";
    writeFileSync(tmp,raw,{flag:"wx",mode:0o600});renameSync(tmp,this.options.statePath);
  }
  dispose():void{this.closed=true;this.bridge.cancel();}
  private projects():RegisteredProject[]{return [...this.options.projects,...this.state.projects];}
  private project(id:unknown):{project:RegisteredProject;config:CliConfig}{
    const project=this.projects().find(p=>p.id===text(id,"projectId"));
    if(!project)throw Error("PROJECT_NOT_ALLOWED");
    safePath(this.options.workspacePath,project.configPath);
    const manifest=readFileSync(project.configPath,"utf8");
    if(hash(manifest)!==project.manifestHash)throw Error("SOURCE_NOT_TRUSTED: manifest changed; register locally again");
    const parsed=parseProjectManifest(manifest);
    if(parsed.id!==project.id)throw Error("PROJECT_MISMATCH");
    for(const source of parsed.sources){
      if(!["json-file","json-snapshot","rss","public-json","public-product","x-for-you"].includes(source.adapter))
        throw Error("SOURCE_NOT_TRUSTED: executable/custom source requires a separate locally reviewed capability");
      if(["json-file","json-snapshot"].includes(source.adapter)){
        const path=text(source.config.path,"source path");safePath(this.options.workspacePath,resolve(dirname(project.configPath),path));
      }
    }
    if(!isAbsolute(this.options.nodeExecutable)||hash(readFileSync(this.options.cliPath,"utf8"))!==this.options.cliHash)
      throw Error("CLI_NOT_TRUSTED: verify and register the CLI locally");
    return {project,config:{cliPath:this.options.cliPath,nodeExecutable:this.options.nodeExecutable,configPath:project.configPath,allowXProvider:this.options.allowXProvider===true}};
  }
  private async invoke(id:unknown,command:Parameters<CliBridge["invoke"]>[1],args:string[]=[]):Promise<any>{
    const {config}=this.project(id);
    if(!this.engineChecked){
      const version=await this.bridge.invoke(config,"version") as {name?:string;jsonSchemaVersion?:number;capabilities?:string[]};
      if(version.name!=="source-scraper"||version.jsonSchemaVersion!==1||
        !["agent-assessments-v1","selected-entity-export-v1"].every(c=>version.capabilities?.includes(c)))
        throw Error("SCHEMA_UNSUPPORTED: this provider requires agent-assessments-v1 and selected-entity-export-v1 CLI capabilities");
      this.engineChecked=true;
      this.engineCapabilities=version.capabilities??[];
    }
    if(command==="run"&&parseProjectManifest(readFileSync(config.configPath,"utf8")).sources.some(s=>s.adapter==="x-for-you")&&
      !this.engineCapabilities.includes("x-for-you-getxapi-v1"))throw Error("SCHEMA_UNSUPPORTED: X feed collection requires x-for-you-getxapi-v1");
    return this.bridge.invoke(config,command,["--config",config.configPath,...args]);
  }
  private async entities(projectId:unknown,selected:string[]):Promise<EntityExport>{
    const value=await this.invoke(projectId,"export",["--keys-json",JSON.stringify(selected)]);
    const exported=parseExport(JSON.stringify(value));
    if(exported.projectId!==projectId||exported.records.length!==selected.length)throw Error("PROJECT_MISMATCH");
    return exported;
  }
  private async start(args:Record<string,unknown>,command:"run"|"reprocess"):Promise<Job>{
    const {project}=this.project(args.projectId);
    const usesX=parseProjectManifest(readFileSync(project.configPath,"utf8")).sources.some(s=>s.adapter==="x-for-you");
    if(command==="run"&&usesX&&!this.options.allowXProvider)throw Error("X_PROVIDER_APPROVAL_REQUIRED: enable the local GetXAPI grant only after approving session disclosure and paid requests");
    if(command==="run"&&usesX&&args.pageSize!==undefined&&Number(args.pageSize)<100)throw Error("X_FEED_PAGE_SIZE: use at least 100");
    const requestId=text(args.requestId,"requestId",200),projectId=text(args.projectId,"projectId");
    const limits=command==="run"?["--page-size",String(integer(args.pageSize,100,1,500)),"--max-pages",String(integer(args.maxPages,100,1,1000))]:[];
    const signature=hash({projectId,command,limits});
    const prior=this.state.jobs.find(j=>j.requestId===requestId);
    if(prior){if(prior.signature!==signature)throw Error("REQUEST_CONFLICT");return prior;}
    if(this.bridge.running||this.activeJob)throw Error("BUSY");
    const job:Job={id:randomUUID(),requestId,signature,projectId,state:"running",startedAt:new Date().toISOString()};
    this.state.jobs.push(job);this.activeJob=job;this.persist();
    void this.invoke(projectId,command,limits).then(result=>{
      job.result=result;job.state=job.state==="cancelling"?"cancelled":"succeeded";
    },error=>{
      job.state=job.state==="cancelling"?"cancelled":"failed";
      job.error=error instanceof Error?error.message.slice(0,500):"Engine command failed or was interrupted";
      if(error instanceof CliCommandError&&error.output&&typeof error.output==="object"){
        const partial=error.output as {result?:unknown};
        if(JSON.stringify(partial.result??null).length<20000)job.result={partial:partial.result,exitCode:error.exitCode};
      }
    })
      .finally(()=>{job.endedAt=new Date().toISOString();this.activeJob=undefined;this.persist();});
    return {...job};
  }
  async execute(name:string,args:Record<string,unknown>):Promise<unknown>{
    if(this.closed)throw Error("PROVIDER_UNLOADED");
    const definition=this.tools.find(t=>t.name===name);
    if(!definition||!args||typeof args!=="object"||Array.isArray(args)||
      Object.keys(args).some(k=>!Object.hasOwn(definition.inputSchema.properties,k))||
      definition.inputSchema.required.some(k=>!Object.hasOwn(args,k)))throw Error("INVALID_INPUT");
    const operation=name.slice("source_scraper_".length);
    switch(operation){
      case "capabilities":return {apiVersion:1,entitySchemaVersion:1,projects:this.projects().length,noteWritesSupported:false,
        localAvailability:{workspace:existsSync(this.options.workspacePath),cli:existsSync(this.options.cliPath),node:existsSync(this.options.nodeExecutable)},
        limits:{queryRecords:500,selectedRecords:200,selectionBytes:12000,importBytes:8000000,assessmentBytes:12000},toolNames:this.tools.map(t=>t.name),
        sources:["json-file","json-snapshot","rss","public-json","public-product","x-for-you"],executableSources:false,
        xFeed:{provider:"getxapi",feed:"for-you",localGrant:this.options.allowXProvider===true,liveVerified:false,
          apiKeyConfigured:Boolean(process.env.SOURCE_SCRAPER_GETXAPI_API_KEY),accountSessionConfigured:Boolean(process.env.SOURCE_SCRAPER_X_ACCOUNT_SESSION),
          credentialDestination:"api.getxapi.com",documentedUsdPerRequest:0.001,maxPagesPerRun:10}};
      case "list_projects":return {projects:this.projects().map(p=>({id:p.id,configured:true}))};
      case "validate_project":return this.invoke(args.projectId,"validate");
      case "create_project":{
        const manifest=parseProjectManifest(JSON.stringify(args.manifest));
        if(this.projects().some(p=>p.id===manifest.id))throw Error("PROJECT_EXISTS");
        // A remotely authored manifest cannot grant local file or executable access.
        if(manifest.sources.some(s=>!["rss","public-json","public-product"].includes(s.adapter)))throw Error("SOURCE_NOT_TRUSTED: register local files/executables locally");
        const project=writeWorkspaceProject(this.options.workspacePath,this.options.vaultPath,manifest);this.state.projects.push(project);this.persist();
        return {projectId:project.id,created:true,ran:false};
      }
      case "run_project":return this.start(args,"run");
      case "reprocess_project":return this.start(args,"reprocess");
      case "get_run_status":{const job=this.state.jobs.find(j=>j.id===text(args.jobId,"jobId"));if(!job)throw Error("JOB_NOT_FOUND");return job;}
      case "cancel_run":{
        const job=this.state.jobs.find(j=>j.id===text(args.jobId,"jobId"));if(!job)throw Error("JOB_NOT_FOUND");
        if(job===this.activeJob){job.state="cancelling";this.persist();this.bridge.cancel();}return job;
      }
      case "list_findings":{
        const flags=["--limit",String(integer(args.limit,100,1,500)),"--offset",String(integer(args.offset,0,0,1000000))];
        for(const field of ["search","type"])if(args[field]!==undefined)flags.push("--"+field,text(args[field],field));
        if(args.minScore!==undefined)flags.push("--min-score",String(integer(args.minScore,0,0,100)));
        return this.invoke(args.projectId,"query",flags);
      }
      case "inspect_finding":return this.invoke(args.projectId,"inspect",["--key",text(args.key,"key")]);
      case "record_ai_assessment":{
        if(!args.assessment||typeof args.assessment!=="object"||Array.isArray(args.assessment))throw Error("INVALID_ASSESSMENT");
        const record=structuredClone(args.assessment) as Record<string,unknown>;
        if(Buffer.byteLength(JSON.stringify(record),"utf8")>12000)throw Error("OUTPUT_LIMIT: assessment exceeds the portable subprocess argument budget");
        if(!Array.isArray(record.references)||record.references.length>25)throw Error("INVALID_REFERENCES");
        for(const ref of record.references){
          const path=text(ref?.path,"reference path",1000);
          if(path.startsWith(".")||path.split(/[\\/]/).some(p=>p===".."||p.startsWith("."))||isAbsolute(path))throw Error("REFERENCE_NOT_ALLOWED");
          this.options.checkRead(path);
          const sha256=hash(await this.options.readReference(path));
          if(ref.sha256!==sha256)throw Error("STALE_REFERENCE");
        }
        return this.invoke(args.projectId,"assessment-record",["--key",text(args.key,"key"),"--record-json",JSON.stringify(record)]);
      }
      case "list_assessments":{
        const value=await this.invoke(args.projectId,"assessment-list",["--key",text(args.key,"key"),"--limit",String(integer(args.limit,50,1,200)),"--offset",String(integer(args.offset,0,0,1000000))]);
        for(const record of value.records){
          record.referencesStale=false;
          for(const ref of record.references??[]){
            try{this.options.checkRead(ref.path);if(hash(await this.options.readReference(ref.path))!==ref.sha256)record.referencesStale=true;}
            catch{record.referencesStale=true;}
          }
          record.stale=record.stale||record.referencesStale;
        }
        return value;
      }
      case "stage_findings":{
        const selected=selection(args.keys),value=await this.entities(args.projectId,selected);
        this.state.queues=this.state.queues.filter(q=>q.projectId!==value.projectId);
        this.state.queues.push({projectId:value.projectId,keys:selected});this.persist();this.options.stage(value);
        return {projectId:value.projectId,count:value.records.length,notesCreated:0};
      }
      case "get_review_queue":{
        const projectId=text(args.projectId,"projectId");this.project(projectId);
        const queue=this.state.queues.find(q=>q.projectId===projectId);
        return queue?this.entities(projectId,queue.keys):{projectId,records:[]};
      }
      case "preview_selected_notes":{
        const selected=selection(args.keys),value=await this.entities(args.projectId,selected),folder=text(args.folder,"folder"),mapping=this.options.mapping();
        const plans=selectedPlans(folder,value.records,parseNoteMapping(mapping));
        for(const plan of plans)this.options.checkRead(plan.path);
        const result={projectId:value.projectId,plans:plans.map(p=>({path:p.path,content:p.content,exists:this.options.pathExists(p.path)})),noteWritesSupported:false,notesCreated:0,
          nextAction:"Only ChatGPT may write via the existing Obsidian connector after the user explicitly orders it."};
        if(Buffer.byteLength(JSON.stringify(result),"utf8")>8000000)throw Error("OUTPUT_LIMIT: request fewer drafts");
        return result;
      }
      default:throw Error("UNKNOWN_TOOL");
    }
  }
  async restoreQueue():Promise<void>{
    const queue=this.state.queues.at(-1);if(!queue)return;
    this.options.stage(await this.entities(queue.projectId,queue.keys));
  }
}
