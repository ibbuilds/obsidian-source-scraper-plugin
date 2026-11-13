import {spawn} from "node:child_process";
import {realpathSync} from "node:fs";
import {StringDecoder} from "node:string_decoder";
import type {EntityExport} from "./contracts.ts";
import {parseExport} from "./contracts.ts";

const MAX_STDOUT=9_000_000,MAX_STDERR=2000,STOP_GRACE_MS=1000;
function safe(s:string):string{
  return s.replace(/https?:\/\/[^\s"'<>]+/gi,"[redacted-url]")
    .replace(/(?:token|password|secret|cookie|session|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,"[redacted]")
    .slice(0,400);
}
export interface XLocalSession {accountSession:string;csrf:string}
export interface CliConfig {nodeExecutable:string;cliPath:string;configPath:string;allowXProvider?:boolean;allowXLikes?:boolean;xPythonPath?:string;xSession?:XLocalSession}
export class CliCommandError extends Error {
  readonly output:unknown;
  readonly exitCode:number|null;
  constructor(message:string,output:unknown,exitCode:number|null){super(message);this.output=output;this.exitCode=exitCode;}
}
export class CliBridge {
  private controller?:AbortController;
  get running():boolean{return Boolean(this.controller);}
  cancel():void{this.controller?.abort();}
  private async command(config:CliConfig,command:string,args:string[],timeout=90000,input?:string):Promise<unknown>{
    if(this.running)throw new Error("Another Source Scraper command is running");
    const cmd=new Set(["version","adapters","projects","validate","run","query","inspect","export","review","reprocess","assessment-record","assessment-list","x-feedback","cycle-progress","resource-batch","resource-evidence","topic-batch","process-pending"]);
    if(!cmd.has(command))throw new Error("Command not allowed");
    const script=realpathSync(config.cliPath);
    const node=config.nodeExecutable.trim()||"node";
    const abort=new AbortController();
    this.controller=abort;
    const decoder=new StringDecoder("utf8");
    let stdout="",stdoutBytes=0,stderr="",exceeded=false;
    try{
      return await new Promise<unknown>((resolve,reject)=>{
        let closed=false;
        const child=spawn(node,[script,command,...args],{
          shell:false,windowsHide:true,stdio:[input===undefined?"ignore":"pipe","pipe","pipe"],
          signal:abort.signal,env:cliEnvironment(config.allowXProvider===true,config.xPythonPath,config.xSession,config.allowXLikes)
        });
        const timer=setTimeout(()=>abort.abort(),timeout);
        let forceTimer:ReturnType<typeof setTimeout>|undefined;
        let pendingError:Error|undefined;
        const interrupted=(message:string)=>new Error(exceeded?
          "Source Scraper JSON exceeded the 9 MB response cap":
          "CLI could not start or was cancelled: "+safe(message));
        const closeCancelledPipes=()=>{
          // Descendants may inherit these pipes after the direct CLI exits.
          // On cancellation, detach our readers only once that exit is real;
          // waiting for a descendant's EOF must not keep this command locked.
          if(abort.signal.aborted&&(child.exitCode!==null||child.signalCode!==null)){
            child.stdout!.destroy();
            child.stderr!.destroy();
          }
        };
        const stop=()=>{
          pendingError??=interrupted("The operation was aborted");
          if(child.exitCode!==null||child.signalCode!==null){
            closeCancelledPipes();
            return;
          }
          // AbortSignal sends SIGTERM. A CLI may delay or ignore that signal;
          // keep the command locked and escalate only this child if needed.
          forceTimer=setTimeout(()=>{
            if(!closed&&child.exitCode===null&&child.signalCode===null)
              child.kill("SIGKILL");
          },STOP_GRACE_MS);
        };
        const onError=(error:Error)=>{pendingError=interrupted(error.message);};
        const onStdout=(bytes:Buffer)=>{
          if(exceeded||abort.signal.aborted)return;
          stdoutBytes+=bytes.length;
          if(stdoutBytes>MAX_STDOUT){exceeded=true;abort.abort();return;}
          // A pipe chunk can end partway through a UTF-8 character. Preserve
          // the decoder state so titles and identity keys survive unchanged.
          stdout+=decoder.write(bytes);
        };
        const onStderr=(bytes:Buffer)=>{
          stderr=(stderr+bytes.toString("utf8")).slice(-MAX_STDERR);
        };
        const onClose=(code:number|null)=>{
          if(closed)return;
          closed=true;clearTimeout(timer);
          if(forceTimer)clearTimeout(forceTimer);
          abort.signal.removeEventListener("abort",stop);
          child.stdout!.off("data",onStdout);
          child.stderr!.off("data",onStderr);
          child.off("error",onError);
          child.off("exit",closeCancelledPipes);
          // Even AbortError arrives before the child has actually exited.
          // The close event also follows failed spawn, so it is the common
          // point at which the lock and all timers can safely be released.
          if(pendingError)reject(pendingError);
          else if(code!==0){
            let partial:unknown;
            try{partial=JSON.parse(stdout+decoder.end());}catch{/* Invalid/empty partial output has no data contract. */}
            reject(new CliCommandError("Source Scraper command failed: "+safe(stderr),partial,code));
          }
          else{
            try{resolve(JSON.parse(stdout+decoder.end()));}
            catch{reject(new Error("CLI did not produce valid JSON"));}
          }
        };
        if(input!==undefined){child.stdin!.on("error",onError);child.stdin!.end(input);}
        child.stdout!.on("data",onStdout);
        child.stderr!.on("data",onStderr);
        child.on("error",onError);
        child.once("exit",closeCancelledPipes);
        child.once("close",onClose);
        abort.signal.addEventListener("abort",stop,{once:true});
      });
    }finally{this.controller=undefined;}
  }
  async resourceBatch(config:CliConfig,request:unknown):Promise<any>{
    const raw=JSON.stringify(request);if(Buffer.byteLength(raw)>8_000_000)throw Error("Resource request exceeds 8 MB");
    return this.command(config,"resource-batch",["--config",config.configPath],120000,raw);
  }
  async topicBatch(config:CliConfig,request:unknown):Promise<any>{
    const raw=JSON.stringify(request);if(Buffer.byteLength(raw)>8_000_000)throw Error("Topic request exceeds 8 MB");
    return this.command({...config,allowXProvider:false,allowXLikes:false,xSession:undefined,xPythonPath:undefined},"topic-batch",["--config",config.configPath],120000,raw);
  }
  /** Public typed consumers supply fixed command/flag vectors; no shell is involved. */
  async invoke(config:CliConfig,command:"version"|"adapters"|"projects"|"validate"|"run"|"query"|"inspect"|"export"|"reprocess"|"assessment-record"|"assessment-list"|"x-feedback"|"cycle-progress"|"review"|"resource-evidence"|"process-pending",args:string[]=[]):Promise<unknown>{
    return this.command(command==="process-pending"?{...config,allowXProvider:false,allowXLikes:false,xSession:undefined,xPythonPath:undefined}:config,command,args,120000);
  }
  async checkVersion(config:CliConfig):Promise<string>{
    const v=await this.command(config,"version",[],15000) as Record<string,unknown>;
    if(v.name!=="source-scraper"||v.jsonSchemaVersion!==1||typeof v.version!=="string")
      throw new Error("Unsupported Source Scraper CLI or JSON schema");
    return v.version;
  }
  /** Persist a human decision only in the explicitly configured matching engine project. */
  async review(config:CliConfig,projectId:string,key:string,
    decision:"pending"|"approved"|"rejected",reason:string):Promise<void>{
    if(!reason.trim()||reason.length>1000)throw new Error("Review reason required (maximum 1000 characters)");
    if(!["pending","approved","rejected"].includes(decision))throw new Error("Invalid review decision");
    const manifest=realpathSync(config.configPath);
    await this.checkVersion(config);
    const validation=(await this.command(config,"validate",["--config",manifest],15000)) as Record<string,unknown>;
    if(validation.valid!==true||validation.id!==projectId)
      throw new Error("Configured CLI project differs from imported project");
    const response=(await this.command(config,"review",
      ["--config",manifest,"--key",key,"--decision",decision,"--reason",reason],30000)) as {entity?:{review?:string;key?:string}};
    if(response.entity?.review!==decision||response.entity?.key!==key)
      throw new Error("Source Scraper did not confirm the saved human decision");
  }
  async runAndImport(config:CliConfig):Promise<EntityExport>{
    const manifest=realpathSync(config.configPath);
    await this.checkVersion(config);
    const verified=await this.command(config,"validate",["--config",manifest],15000) as {valid?:boolean;id?:string};
    if(verified.valid!==true||typeof verified.id!=="string")
      throw new Error("The selected project JSON did not validate in the engine");
    // The engine's normal run only persists its own knowledge; note writing and
    // webhook delivery are separate explicit export operations.
    const result=await this.command(config,"run",["--config",manifest],120000) as {result?:{success?:boolean};id?:string};
    if(result.result?.success!==true||result.id!==verified.id)
      throw new Error("Source collection did not complete successfully");
    // The plugin has a deliberately bounded in-memory import. A bigger
    // library may be imported in separately generated pages later.
    const exportValue=await this.command(config,"export",
      ["--config",manifest,"--format","json","--dataset","entities","--limit","5000"],120000);
    const imported=parseExport(JSON.stringify(exportValue));
    if(imported.projectId!==verified.id)
      throw new Error("Exported data did not match the selected project");
    return imported;
  }
}
/** Only a local UI grant may authorize free first-party X reads. No paid-provider fallback. */
export function cliEnvironment(allowXProvider:boolean,xPythonPath?:string,session?:XLocalSession,allowXLikes=false):NodeJS.ProcessEnv{
  const env={...process.env};
  delete env.SOURCE_SCRAPER_X_PROVIDER_APPROVED;
  delete env.SOURCE_SCRAPER_GETXAPI_API_KEY;
  delete env.SOURCE_SCRAPER_X_LOCAL_APPROVED;
  delete env.SOURCE_SCRAPER_X_LIKES_APPROVED;
  if(allowXProvider&&allowXLikes)env.SOURCE_SCRAPER_X_LIKES_APPROVED="local-likes-only";
  if(allowXProvider){
    env.SOURCE_SCRAPER_X_LOCAL_APPROVED="local-read-only";if(xPythonPath)env.SOURCE_SCRAPER_X_PYTHON=xPythonPath;
    if(session){env.SOURCE_SCRAPER_X_ACCOUNT_SESSION=session.accountSession;env.SOURCE_SCRAPER_X_CSRF=session.csrf;}
  }
  else{
    delete env.SOURCE_SCRAPER_X_ACCOUNT_SESSION;
    delete env.SOURCE_SCRAPER_X_CSRF;
    delete env.SOURCE_SCRAPER_X_PYTHON;
  }
  return env;
}
