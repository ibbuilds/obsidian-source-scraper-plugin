import {spawn} from "node:child_process";
import {realpathSync} from "node:fs";
import type {EntityExport} from "./contracts.ts";
import {parseExport} from "./contracts.ts";

const MAX_STDOUT=9_000_000,MAX_STDERR=2000;
function safe(s:string):string{
  return s.replace(/https?:\/\/[^\s"'<>]+/gi,"[redacted-url]")
    .replace(/(?:token|password|secret|cookie|session|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,"[redacted]")
    .slice(0,400);
}
export interface CliConfig {nodeExecutable:string;cliPath:string;configPath:string}
export class CliBridge {
  private controller?:AbortController;
  get running():boolean{return Boolean(this.controller);}
  cancel():void{this.controller?.abort();}
  private async command(config:CliConfig,command:string,args:string[],timeout=90000):Promise<unknown>{
    if(this.running)throw new Error("Another Source Scraper command is running");
    const cmd=new Set(["version","validate","run","query","export","review","reprocess"]);
    if(!cmd.has(command))throw new Error("Command not allowed");
    const script=realpathSync(config.cliPath);
    const node=config.nodeExecutable.trim()||"node";
    const abort=new AbortController();
    this.controller=abort;
    let stdout="",stderr="";
    try{
      return await new Promise<unknown>((resolve,reject)=>{
        let closed=false;
        const child=spawn(node,[script,command,...args],{
          shell:false,windowsHide:true,stdio:["ignore","pipe","pipe"],
          signal:abort.signal
        });
        const timer=setTimeout(()=>abort.abort(),timeout);
        const end=(err?:Error)=>{
          if(closed)return;
          closed=true;clearTimeout(timer);
          if(err)reject(err);
          else{
            try{resolve(JSON.parse(stdout));}
            catch{reject(new Error("CLI did not produce valid JSON"));}
          }
        };
        child.stdout.on("data",(bytes:Buffer)=>{
          stdout+=bytes.toString("utf8");
          if(Buffer.byteLength(stdout)>MAX_STDOUT)abort.abort();
        });
        child.stderr.on("data",(bytes:Buffer)=>{
          stderr=(stderr+bytes.toString("utf8")).slice(-MAX_STDERR);
        });
        child.on("error",e=>end(new Error("CLI could not start or was cancelled: "+safe(e.message))));
        child.on("close",code=>{
          if(code!==0)end(new Error("Source Scraper command failed: "+safe(stderr)));
          else end();
        });
      });
    }finally{this.controller=undefined;}
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
    const result=await this.command(config,"run",["--config",manifest],120000) as Record<string,unknown>;
    if((result.result as Record<string,unknown>|undefined)?.success!==true)
      throw new Error("Source collection did not complete successfully");
    const exportValue=await this.command(config,"export",["--config",manifest,"--format","json"],
      120000);
    return parseExport(JSON.stringify(exportValue));
  }
}
