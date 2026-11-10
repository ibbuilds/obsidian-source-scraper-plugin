import {validateQualityReview,type Qualification} from "./curation-policy.ts";
import {referenceBaseline,validateVisualReview,type ReferenceBaseline} from "./reference-quality.ts";
import {xPostContext,hasXSource} from "./adapter-policy.ts";
import {ResourceMemory,type Recommendation,type FeedbackAction} from "./resource-memory.ts";
import {FeedCycle} from "./feed-cycle.ts";
import {RESOURCE_POLICY,feedbackProfileHash,parseFeedbackProfile,resourceCandidate,checkResource,type FeedbackProfile,relatedResourceUrl,hasMixedRepositories,type PublicResourceEvidence} from "./feedback-policy.ts";
import {COLLECTION_FILTER_SCHEMA,parseCollectionFilters,compileCollectionFilters,usesThresholdFilters} from "./collection-filters.ts";
import {createHash,randomUUID} from "node:crypto";
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,renameSync,writeFileSync} from "node:fs";
import {dirname,isAbsolute,join,relative,resolve,sep} from "node:path";
import {CliBridge,CliCommandError,type CliConfig,type XLocalSession} from "./cli-bridge.ts";
import {parseExport,type EntityExport} from "./contracts.ts";
import {parseProjectManifest} from "./project-manifest.ts";
import {parseNoteMapping} from "./note-mapping.ts";
import {selectedPlans} from "./vault-writer.ts";

const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=(value:unknown)=>createHash("sha256").update(typeof value==="string"?value:JSON.stringify(value)).digest("hex");
export interface RegisteredProject {id:string;configPath:string;manifestHash:string}
export interface ProviderOptions {
  allowXProvider?:boolean;
  allowXLikes?:()=>boolean;
  localFeedbackEnabled?:()=>boolean;
  feedbackProfile?:(projectId:string)=>FeedbackProfile|undefined;
  activeProjectId?:()=>string|undefined;
  xPythonPath?:string;
  getXSession?:()=>XLocalSession|undefined;
  cliPath:string;cliHash:string;nodeExecutable:string;projects:RegisteredProject[];
  workspacePath:string;statePath:string;vaultPath:string;
  stageAuto?:(value:EntityExport)=>void;
  mapping:()=>string;pathExists:(path:string)=>boolean;stage:(value:EntityExport)=>void;
  checkRead:(path:string)=>void;
  readReference:(path:string)=>Promise<string>;
}
type Job={id:string;requestId:string;signature:string;projectId:string;state:string;startedAt:string;endedAt?:string;result?:unknown;error?:string};
type Queue={projectId:string;keys:string[]};
type ResourceRequest={requestId:string;projectId:string;signature:string;input:any;origin:"user-interface"|"user-mcp";result?:any;error?:string;terminal?:boolean};
type LocalFeedbackState={policy?:string;profileHash?:string;checked:number;eligible:number;pending:number;nextAt:number;publicNextAt?:number;lastError?:string;lastAt?:string;cursor?:{projectId:string;selectionId?:string;offset:number}};
type State={version:1;projects:RegisteredProject[];jobs:Job[];queues:Queue[];resourceRequests?:ResourceRequest[];localFeedback?:LocalFeedbackState};
const empty=():State=>({version:1,projects:[],jobs:[],queues:[]});
const string={type:"string",minLength:1,maxLength:4000};
const keys={type:"array",items:string,minItems:1,maxItems:200,uniqueItems:true};
const number={type:"integer",minimum:0,maximum:1000000};
type Definition={name:string;description:string;inputSchema:{type:"object";properties:Record<string,unknown>;required:string[];additionalProperties:false};annotations:{readOnlyHint:boolean;destructiveHint:boolean;openWorldHint:boolean}};
const definitions:Array<[string,string,Record<string,unknown>,string[],boolean]>=[
  ["get_resources","Start here: query admitted resources. Configured admission rules and failed-quality discard apply even to quality=all. Missing quality evidence never implies qualification. Returns total, stable selectionId and a page. Reuse selectionId for subsequent pages; use inspect_resources for evidence.",{projectId:string,selectionId:string,search:{type:"string",maxLength:1000},review:{type:"string",enum:["all","pending","approved","rejected"]},evaluation:{type:"string",enum:["all","recommended","pending","discarded"]},quality:{type:"string",enum:["all","qualified","pending","excluded"]},limit:{...number,minimum:1,maximum:500},offset:number,filters:COLLECTION_FILTER_SCHEMA},["projectId"],true],
  ["inspect_resources","Read evidence and fingerprints for up to 50 resource keys in one call. No collection or evaluation is started.",{projectId:string,keys:{...keys,maxItems:50}},["projectId","keys"],true],
  ["review_resources","Save explicit USER choices in one durable, replay-safe batch. Prefer changes listing the resources the user chose. Relevance alone never implies approval. A selectionId is allowed only when the user explicitly ordered an operation over that whole result set. To reconcile, resend projectId and requestId only. AI evaluations must use assess_resources. Never queues likes.",{projectId:string,requestId:string,selectionId:string,decision:{type:"string",enum:["pending","approved","rejected"]},reason:{type:"string",maxLength:1000},changes:{type:"array",minItems:1,maxItems:5000,items:{type:"object",additionalProperties:false,properties:{key:string,revision:string,decision:{type:"string",enum:["pending","approved","rejected"]},reason:{type:"string",maxLength:1000}},required:["key","decision"]}}},["projectId","requestId"],false],
  ["assess_resources","Record up to 50 evidence-based AI evaluations in one call, separate from human decisions. First inspect_resources and supply each current fingerprint. postSuitable and optional postId apply only to the X adapter; omit them for other sources.",{projectId:string,items:{type:"array",minItems:1,maxItems:50,items:{type:"object",properties:{key:string,postId:string,assessment:{type:"object"}},required:["key","assessment"],additionalProperties:false}}},["projectId","items"],false],

  ["qualify_resources","Save 1–50 category-specific evidence reviews; this is separate from Keep/Hide and AI recommendations. Read research_packet first for the configured policy hash, category criteria, reference baseline and resource fingerprint. Qualified requires ongoing unmetered free core use, all category criteria, and two matching reference/sample comparisons. Missing proof stays pending. Never queues likes or writes notes.",{projectId:string,items:{type:"array",minItems:1,maxItems:50,items:{type:"object",additionalProperties:false,properties:{key:string,review:{type:"object"}},required:["key","review"]}}},["projectId","items"],false],
  ["research_packet","Read a stable research selection in bounded packets with configured vault reference links and negative examples. No evaluation, note writing or likes. Use selectionId and nextOffset to work through up to 500 candidates.",{projectId:string,selectionId:string,offset:number,limit:{...number,minimum:1,maximum:50}},["projectId"],true],
  ["cycle_status","Read X feed cycle progress, budget and waiting reason. Other sources use run_project.",{},[],true],
  ["control_cycle","Start, resume, pause or stop a bounded X feed cycle. Only X adapter connections are collected; other adapters use run_project.",{projectId:string,action:{type:"string",enum:["start","pause","stop"]},maxPages:{...number,minimum:1,maximum:1000}},["projectId","action"],false],
  ["resource_decision","Persist an explicit user review, rejection, restoration or alias. Approve only on user instruction; automatic evaluations use assess_resource.",{projectId:string,key:string,action:{type:"string",enum:["reject","restore","alias","approve","pending"]},queueLike:{type:"boolean"},reason:{type:"string",maxLength:1000},alias:string},["projectId","key","action"],false],
  ["list_rejected","Read persistent rejected resources without recommending them.",{projectId:string},["projectId"],true],
  ["assess_resource","Record an AI's evidence-based resource evaluation, separate from human decisions. Only verified X-adapter posts may enter the like queue. Omit postSuitable/postId for other sources; never approve by keywords or counters.",{projectId:string,key:string,postId:string,assessment:{type:"object"}},["projectId","key","assessment"],false],
  ["feedback_status","Read X-adapter like requests, confirmations, errors and separate local permission.",{},[],true],
  ["control_feedback","Stop X feedback, or enable it only when an X adapter and separate local like permission are configured.",{enabled:{type:"boolean"}},["enabled"],false],
  ["capabilities","Read installed integration versions and locally granted capabilities.",{},[],true],
  ["list_projects","List locally registered projects; paths are not executable arguments.",{},[],true],
  ["validate_project","Validate a registered project without running sources.",{projectId:string},["projectId"],true],
  ["create_project","Explicitly create a safe project manifest in the registered workspace; never runs sources.",{manifest:{type:"object"}},["manifest"],false],
  ["run_project","Run authorized sources into engine SQLite only; never creates notes.",{projectId:string,requestId:string,pageSize:{...number,minimum:1,maximum:500},maxPages:{...number,minimum:1,maximum:1000},sourceIds:COLLECTION_FILTER_SCHEMA.properties.sourceIds},["projectId","requestId"],false],
  ["get_run_status","Read a job status without starting or retrying it.",{jobId:string},["jobId"],true],
  ["cancel_run","Cancel the owned active job; preserve committed checkpoints.",{jobId:string},["jobId"],false],
  ["list_findings","Page registered project entities in engine score/key order. Filters apply before pagination.",{projectId:string,limit:{...number,minimum:1,maximum:500},offset:number,search:string,type:string,evaluation:{type:"string",enum:["all","recommended","pending","discarded"]},minScore:{...number,maximum:100},filters:COLLECTION_FILTER_SCHEMA},["projectId"],true],
  ["inspect_finding","Read entity evidence, human reviews, evaluator history and evidence fingerprint.",{projectId:string,key:string},["projectId","key"],true],
  ["reprocess_project","Explicit offline reassessment; preserves human reviews and writes no notes.",{projectId:string,requestId:string},["projectId","requestId"],false],
  ["record_ai_assessment","Record an agent recommendation, never a human approval. Read selected references first.",{projectId:string,key:string,assessment:{type:"object"}},["projectId","key","assessment"],false],
  ["list_assessments","Read separate agent recommendations and their evidence freshness.",{projectId:string,key:string,limit:{...number,minimum:1,maximum:200},offset:number},["projectId","key"],true],
  ["stage_findings","Show selected candidates in the Obsidian review view, without creating notes.",{projectId:string,keys},["projectId","keys"],false],
  ["get_review_queue","Reload persistent candidate references and current evidence without collection.",{projectId:string},["projectId"],true],
  ["preview_selected_notes","Prepare Markdown drafts for manual use or optional AI assistance. This project never writes vault notes; only the separate connector can write on user instruction.",{projectId:string,keys,folder:string},["projectId","keys","folder"],true]
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

/** Fresh definitions for host registration, diagnostics and build-time inventory. */
export function sourceScraperToolDefinitions():Definition[]{
  const external=new Set(["run_project","control_cycle","resource_decision","assess_resource","assess_resources","control_feedback"]);
  return definitions.map(([name,description,properties,required,readOnlyHint])=>({
    name:"source_scraper_"+name,description,inputSchema:{type:"object",properties:structuredClone(properties),required:[...required],additionalProperties:false},
    annotations:{readOnlyHint,destructiveHint:false,openWorldHint:external.has(name)}
  }));
}

/** Composable provider using public CLI contracts, with no SQLite access. */
export class SourceScraperProvider {
  readonly apiVersion=1 as const;
  readonly id="source-scraper";
  readonly tools:Definition[]=sourceScraperToolDefinitions();
  private state:State;
  readonly memory:ResourceMemory;
  readonly cycle:FeedCycle;
  private feedbackTimer?:ReturnType<typeof setInterval>;
  private bridge=new CliBridge();
  private collectionBridge=new CliBridge();
  private evidenceBridge=new CliBridge();
  private localFeedbackBusy=false;
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
    }    this.memory=new ResourceMemory(join(dirname(options.statePath),"resources.json"));
    this.cycle=new FeedCycle(join(dirname(options.statePath),"cycle.json"),async cycle=>{
      if(this.activeJob||this.collectionBridge.running)throw Error("COLLECTOR_BUSY: retry after the current command");
      const manifest=parseProjectManifest(readFileSync(this.project(cycle.projectId).project.configPath,"utf8"));
      const xSources=manifest.sources.filter(s=>s.adapter==="x-for-you-local");if(!xSources.length||!this.options.allowXProvider)throw Error("X_LOCAL_APPROVAL_REQUIRED");
      let response:any;
      try{response=await this.invoke(cycle.projectId,"run",["--cycle-id",cycle.cycleId,"--max-pages",String(cycle.pagesPerBatch),"--page-size","100","--x-cycle","true","--source-ids-json",JSON.stringify(xSources.map(s=>s.id))],this.collectionBridge);}
      catch(error){if(error instanceof CliCommandError&&error.output)response=error.output;else throw error;}
      const runs=response?.result?.runs;if(!Array.isArray(runs))throw Error("INVALID_CYCLE_RESULT");
      if(runs.some(r=>r.endReason==="error"))throw Object.assign(Error(runs.find(r=>r.endReason==="error").error||"Feed failed"),{progress:{pages:runs.reduce((n,r)=>n+(r.pages||0),0),observations:response.result.observations,duplicates:response.result.duplicates}});
      if(!this.bridge.running&&this.options.stageAuto){try{const data=await this.execute("source_scraper_list_findings",{projectId:cycle.projectId,limit:100});this.options.stageAuto(parseExport(JSON.stringify(data)));}catch{/* Collection is committed; a busy review refresh can wait for the next batch. */}}
      return {pages:runs.reduce((n,r)=>n+(r.pages||0),0),observations:response.result.observations,duplicates:response.result.duplicates,endReason:runs.every(r=>r.endReason==="end-of-window"||r.endReason==="no-new-items")?(runs.some(r=>r.endReason==="no-new-items")?"no-new-items":"end-of-window"):"work-limit"};
    },()=>this.collectionBridge.cancel(),async state=>{
      const {config}=this.project(state.projectId);
      if(!existsSync(join(dirname(config.configPath),".source-scraper.sqlite")))return {pages:0,observations:0,duplicates:0};
      return this.invoke(state.projectId,"cycle-progress",["--cycle-id",state.cycleId],this.collectionBridge);
    });
    this.cycle.attach();
    this.feedbackTimer=setInterval(()=>{void this.feedbackTick();},10000);this.feedbackTimer.unref?.();
  }
  private persist():void{
    const raw=JSON.stringify(this.state);
    if(Buffer.byteLength(raw)>32_000_000)throw Error("STATE_LIMIT: archive state locally before continuing");
    mkdirSync(dirname(this.options.statePath),{recursive:true,mode:0o700});
    const tmp=this.options.statePath+"."+randomUUID()+".tmp";
    writeFileSync(tmp,raw,{flag:"wx",mode:0o600});renameSync(tmp,this.options.statePath);
  }
  dispose():void{this.closed=true;this.memory.close();this.cycle.dispose();this.collectionBridge.cancel();this.evidenceBridge.cancel();if(this.feedbackTimer)clearInterval(this.feedbackTimer);this.bridge.cancel();}
  private projects():RegisteredProject[]{return [...this.options.projects,...this.state.projects];}
  localProjects():RegisteredProject[]{return this.projects().map(p=>({...p}));}
  activity():{running:boolean;jobId?:string;lastState?:string;error?:string;projectId?:string}{
    const last=this.state.jobs.at(-1);return {running:Boolean(this.activeJob)||Boolean(this.cycle.snapshot().active),jobId:this.activeJob?.id,lastState:last?.state,error:last?.error,projectId:last?.projectId};
  }
  private project(id:unknown):{project:RegisteredProject;config:CliConfig}{
    const project=this.projects().find(p=>p.id===text(id,"projectId"));
    if(!project)throw Error("PROJECT_NOT_ALLOWED");
    safePath(this.options.workspacePath,project.configPath);
    const manifest=readFileSync(project.configPath,"utf8");
    if(hash(manifest)!==project.manifestHash)throw Error("SOURCE_NOT_TRUSTED: manifest changed; register locally again");
    const parsed=parseProjectManifest(manifest);
    if(parsed.id!==project.id)throw Error("PROJECT_MISMATCH");
    for(const source of parsed.sources){
      if(!["json-file","json-snapshot","rss","public-json","public-product","x-for-you-local"].includes(source.adapter))
        throw Error("SOURCE_NOT_TRUSTED: executable/custom source requires a separate locally reviewed capability");
      if(["json-file","json-snapshot"].includes(source.adapter)){
        const path=text(source.config.path,"source path");safePath(this.options.workspacePath,resolve(dirname(project.configPath),path));
      }
    }
    if(!isAbsolute(this.options.nodeExecutable)||hash(readFileSync(this.options.cliPath,"utf8"))!==this.options.cliHash)
      throw Error("CLI_NOT_TRUSTED: verify and register the CLI locally");
    const usesX=hasXSource(parsed);return {project,config:{cliPath:this.options.cliPath,nodeExecutable:this.options.nodeExecutable,configPath:project.configPath,allowXProvider:usesX&&this.options.allowXProvider===true,allowXLikes:usesX&&this.options.allowXLikes?.()===true&&this.memory.enabled,xPythonPath:usesX?this.options.xPythonPath:undefined,xSession:usesX?this.options.getXSession?.():undefined}};
  }
  private async invoke(id:unknown,command:Parameters<CliBridge["invoke"]>[1],args:string[]=[],lane:CliBridge=this.bridge):Promise<any>{
    const {config}=this.project(id);
    if(!this.engineChecked){
      const version=await lane.invoke(config,"version") as {name?:string;jsonSchemaVersion?:number;capabilities?:string[]};
      if(version.name!=="source-scraper"||version.jsonSchemaVersion!==1||
        !["agent-assessments-v1","selected-entity-export-v1"].every(c=>version.capabilities?.includes(c)))
        throw Error("SCHEMA_UNSUPPORTED: this provider requires agent-assessments-v1 and selected-entity-export-v1 CLI capabilities");
      this.engineChecked=true;
      this.engineCapabilities=version.capabilities??[];
    }
    const manifest=parseProjectManifest(readFileSync(config.configPath,"utf8"));
    if((manifest.filters||args.includes("--filters-json")||args.includes("--source-ids-json"))&&
      !this.engineCapabilities.includes("collection-filters-v1"))throw Error("SCHEMA_UNSUPPORTED: deterministic filters require collection-filters-v1");
    const filterFlag=args.indexOf("--filters-json");
    const requestedFilters=filterFlag<0?undefined:parseCollectionFilters(JSON.parse(args[filterFlag+1]),manifest.sources.map(s=>s.id));
    if((usesThresholdFilters(manifest.filters)||usesThresholdFilters(requestedFilters))&&!this.engineCapabilities.includes("candidate-thresholds-v1"))
      throw Error("SCHEMA_UNSUPPORTED: numeric/date filters require candidate-thresholds-v1");
    const sourceFlag=args.indexOf("--source-ids-json");
    const sources=compileCollectionFilters(manifest.sources.map(s=>s.id),manifest.filters,
      sourceFlag<0?undefined:{version:1,sourceIds:JSON.parse(args[sourceFlag+1])}).sourceIds;
    if((args.includes("--x-cycle")||command==="x-feedback")&&!this.engineCapabilities.includes(command==="x-feedback"?"x-likes-v1":"x-cycle-v1"))throw Error("SCHEMA_UNSUPPORTED: update the trusted engine before using cycles or likes");
    if(command==="run"&&manifest.sources.some(s=>sources.includes(s.id)&&s.adapter==="x-for-you-local")&&
      !this.engineCapabilities.includes("x-for-you-local-v1"))throw Error("SCHEMA_UNSUPPORTED: X feed collection requires x-for-you-local-v1");
    if(command==="resource-evidence"&&!this.engineCapabilities.includes("public-resource-evidence-v1"))throw Error("LOCAL_FEEDBACK_ENGINE_UPDATE_REQUIRED");
    return lane.invoke(command==="resource-evidence"?{...config,allowXProvider:false,allowXLikes:false,xPythonPath:undefined,xSession:undefined}:config,command,["--config",config.configPath,...args]);
  }
  private eligible(entity:{type:string;url?:string;review?:string},verifiedXPipeline=false){if(entity.type==="x-inspiration")return false;
    if(!entity.url)return entity.review!=="rejected";
    if(entity.review==="rejected"&&!this.memory.hasDecision("user",entity.url))this.memory.reject("user",entity.url,"Imported explicit stored human rejection","legacy-human-review");
    return !this.memory.rejected("user",entity.url);}
  private async matchesProfile(projectId:unknown,key:string){
    if(this.currentFeedbackProfile(String(projectId))?.profile.curation){const details=await this.inspectResources(String(projectId),[key]);return details.records.some((d:any)=>d.entity&&d.profileMatched&&!d.rejected&&d.resourceQuality?.decision!=="excluded");}
    const {project}=this.project(projectId),manifest=parseProjectManifest(readFileSync(project.configPath,"utf8"));
    const result=await this.invoke(projectId,"query",["--filters-json",JSON.stringify({version:1,entity:{fields:["key"],includeTerms:[key],matchMode:"substring"}}),"--limit","500"]);
    return result.records.some((e:EntityExport["records"][number])=>e.key===key&&this.eligible(e,manifest.pipeline.includes("x-discovery")));
  }
  async saveHumanReview(projectId:string,key:string,decision:"pending"|"approved"|"rejected",reason="",queueLike=false,origin:"user-interface"|"user-mcp"="user-interface"){
    this.requireRecoveredReviews();
    if(!["pending","approved","rejected"].includes(decision)||typeof reason!=="string"||reason.length>1000||typeof queueLike!=="boolean"||queueLike&&decision!=="approved")throw Error("INVALID_HUMAN_REVIEW");
    const before=await this.invoke(projectId,"inspect",["--key",key]);
    this.requireRecoveredReviews();
    if(!before.entity.url||before.entity.type!=="web-resource")throw Error("RESOURCE_LINK_REQUIRED");
    if(queueLike){this.resourcePostContext(projectId,before);if(!await this.matchesProfile(projectId,key))throw Error("RESOURCE_POST_PROVENANCE_REQUIRED");}
    this.requireRecoveredReviews();
    if(decision==="rejected")this.memory.reject("user",before.entity.url,reason,origin);
    await this.invoke(projectId,"review",["--key",key,"--decision",decision,"--reason",reason.trim()||`User marked this resource ${decision}.`]);
    const data=await this.invoke(projectId,"inspect",["--key",key]);
    const review=this.memory.recordHumanReview("user",data.entity.url,{decision,reason,fingerprint:data.fingerprint,postSuitable:queueLike,verifiedUsefulFreeAndQuality:queueLike,origin});
    const action=queueLike?this.queueResourcePost(projectId,key,data):undefined;
    return {review,action,notesCreated:0};
  }
  private queueResourcePost(projectId:string,key:string,data:any,requestedPostId?:string,origin?:"local-policy",profileHash?:string){
    const {postUrl,postId,accountId}=this.resourcePostContext(projectId,data,requestedPostId);
    return this.memory.queue("user",{resource:data.entity.url,projectId,key,postId,postUrl,accountId,postTextHash:hash(data.entity.attributes.discoveryText||""),fingerprint:data.fingerprint,...(origin?{origin,profileHash}:{})});
  }
  private resourcePostContext(projectId:string,data:any,requestedPostId?:string){
    const manifest=parseProjectManifest(readFileSync(this.project(projectId).project.configPath,"utf8")),context=xPostContext(manifest,data.entity,data.mentions??[],requestedPostId);
    if(!context)throw Error("RESOURCE_POST_PROVENANCE_REQUIRED: likes require a retained post from the X adapter");return context;
  }
  private localActionCurrent(a:FeedbackAction){return a.origin!=="local-policy"||Boolean(this.options.localFeedbackEnabled?.()&&(!this.options.activeProjectId||this.options.activeProjectId()===a.projectId)&&a.profileHash&&this.currentFeedbackProfile(a.projectId)?.hash===a.profileHash);}
  private async qualityBaseline(projectId:string):Promise<ReferenceBaseline|undefined>{const paths=this.currentFeedbackProfile(projectId)?.profile.referencePaths;if(!paths?.length)return;return referenceBaseline(paths,async path=>{this.options.checkRead(path);return this.options.readReference(path);});}
  private async validateQuality(projectId:string,assessment:any,url:string){
    if(assessment?.decision!=="recommended")return;
    const current=this.currentFeedbackProfile(projectId),baseline=await this.qualityBaseline(projectId);
    if(current?.profile.curation){
      const saved=this.memory.qualification(projectId,url);
      if(!baseline||!saved||saved.decision!=="qualified"||saved.fingerprint!==assessment.fingerprint||!this.qualificationCurrent(saved,current.hash,baseline.hash))throw Error("CATEGORY_QUALITY_REVIEW_REQUIRED");
      return;
    }
    if(baseline)validateVisualReview(assessment.visualReview,baseline,[url,...this.memory.localCheck("user",url)?.relatedResources??[]]);
  }
  private qualificationCurrent(saved:Qualification,profileHash:string,baselineHash:string){return saved.profileHash===profileHash&&saved.baselineHash===baselineHash&&Date.parse(saved.expiresAt)>Date.now();}
  async curationContext(projectId:string){
    this.project(projectId);const current=this.currentFeedbackProfile(projectId);if(!current?.profile.curation)throw Error("Configure selection criteria for this project first.");
    const baseline=await this.qualityBaseline(projectId);if(!baseline?.links.length)throw Error("Configure reference notes with category examples first.");
    return {policy:current.profile.curation,profileHash:current.hash,baseline};
  }
  async qualifyResources(args:any,origin:"user-interface"|"agent-mcp"="agent-mcp"){
    const projectId=text(args.projectId,"projectId");if(!Array.isArray(args.items)||!args.items.length||args.items.length>50||new Set(args.items.map((i:any)=>i.key)).size!==args.items.length||JSON.stringify(args).length>500000)throw Error("Select 1–50 distinct quality reviews");
    const context=await this.curationContext(projectId),details=await this.inspectResources(projectId,args.items.map((i:any)=>text(i.key,"key")));
    const records=args.items.map((item:any)=>{
      const d=details.records.find((r:any)=>r.key===item.key);
      if(!d?.entity?.url||d.rejected||!d.profileMatched)throw Error("RESOURCE_REJECTED_OR_OUTSIDE_FILTERS: "+item.key);
      const review=validateQualityReview(item.review,context.policy,context.profileHash,context.baseline,[d.entity.url,...d.localResourceCheck?.relatedResources??[]],d.fingerprint);
      const now=Date.now(),record:Qualification={...review,entityUpdatedAt:d.entity.updatedAt,at:new Date(now).toISOString(),expiresAt:new Date(now+context.policy.maxAgeDays*86400000).toISOString(),origin};
      return {key:item.key,url:d.entity.url,record};
    });
    if(this.currentFeedbackProfile(projectId)?.hash!==context.profileHash)throw Error("QUALITY_POLICY_CHANGED");
    this.memory.transaction(()=>{for(const r of records)this.memory.recordQualification(projectId,r.url,r.record);});
    return {projectId,records:records.map((r:any)=>({key:r.key,state:r.record.decision})),saved:records.length,humanReviewChanged:false,likesQueued:0,notesWritten:0};
  }
  private async dispatchFeedback(){
    if(this.closed||this.bridge.running||this.collectionBridge.running||this.activeJob||!this.options.allowXLikes?.())return;
    await this.memory.dispatch({
      stillValid:async a=>{if(!this.localActionCurrent(a))return false;const baseline=await this.qualityBaseline(a.projectId);if(this.currentFeedbackProfile(a.projectId)?.profile.curation){const q=this.memory.qualification(a.projectId,a.resource);if(!baseline||!q||q.decision!=="qualified"||q.fingerprint!==a.fingerprint||!this.qualificationCurrent(q,this.currentFeedbackProfile(a.projectId)!.hash,baseline.hash))return false;}else if(baseline){if(a.origin==="local-policy")return false;try{validateVisualReview(this.memory.assessment(a.scope,a.resource)?.visualReview,baseline,[a.resource,...this.memory.localCheck(a.scope,a.resource)?.relatedResources??[]]);}catch{return false;}}const inspected=await this.invoke(a.projectId,"inspect",["--key",a.key]);let context;try{context=this.resourcePostContext(a.projectId,inspected,a.postId);}catch{return false;}return context.accountId===a.accountId&&inspected.fingerprint===a.fingerprint&&this.eligible(inspected.entity)&&await this.matchesProfile(a.projectId,a.key)&&this.localActionCurrent(a);},
      verify:async a=>{const r=await this.invoke(a.projectId,"x-feedback",["--post-id",a.postId,"--operation","inspect_x_like"]);if(r.postTextHash!==a.postTextHash||r.postUrl!==a.postUrl||!Array.isArray(r.urls)||!r.urls.some((url:string)=>this.memory.identity("user",url)===a.resource))throw Error("X_POST_CHANGED_OR_LINK_NOT_EXPOSED: re-evaluate the original post");if(a.origin==="local-policy"&&r.urls.some((url:string)=>!relatedResourceUrl(url,this.memory.localCheck(a.scope,a.resource)?.relatedResources??[])))throw Error("X_POST_ADDITIONAL_LINKS_NEED_REVIEW");a.directUrl=r.urls.find((url:string)=>this.memory.identity("user",url)===a.resource);return r.favorited===true;},
      send:async a=>{await this.invoke(a.projectId,"x-feedback",["--post-id",a.postId,"--operation","like_x_post","--post-text-hash",a.postTextHash,"--direct-url",a.directUrl||"","--resource-memory",join(dirname(this.options.statePath),"resources.json"),"--resource-url",a.resource]);}
    });
  }
  private async feedbackTick(){await this.localFeedbackTick();await this.dispatchFeedback();}
  private currentFeedbackProfile(projectId:string){const input=this.options.feedbackProfile?.(projectId);if(!input)return;const profile=parseFeedbackProfile(input);return {profile,hash:feedbackProfileHash(projectId,profile)};}
  localFeedbackStatus(){const s=this.state.localFeedback,projectId=this.options.activeProjectId?.()??s?.cursor?.projectId??this.projects()[0]?.id;let configured=false,profileHash:string|undefined;try{const current=projectId?this.currentFeedbackProfile(projectId):undefined;configured=Boolean(current);profileHash=current?.hash;}catch{}return {enabled:this.options.localFeedbackEnabled?.()===true,configured,profileHash,busy:this.localFeedbackBusy,policy:RESOURCE_POLICY,modelRequired:false,checked:s?.checked??0,eligible:s?.eligible??0,pending:s?.pending??0,lastAt:s?.lastAt,lastError:s?.lastError,nextAt:s?.nextAt??0,nextPublicProbeAt:s?.publicNextAt??0,qualityScope:"Verified structural signals; no aesthetic certification",sourceCoverage:"Public repositories and verified official homepages; unsupported resources stay pending"};}
  /** Local bounded worker. It owns no human reviews and never calls an AI. */
  async localFeedbackTick(now=Date.now()){
    if(this.closed||!this.options.localFeedbackEnabled?.()||this.localFeedbackBusy||this.bridge.running||this.activeJob||this.state.resourceRequests?.some(r=>!r.result&&!r.terminal))return;
    const state=this.state.localFeedback??={checked:0,eligible:0,pending:0,nextAt:0};if(state.policy!==RESOURCE_POLICY){const publicNextAt=state.publicNextAt??(/rate|limit|incomplete/i.test(state.lastError??"")?state.nextAt:0);Object.assign(state,{policy:RESOURCE_POLICY,checked:0,eligible:0,pending:0,nextAt:0,cursor:undefined,publicNextAt});}
    this.localFeedbackBusy=true;
    try{
      const projects=this.projects().filter(p=>(!this.options.activeProjectId||this.options.activeProjectId()===p.id)&&parseProjectManifest(readFileSync(this.project(p.id).project.configPath,"utf8")).sources.filter(s=>s.adapter==="x-for-you-local").length===1);
      if(!projects.length){state.lastError="Select an X project to run local checks";state.nextAt=now+60000;this.persist();return;}
      const selected=projects.find(p=>p.id===state.cursor?.projectId)??projects[0];
      const currentProfile=this.currentFeedbackProfile(selected.id);if(!currentProfile){state.lastError="Configure feedback criteria for this project";state.nextAt=now+60000;this.persist();return;}
      const {profile,hash:profileHash}=currentProfile;if(profile.referencePaths?.length){state.lastError="Reference-based evaluation required; structural checks cannot authorize likes";state.nextAt=now+60000;this.persist();return;}if(state.profileHash!==profileHash){Object.assign(state,{profileHash,checked:0,eligible:0,pending:0,cursor:{projectId:selected.id,offset:0},nextAt:0});}if(state.nextAt>now)return;
      if(!state.cursor||!projects.some(p=>p.id===state.cursor!.projectId))state.cursor={projectId:projects[0].id,offset:0};
      const cursor=state.cursor;
      const page=await this.getResources({projectId:cursor.projectId,review:"all",selectionId:cursor.selectionId,offset:cursor.offset,limit:40,filters:{version:1,entity:{fields:["title","attributes.description","attributes.discoveryText"],...(profile.includeTerms.length?{includeTerms:profile.includeTerms}:{}),...(profile.excludeTerms.length?{excludeTerms:profile.excludeTerms}:{}),matchMode:"word"}}});
      if(this.closed||!this.options.localFeedbackEnabled?.())return;cursor.selectionId=page.selectionId;
      if(!this.engineCapabilities.includes("x-post-resource-urls-v1"))throw Error("LOCAL_FEEDBACK_ENGINE_UPDATE_REQUIRED");
      if(!page.records.length){const next=(projects.findIndex(p=>p.id===cursor.projectId)+1)%projects.length;state.cursor={projectId:projects[next].id,offset:0};state.nextAt=now+60000;this.persist();return;}
      const details=await this.inspectResources(cursor.projectId,page.records.map((r:any)=>r.key));
      if(this.closed||!this.options.localFeedbackEnabled?.()||this.currentFeedbackProfile(cursor.projectId)?.hash!==profileHash)return;
      for(let index=0;index<details.records.length;index++){
        const data=details.records[index];if(!data.entity?.url||data.rejected||!resourceCandidate(data.entity,profile))continue;
        let context;try{context=this.resourcePostContext(cursor.projectId,data);}catch{continue;}
        let check=this.memory.localCheck("user",data.entity.url);
        const fresh=!check||check.policy!==RESOURCE_POLICY||check.profileHash!==profileHash||check.fingerprint!==data.fingerprint||Date.parse(check.expiresAt)<=now;
        if(fresh){
          const mention=data.mentions?.find((m:any)=>m.active===true&&m.connectionId===context.connectionId&&m.itemId===context.postId&&m.url===context.postUrl),urls=Array.isArray(mention?.resourceUrls)?mention.resourceUrls:undefined;
          const earlyReason=!urls?.length?"Original source-post links need verification":hasMixedRepositories(urls)?"Original post mixes unrelated repositories; manual review required":undefined;
          if(!earlyReason&&(state.publicNextAt??0)>now)continue;
          const proof:PublicResourceEvidence=earlyReason?{version:1,url:data.entity.url,checkedAt:new Date().toISOString(),status:"pending",reason:earlyReason,evidence:[],retryAfterSeconds:3600}:await this.invoke(cursor.projectId,"resource-evidence",["--url",data.entity.url],this.evidenceBridge) as PublicResourceEvidence;
          if(proof?.version!==1||proof.url!==data.entity.url||!Array.isArray(proof.evidence))throw Error("INVALID_PUBLIC_RESOURCE_EVIDENCE");
          if(!this.engineCapabilities.includes("public-resource-evidence-v1"))throw Error("LOCAL_FEEDBACK_ENGINE_UPDATE_REQUIRED");
          if(this.closed||!this.options.localFeedbackEnabled?.()||this.currentFeedbackProfile(cursor.projectId)?.hash!==profileHash)return;
          const current=(await this.inspectResources(cursor.projectId,[data.entity.key])).records[0];
          if(this.closed||!this.options.localFeedbackEnabled?.()||this.currentFeedbackProfile(cursor.projectId)?.hash!==profileHash)return;
          if(current.fingerprint!==data.fingerprint){state.nextAt=now+10000;this.persist();return;}
          check=this.memory.recordLocalCheck("user",data.entity.url,checkResource(data.entity,data.fingerprint,proof,profile,profileHash,now,urls));
          if(!earlyReason&&proof.rateLimited&&proof.retryAfterSeconds)state.publicNextAt=now+proof.retryAfterSeconds*1000;
          state.checked++;if(check.eligible)state.eligible++;else state.pending++;state.lastAt=new Date().toISOString();if(!earlyReason||!(state.publicNextAt&&state.publicNextAt>now))state.lastError=proof.reason;state.nextAt=now+10000;
        }
        if(this.memory.localEligible("user",data.entity.url,data.fingerprint,profileHash)&&!this.memory.hasAction(context.accountId,context.postId))this.queueResourcePost(cursor.projectId,data.entity.key,data,context.postId,"local-policy",profileHash);
        if(fresh){cursor.offset+=index+1;this.persist();return;}
      }
      cursor.offset+=page.records.length;state.nextAt=now+10000;if(!(state.publicNextAt&&state.publicNextAt>now))state.lastError=undefined;this.persist();
    }catch(error){if(!this.closed){const message=error instanceof Error?error.message:"Local verification failed";if(/SELECTION_CHANGED|SELECTION_EXPIRED/.test(message))state.cursor=undefined;state.lastError=message.slice(0,240);state.nextAt=now+(/BUSY|Another Source Scraper command/.test(message)?10000:60000);this.persist();}}
    finally{this.localFeedbackBusy=false;}
  }
  async localFeedback(enabled:boolean){if(enabled&&!this.options.allowXLikes?.())throw Error("X_LOCAL_LIKES_APPROVAL_REQUIRED");if(enabled&&!this.projects().some(p=>hasXSource(parseProjectManifest(readFileSync(this.project(p.id).project.configPath,"utf8")))))throw Error("X_SOURCE_REQUIRED: likes belong to the X adapter");this.memory.setFeedback(enabled);return this.feedbackStatus();}
  private resourceLane:Promise<unknown>=Promise.resolve();
  private resourceCommand(projectId:string,input:any){
    const next=this.resourceLane.then(()=>this.runResourceCommand(projectId,input));this.resourceLane=next.catch(()=>{});return next;
  }
  private async runResourceCommand(projectId:string,input:any){
    if(this.closed)throw Error("PROVIDER_UNLOADED");
    const {config}=this.project(projectId);if(!this.engineChecked)await this.invoke(projectId,"validate");
    if(!this.engineCapabilities.includes("resource-batch-v1"))throw Error("RESOURCE_BATCH_UNAVAILABLE: update the trusted engine");
    if((input.quality||input.context?.qualifications)&&!this.engineCapabilities.includes("resource-quality-v1"))throw Error("RESOURCE_QUALITY_UNAVAILABLE: update the trusted engine");
    if((input.candidateFilters||input.context?.qualifications)&&!this.engineCapabilities.includes("resource-admission-v1"))throw Error("RESOURCE_ADMISSION_UNAVAILABLE: update the trusted engine");
    return this.bridge.resourceBatch(config,input);
  }
  private async qualityContext(projectId:string){
    const context=this.memory.queryContext(),current=this.currentFeedbackProfile(projectId);let baseline:ReferenceBaseline|undefined;
    try{baseline=await this.qualityBaseline(projectId);}catch{}
    if(current?.profile.curation){
      const qualifications=Object.fromEntries(Object.entries(this.memory.qualifications(projectId)).map(([url,saved])=>[url,{state:baseline&&this.qualificationCurrent(saved,current.hash,baseline.hash)?saved.decision:"pending",category:saved.category,entityUpdatedAt:saved.entityUpdatedAt,at:saved.at,reason:baseline&&this.qualificationCurrent(saved,current.hash,baseline.hash)?saved.reason:"Evidence expired or selection criteria changed; review again"}]));
      for(const [url,value] of Object.entries(context.assessments))if(value.decision==="recommended"){const saved=this.memory.qualification(projectId,url);if(!baseline||!saved||saved.decision!=="qualified"||!this.qualificationCurrent(saved,current.hash,baseline.hash))value.decision="pending";}
      return {...context,qualifications,qualityPolicyHash:hash({profileHash:current.hash,baselineHash:baseline?.hash??"unavailable"})};
    }
    if(current?.profile.referencePaths?.length)for(const [url,value] of Object.entries(context.assessments)){if(value.decision!=="recommended")continue;try{if(!baseline)throw Error("REFERENCES_UNAVAILABLE");validateVisualReview(this.memory.assessment("user",url)?.visualReview,baseline,[url,...this.memory.localCheck("user",url)?.relatedResources??[]]);}catch{value.decision="pending";}}
    return context;
  }
  private localCheckView(projectId:string,url:string,fingerprint?:string){const check=this.memory.localCheck("user",url);let profileHash:string|undefined;try{profileHash=this.currentFeedbackProfile(projectId)?.hash;}catch{}return check?{...check,eligible:Boolean(profileHash)&&this.memory.localEligible("user",url,fingerprint,profileHash),stale:check.policy!==RESOURCE_POLICY||!profileHash||check.profileHash!==profileHash||Boolean(fingerprint&&check.fingerprint!==fingerprint)||Date.parse(check.expiresAt)<=Date.now()}:undefined;}
  async getResources(args:any){await this.recoverResourceReviews();if(this.currentFeedbackProfile(args.projectId)?.profile.curation){const screening=this.currentFeedbackProfile(args.projectId)?.profile.curation?.candidateFilters;if(screening)args={...args,candidateFilters:screening};}if(this.currentFeedbackProfile(args.projectId)?.profile.curation&&args.quality===undefined)args={...args,quality:"qualified"};const result=await this.resourceCommand(text(args.projectId,"projectId"),{...args,operation:"query",context:await this.qualityContext(text(args.projectId,"projectId"))});for(const e of result.records??[]){const check=e.url?this.localCheckView(args.projectId,e.url):undefined;if(check)e.localResourceCheck={policy:check.policy,eligible:check.eligible,checkedAt:check.checkedAt,expiresAt:check.expiresAt,reasons:check.reasons.slice(0,3),stale:e.updatedAt>check.checkedAt||check.stale};}return {...result,recovery:(this.state.resourceRequests??[]).filter(r=>!r.result&&!r.terminal).map(r=>({projectId:r.projectId,requestId:r.requestId,error:r.error??"Review needs reconciliation"}))};}
  async inspectResources(projectId:string,keys:string[]){let baseline:ReferenceBaseline|undefined;try{baseline=await this.qualityBaseline(projectId);}catch{}const referencesRequired=Boolean(this.currentFeedbackProfile(projectId)?.profile.referencePaths?.length)&&!this.currentFeedbackProfile(projectId)?.profile.curation;const value=await this.resourceCommand(projectId,{operation:"inspect",keys,candidateFilters:this.currentFeedbackProfile(projectId)?.profile.curation?.candidateFilters});for(const r of value.records){if(r.entity?.url){const q=this.memory.qualification(projectId,r.entity.url),current=this.currentFeedbackProfile(projectId);r.resourceQuality=q?{...q,stale:q.fingerprint!==r.fingerprint||!baseline||!current||!this.qualificationCurrent(q,current.hash,baseline.hash)}:undefined;r.humanReview=this.memory.humanReview("user",r.entity.url);const saved=this.memory.assessment("user",r.entity.url);let referenceStale=Boolean(current?.profile.curation&&saved?.decision==="recommended"&&(!q||q.decision!=="qualified"||r.resourceQuality?.stale));if(saved?.decision==="recommended"&&referencesRequired)try{if(!baseline)throw Error("REFERENCES_UNAVAILABLE");validateVisualReview(saved.visualReview,baseline,[r.entity.url,...this.memory.localCheck("user",r.entity.url)?.relatedResources??[]]);}catch{referenceStale=true;}r.resourceAssessment=saved?{...saved,stale:saved.fingerprint!==r.fingerprint||referenceStale,referenceStale}:undefined;r.localResourceCheck=this.localCheckView(projectId,r.entity.url,r.fingerprint);r.rejected=this.memory.rejected("user",r.entity.url);}}return value;}
  async reviewResources(args:any,origin:"user-interface"|"user-mcp"="user-interface"){
    const projectId=text(args.projectId,"projectId"),requestId=text(args.requestId,"requestId",100),signature=hash(canonical(args));this.project(projectId);
    this.state.resourceRequests??=[];let job=this.state.resourceRequests.find(r=>r.projectId===projectId&&r.requestId===requestId);
    if(job&&job.signature!==signature&&Object.keys(args).some(k=>!["projectId","requestId"].includes(k)))throw Error("REQUEST_CONFLICT");
    if(job?.terminal)throw Error(job.error||"Review request was rejected; query current resources and use a new requestId");
    if(job?.result)return job.result;
    if(!job){this.requireRecoveredReviews();if(Boolean(args.selectionId)===Boolean(args.changes))throw Error("Choose a selectionId or changes");
      if(args.reason!==undefined&&(typeof args.reason!=="string"||args.reason.length>1000))throw Error("INVALID_REVIEW_REASON");
      if(args.selectionId&&(typeof args.selectionId!=="string"||!["pending","approved","rejected"].includes(args.decision)))throw Error("INVALID_SELECTION_DECISION");
      if(args.changes&&(!Array.isArray(args.changes)||!args.changes.length||args.changes.length>5000||new Set(args.changes.map((c:any)=>c?.key)).size!==args.changes.length||args.changes.some((c:any)=>!c||typeof c.key!=="string"||!c.key||c.key.length>4000||!["pending","approved","rejected"].includes(c.decision)||c.reason!==undefined&&(typeof c.reason!=="string"||c.reason.length>1000))))throw Error("INVALID_BATCH_REVIEW");
      job={projectId,requestId,signature,origin,input:{operation:"review",requestId,selectionId:args.selectionId,decision:args.decision,reason:args.reason,changes:args.changes,context:await this.qualityContext(projectId)}};this.state.resourceRequests.push(job);this.persist();}
    job.error=undefined;try{return await this.finishResourceReview(job);}catch(e){this.recoveryTried.add(projectId+"|"+requestId);this.recordReviewError(job,e);throw e;}
  }
  private async finishResourceReview(job:ResourceRequest){
    const response=await this.resourceCommand(job.projectId,job.input);
    const reasons=new Map<string,string>((job.input.changes??[]).map((c:any)=>[c.key,c.reason??""]));
    this.memory.transaction(()=>{for(const r of response.records)if(!r.error&&!(response.committedAt&&String(this.memory.humanReview("user",r.url)?.at??"")>response.committedAt)){this.memory.recordHumanReview("user",r.url,{decision:r.decision,reason:job.input.reason??reasons.get(r.key)??"",fingerprint:r.fingerprint,postSuitable:false,verifiedUsefulFreeAndQuality:false,origin:job.origin});}});
    job.result={projectId:job.projectId,requestId:job.requestId,saved:response.saved,failed:response.failed,errors:response.records.filter((r:any)=>r.error).map((r:any)=>({key:r.key,error:r.error})),notesCreated:0,likesQueued:0};
    const completed=this.state.resourceRequests!.filter(r=>r.result);if(completed.length>100)this.state.resourceRequests=this.state.resourceRequests!.filter(r=>!r.result||completed.slice(-100).includes(r));job.input={};this.persist();return job.result;
  }
  private recoveryTried=new Set<string>();
  private requireRecoveredReviews(){if(this.state.resourceRequests?.some(r=>!r.result&&!r.terminal))throw Error("REVIEW_RECOVERY_REQUIRED: recover the previous review before saving new choices");}
  restoreResource(url:string){this.requireRecoveredReviews();this.memory.restore("user",url);}
  private recordReviewError(job:ResourceRequest,error:unknown){job.error=error instanceof Error?error.message:"Review needs reconciliation";job.terminal=error instanceof CliCommandError&&error.exitCode===1&&/SELECTION_CHANGED|SELECTION_EXPIRED|INVALID_|REQUEST_CONFLICT|REQUEST_ID_REQUIRED|REQUEST_LIMIT|Select 1/.test(job.error);if(job.terminal)job.input={};this.persist();}
  private async recoverResourceReviews(){for(const job of this.state.resourceRequests??[]){const key=job.projectId+"|"+job.requestId;if(!job.result&&!job.terminal&&!this.recoveryTried.has(key)){this.recoveryTried.add(key);try{await this.finishResourceReview(job);}catch(e){this.recordReviewError(job,e);}}}}
  private feedbackStatus(){return {enabled:this.memory.enabled,localLikePermission:this.options.allowXLikes?.()===true,actions:this.memory.actions(),localPolicy:this.localFeedbackStatus(),limits:{maxPerHour:5,minIntervalSeconds:60},algorithmEffect:"Not guaranteed"};}
  private async entities(projectId:unknown,selected:string[],excludeRejected=false):Promise<EntityExport>{
    const value=await this.invoke(projectId,"export",["--keys-json",JSON.stringify(selected)]);
    const exported=parseExport(JSON.stringify(value));
    if(exported.projectId!==projectId||exported.records.length!==selected.length)throw Error("PROJECT_MISMATCH");
    if(this.currentFeedbackProfile(String(projectId))?.profile.curation){
      const admitted=new Set<string>();
      for(let i=0;i<exported.records.length;i+=50){const batch=await this.inspectResources(String(projectId),exported.records.slice(i,i+50).map(e=>e.key));for(const d of batch.records)if(d.entity&&d.profileMatched&&!d.rejected&&!(d.resourceQuality?.decision==="excluded"&&!d.resourceQuality.stale))admitted.add(d.key);}
      if(!excludeRejected&&exported.records.some(e=>!admitted.has(e.key)))throw Error("RESOURCE_OUTSIDE_ADMISSION_FILTERS");
      exported.records=exported.records.filter(e=>admitted.has(e.key));
    }
    if(excludeRejected)exported.records=exported.records.filter(e=>this.eligible(e));
    else if(exported.records.some(e=>!this.eligible(e)))throw Error("RESOURCE_REJECTED_OR_NOT_A_LINK");
    const identities=new Set<string>();exported.records=exported.records.filter(e=>{if(e.type!=="web-resource"||!e.url)return true;const id=this.memory.identity("user",e.url);if(identities.has(id))return false;identities.add(id);return true;});
    for(const e of exported.records)if(e.url){e.resourceAssessment=this.memory.assessment("user",e.url);const human=this.memory.humanReview("user",e.url);if(human)e.review=human.decision;}
    return exported;
  }
  private async start(args:Record<string,unknown>,command:"run"|"reprocess"):Promise<Job>{
    const {project}=this.project(args.projectId);
    const manifest=parseProjectManifest(readFileSync(project.configPath,"utf8"));
    const sourceIds=compileCollectionFilters(manifest.sources.map(s=>s.id),manifest.filters,
      args.sourceIds===undefined?undefined:{version:1,sourceIds:args.sourceIds}).sourceIds;
    const usesX=manifest.sources.some(s=>sourceIds.includes(s.id)&&s.adapter==="x-for-you-local");
    if(command==="run"&&usesX&&!this.options.allowXProvider)throw Error("X_LOCAL_APPROVAL_REQUIRED: enable local read-only X access");
    if(command==="run"&&usesX&&args.pageSize!==undefined&&Number(args.pageSize)<100)throw Error("X_FEED_PAGE_SIZE: use at least 100");
    const requestId=text(args.requestId,"requestId",200),projectId=text(args.projectId,"projectId");
    const limits=command==="run"?["--page-size",String(integer(args.pageSize,100,1,500)),"--max-pages",String(integer(args.maxPages,100,1,1000))]:[];
    if(command==="run"&&args.sourceIds!==undefined)limits.push("--source-ids-json",JSON.stringify(sourceIds));
    const signature=hash({projectId,command,limits});
    const prior=this.state.jobs.find(j=>j.requestId===requestId);
    if(prior){if(prior.signature!==signature)throw Error("REQUEST_CONFLICT");return prior;}
    if(this.bridge.running||this.collectionBridge.running||this.activeJob)throw Error("BUSY");
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
      case "research_packet":{const projectId=text(args.projectId,"projectId"),offset=integer(args.offset,0,0,499),limit=Math.min(integer(args.limit,25,1,50),500-offset),baseline=await this.qualityBaseline(projectId);const page=await this.getResources({projectId,selectionId:args.selectionId,offset,limit,review:"all",...(this.currentFeedbackProfile(projectId)?.profile.curation?{quality:"pending"}:{})});const details=page.records.length?await this.inspectResources(projectId,page.records.map((e:any)=>e.key)):{records:[]};return {projectId,selectionId:page.selectionId,totalCandidates:page.total,batchSize:Math.min(page.total,500),offset,nextOffset:offset+page.records.length<Math.min(page.total,500)?offset+page.records.length:undefined,baseline,screeningNotice:"Admission filters apply to every result view and evidence decision. Mismatches are automatically discarded from results. Unknown quality is not a failed review and never becomes a qualified result.",curation:this.currentFeedbackProfile(projectId)?.profile.curation,profileHash:this.currentFeedbackProfile(projectId)?.hash,qualificationContract:{version:1,freeAccess:"Ongoing unmetered free core use; optional paid MCP, API or add-ons allowed",writeTool:"source_scraper_qualify_resources",reviewShape:{version:1,fingerprint:"from record",profileHash:"from packet",baselineHash:"baseline.hash",category:"configured category ID",decision:"qualified | pending | excluded",reason:"specific reason",relevance:"specific design OR frontend use",access:{mode:"unmetered-free | metered | trial | paid | unknown",scope:"useful ongoing free core",evidence:[{url:"resource pricing/license/docs URL",quote:"observed evidence"}]},criteria:[{id:"configured criterion ID",verdict:"meets | below | unknown",note:"specific evidence",evidence:[{url:"resource URL",quote:"observed evidence"}]}],comparisons:[{referenceUrl:"matching category baseline URL",sampleUrl:"resource example URL",note:"specific category comparison; two distinct references and samples required"}]}},negativeExamples:this.memory.listRejected("user").map(r=>({url:r.resource,reason:r.reason})).slice(-50),records:details.records,evaluationRequired:true,likesQueued:0,notesWritten:0};}
      case "get_resources":return this.getResources(args);
      case "inspect_resources":return this.inspectResources(text(args.projectId,"projectId"),selection(args.keys));
      case "review_resources":return this.reviewResources(args);
      case "assess_resources":{
        if(!Array.isArray(args.items)||!args.items.length||args.items.length>50||new Set(args.items.map(x=>x.key)).size!==args.items.length)throw Error("Select 1–50 distinct assessments");
        const projectId=text(args.projectId,"projectId"),details=await this.inspectResources(projectId,args.items.map(x=>text(x.key,"key")));
        for(const item of args.items as any[])await this.validateQuality(projectId,item.assessment,details.records.find((r:any)=>r.key===item.key)?.entity?.url??"");
        const records=this.memory.transaction(()=>(args.items as any[]).map((item:any)=>{try{const d=details.records.find((r:any)=>r.key===item.key);if(!d?.entity||d.rejected||!d.profileMatched)throw Error("RESOURCE_REJECTED_OR_OUTSIDE_FILTERS");if(item.postId!==undefined)this.resourcePostContext(projectId,d,text(item.postId,"postId"));if(item.assessment?.fingerprint!==d.fingerprint)throw Error("STALE_RESOURCE_ASSESSMENT");const record=this.memory.assess("user",d.entity.url,item.assessment);const action=record.decision==="recommended"&&record.postSuitable&&item.postId?this.queueResourcePost(projectId,item.key,d,text(item.postId,"postId")):undefined;return {key:item.key,decision:record.decision,action};}catch(e){return {key:item.key,error:e instanceof Error?e.message:"Assessment failed"};}}));
        return {projectId,records,humanReviewChanged:false};
      }
      case "qualify_resources":return this.qualifyResources(args);
      case "cycle_status":return this.cycle.snapshot();
      case "control_cycle":{this.project(args.projectId);if(args.action==="pause")return this.cycle.pause();if(args.action==="stop")return this.cycle.stop();if(args.action!=="start")throw Error("INVALID_CYCLE_ACTION");if(!parseProjectManifest(readFileSync(this.project(args.projectId).project.configPath,"utf8")).sources.some(s=>s.adapter==="x-for-you-local"))throw Error("X_SOURCE_REQUIRED: background feed cycles belong to the X adapter");return this.cycle.start(text(args.projectId,"projectId"),integer(args.maxPages,100,1,1000),this.options.localFeedbackEnabled?.()===true);}
      case "feedback_status":return this.feedbackStatus();
      case "control_feedback":{if(typeof args.enabled!=="boolean")throw Error("INVALID_FEEDBACK_SETTING");return this.localFeedback(args.enabled);}
      case "list_rejected":{this.project(args.projectId);return {scope:"This vault's local user, across registered projects",records:this.memory.listRejected("user")};}
      case "resource_decision":{
        this.requireRecoveredReviews();
        if(["approve","pending"].includes(String(args.action)))return this.saveHumanReview(text(args.projectId,"projectId"),text(args.key,"key"),args.action==="approve"?"approved":"pending",typeof args.reason==="string"?args.reason:"",args.queueLike===true,"user-mcp");
        const data=await this.invoke(args.projectId,"inspect",["--key",text(args.key,"key")]);const entity=data.entity;
        this.requireRecoveredReviews();
        if(entity.type!=="web-resource"||!entity.url)throw Error("RESOURCE_LINK_REQUIRED");
        if(args.action==="reject")this.memory.reject("user",entity.url,typeof args.reason==="string"?args.reason:"","user-mcp");
        else if(args.action==="restore")this.restoreResource(entity.url);
        else if(args.action==="alias")this.memory.alias("user",text(args.alias,"alias"),entity.url);
        else throw Error("INVALID_RESOURCE_DECISION");
        for(const q of this.state.queues){if(!q.keys.length)continue;const visible=await this.invoke(q.projectId,"export",["--keys-json",JSON.stringify(q.keys)]);q.keys=visible.records.filter((e:EntityExport["records"][number])=>this.eligible(e)).map((e:EntityExport["records"][number])=>e.key);}
        this.persist();return {resource:entity.url,rejected:this.memory.rejected("user",entity.url),notesCreated:0};
      }
      case "assess_resource":{
        const data=await this.invoke(args.projectId,"inspect",["--key",text(args.key,"key")]);
        if(data.entity.type!=="web-resource"||!data.entity.url||!this.eligible(data.entity))throw Error("RESOURCE_REJECTED_OR_NOT_A_LINK");
        if((args.assessment as Recommendation)?.fingerprint!==data.fingerprint)throw Error("STALE_RESOURCE_ASSESSMENT");
        if(!await this.matchesProfile(args.projectId,data.entity.key))throw Error("RESOURCE_OUTSIDE_CONFIGURED_FILTERS");
        if(args.postId!==undefined)this.resourcePostContext(text(args.projectId,"projectId"),data,text(args.postId,"postId"));
        await this.validateQuality(text(args.projectId,"projectId"),args.assessment,data.entity.url);
        const record=this.memory.assess("user",data.entity.url,args.assessment);
        let action:unknown;
        if(record.decision==="recommended"&&record.postSuitable&&args.postId!==undefined){
          action=this.queueResourcePost(text(args.projectId,"projectId"),text(args.key,"key"),data,text(args.postId,"postId"));
        }
        return {record,action,humanReviewChanged:false,evaluationOwner:"AI via MCP"};
      }
      case "capabilities":return {apiVersion:1,entitySchemaVersion:1,projects:this.projects().length,noteWritesSupported:false,
        localAvailability:{workspace:existsSync(this.options.workspacePath),cli:existsSync(this.options.cliPath),node:existsSync(this.options.nodeExecutable)},
        limits:{queryRecords:500,selectedRecords:200,selectionBytes:12000,importBytes:8000000,assessmentBytes:12000},toolNames:this.tools.map(t=>t.name),
        cycle:this.cycle.snapshot(),feedback:{enabled:this.memory.enabled,localLikePermission:this.options.allowXLikes?.()===true},
        evaluation:{owner:"Local rule checks, user review or optional AI via MCP",backgroundModel:false,localPolicy:this.localFeedbackStatus(),whenChatClosed:"Enabled local rule checks and collection continue; no AI is required",recommendedEvidenceFields:["utility","reuse","quality","freeAccess","usableOutput","evidence"],xLikeEvidenceFields:["postSuitable"]},
        sources:["json-file","json-snapshot","rss","public-json","public-product","x-for-you-local"],executableSources:false,
        collectionFilters:{version:1,requiresEngineCapability:"collection-filters-v1",sourceSelection:true,requestFilters:true,numericRanges:true,dateRanges:true,thresholdCapability:"candidate-thresholds-v1",
          appliesTo:["candidate-query","entity-export"],editorialQuality:false,schema:COLLECTION_FILTER_SCHEMA},
        xFeed:{collector:"twifork",feed:"for-you",localGrant:this.options.allowXProvider===true,liveVerified:false,liveVerification:"not-probed",verificationNote:"This capability report does not contact X. Inspect successful collection runs for live access evidence.",
          csrfConfigured:Boolean(this.options.getXSession?.()?.csrf||process.env.SOURCE_SCRAPER_X_CSRF),accountSessionConfigured:Boolean(this.options.getXSession?.()?.accountSession||process.env.SOURCE_SCRAPER_X_ACCOUNT_SESSION),
          pythonConfigured:Boolean(this.options.xPythonPath||process.env.SOURCE_SCRAPER_X_PYTHON),
          credentialDestination:"x.com",apiKeyRequired:false,paidFallback:false,maxPagesPerRun:10}};
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
        if(this.currentFeedbackProfile(String(args.projectId))?.profile.curation)return this.getResources({...args,limit:integer(args.limit,100,1,500),offset:integer(args.offset,0,0,1000000),...(args.minScore===undefined?{}:{minScore:integer(args.minScore,0,0,100)})});
        const manifest=parseProjectManifest(readFileSync(this.project(args.projectId).project.configPath,"utf8"));
        const filters=args.filters===undefined?undefined:parseCollectionFilters(args.filters,manifest.sources.map(s=>s.id));
        const flags=["--limit",String(integer(args.limit,100,1,500)),"--offset",String(integer(args.offset,0,0,1000000))];
        for(const field of ["search","type"])if(args[field]!==undefined)flags.push("--"+field,text(args[field],field));
        if(args.minScore!==undefined)flags.push("--min-score",String(integer(args.minScore,0,0,100)));
        if(filters)flags.push("--filters-json",JSON.stringify(filters));
        // Exclude before pagination: rejected aliases never leak into later pages.
        const wanted=integer(args.limit,100,1,500),skip=integer(args.offset,0,0,1000000),records:any[]=[];let visible=0,offset=0;let metadata:Record<string,unknown>={};const identities=new Set<string>();
        const base=flags.filter((_v,i)=>![0,1,2,3].includes(i));
        for(;;){const page=await this.invoke(args.projectId,"query",["--limit","500","--offset",String(offset),...base]);if(offset===0)metadata=page;for(const e of page.records){if(args.type!=="x-inspiration"&&!this.eligible(e,manifest.pipeline.includes("x-discovery")))continue;const saved=e.url?this.memory.assessment("user",e.url):undefined;const assessment=saved&&e.updatedAt>saved.at?{...saved,decision:"pending",stale:true}:saved;const human=e.url?this.memory.humanReview("user",e.url):undefined;const decision=assessment?.decision??"pending";if(args.evaluation&&args.evaluation!=="all"?decision!==args.evaluation:!args.evaluation&&decision==="discarded"&&human?.decision!=="approved")continue;if(e.type==="web-resource"&&e.url){const id=this.memory.identity("user",e.url);if(identities.has(id))continue;identities.add(id);}if(visible++<skip)continue;records.push({...e,review:e.url?this.memory.humanReview("user",e.url)?.decision??(e.review==="rejected"&&this.memory.hasDecision("user",e.url)?"pending":e.review):e.review,resourceAssessment:assessment});if(records.length===wanted)break;}if(records.length===wanted||page.records.length<500)break;offset+=500;}
        return {...metadata,schemaVersion:1,dataset:"entities",projectId:args.projectId,limit:wanted,offset:skip,count:records.length,records};
      }
      case "inspect_finding":{const data=await this.invoke(args.projectId,"inspect",["--key",text(args.key,"key")]);const human=data.entity.url?this.memory.humanReview("user",data.entity.url):undefined;return {...data,humanReview:human,storedProjectReview:data.entity.review,entity:{...data.entity,review:human?.decision??data.entity.review}};}
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
        return queue?this.entities(projectId,queue.keys,true):{projectId,records:[]};
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
    this.options.stage(await this.entities(queue.projectId,queue.keys,true));
  }
}
