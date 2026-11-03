import {spawn} from "node:child_process";
import {homedir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {lstat,mkdir,readFile,writeFile,rename,unlink} from "node:fs/promises";
import {validateLocalSession} from "./x-feed.ts";
import type {XLocalSession} from "./cli-bridge.ts";

export interface SessionCipher {protect(value:string):Promise<string>;unprotect(value:string):Promise<string>}
const PROTECT=String.raw`$ErrorActionPreference='Stop'
[Console]::Error.WriteLine('SS_DPAPI_START')
[void][Reflection.Assembly]::Load('System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a')
[Console]::Error.WriteLine('SS_DPAPI_READY')
$plain=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadLine())
[Console]::Error.WriteLine('SS_DPAPI_INPUT')
try { [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($plain,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))) }
finally { [Array]::Clear($plain,0,$plain.Length) }`;
const UNPROTECT=String.raw`$ErrorActionPreference='Stop'
[Console]::Error.WriteLine('SS_DPAPI_START')
[void][Reflection.Assembly]::Load('System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a')
[Console]::Error.WriteLine('SS_DPAPI_READY')
$encrypted=[Convert]::FromBase64String([Console]::In.ReadLine().Trim())
[Console]::Error.WriteLine('SS_DPAPI_INPUT')
$plain=[Security.Cryptography.ProtectedData]::Unprotect($encrypted,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
try { [Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain)) }
finally { [Array]::Clear($plain,0,$plain.Length) }`;
const STORAGE_ERROR="Could not access the encrypted X session. Reconnect X with your Windows user account.";

/** Fixed script only. Values travel over anonymous stdin/stdout pipes, never argv/environment/logs. */
function crypt(script:string,input:string):Promise<string>{
  if(process.platform!=="win32")return Promise.reject(Error(STORAGE_ERROR));
  return new Promise((resolve,reject)=>{
    const helper=join(process.env.SystemRoot||"C:\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe");
    const helperEnv:NodeJS.ProcessEnv={};
    for(const key of ["SystemRoot","WINDIR","USERPROFILE","HOMEDRIVE","HOMEPATH","APPDATA","LOCALAPPDATA","TEMP","TMP","COMSPEC","PATHEXT","USERNAME","USERDOMAIN"]){if(process.env[key]!==undefined)helperEnv[key]=process.env[key];}
    const child=spawn(helper,["-NoLogo","-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from(script,"utf16le").toString("base64")],{
      shell:false,windowsHide:true,stdio:["pipe","pipe","pipe"],env:helperEnv
    });
    let output="",bytes=0,stderr=0,failed=false,phase="SS_DPAPI_SPAWN";
    const timer=setTimeout(()=>{failed=true;child.kill();},30000);
    child.stdout.setEncoding("utf8");child.stdout.on("data",(part:string)=>{bytes+=Buffer.byteLength(part);if(bytes>65536){failed=true;child.kill();}else output+=part;});
    child.stderr.on("data",(part:Buffer)=>{stderr+=part.length;const marker=/SS_DPAPI_(START|READY|INPUT)/.exec(part.toString("utf8"));if(marker)phase=marker[0];if(stderr>65536){failed=true;child.kill();}});
    child.on("error",()=>{failed=true;});
    child.on("close",code=>{clearTimeout(timer);if(failed||code!==0)reject(Error(STORAGE_ERROR+" ("+phase+")"));else resolve(output.trim());});
    child.stdin.on("error",()=>{failed=true;});child.stdin.end(input+"\n","utf8");
  });
}
const windowsCipher:SessionCipher={protect:value=>crypt(PROTECT,value),unprotect:value=>crypt(UNPROTECT,value)};

/** Private per-vault encrypted file, outside the vault; only the Windows user can decrypt it. */
export class XSessionStore {
  readonly supported:boolean;
  readonly file:string;
  private readonly directory:string;
  private readonly vaultId:string;
  private readonly cipher:SessionCipher;
  private pending:Promise<void>=Promise.resolve();
  constructor(options:{vaultId:string;directory?:string;cipher?:SessionCipher;platform?:string}){
    if(!/^[a-f0-9]{24}$/.test(options.vaultId))throw Error("Invalid X session scope");
    this.vaultId=options.vaultId;this.supported=(options.platform??process.platform)==="win32";
    this.directory=options.directory||join(process.env.LOCALAPPDATA||join(homedir(),"AppData","Local"),"SourceScraper","sessions");
    this.file=join(this.directory,this.vaultId+".dpapi");this.cipher=options.cipher||windowsCipher;
  }
  private enqueue<T>(operation:()=>Promise<T>):Promise<T>{
    const result=this.pending.then(operation);this.pending=result.then(()=>{},()=>{});return result;
  }
  private async raw():Promise<string|undefined>{
    try{
      const dir=await lstat(this.directory);if(dir.isSymbolicLink()||!dir.isDirectory())throw Error(STORAGE_ERROR);
      const info=await lstat(this.file);if(info.isSymbolicLink()||!info.isFile()||info.size>65536)throw Error(STORAGE_ERROR);
      return await readFile(this.file,"utf8");
    }catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw Error(STORAGE_ERROR);}
  }
  private async write(value:string):Promise<void>{
    await mkdir(this.directory,{recursive:true,mode:0o700});
    const dir=await lstat(this.directory);if(dir.isSymbolicLink()||!dir.isDirectory())throw Error(STORAGE_ERROR);
    const temp=this.file+"."+randomUUID()+".tmp";
    try{await writeFile(temp,value,{flag:"wx",mode:0o600});await rename(temp,this.file);}
    finally{await unlink(temp).catch(error=>{if((error as NodeJS.ErrnoException).code!=="ENOENT")throw Error(STORAGE_ERROR);});}
  }
  async load():Promise<XLocalSession|undefined>{
    if(!this.supported)return undefined;
    return this.enqueue(async()=>{
      const value=await this.raw();if(value===undefined)return undefined;
      try{
        const decoded=JSON.parse(await this.cipher.unprotect(value)) as {version:number;vaultId:string;session:XLocalSession};
        if(decoded.version!==1||decoded.vaultId!==this.vaultId)throw Error(STORAGE_ERROR);
        return validateLocalSession(decoded.session.accountSession,decoded.session.csrf);
      }catch(error){throw Error(error instanceof Error&&error.message.startsWith(STORAGE_ERROR)?error.message:STORAGE_ERROR);}
    });
  }
  private mutate(value:XLocalSession|undefined,commit:()=>Promise<void>):Promise<void>{
    return this.enqueue(async()=>{
      if(!this.supported){await commit();return;}
      const previous=await this.raw();
      if(value){
        const session=validateLocalSession(value.accountSession,value.csrf);
        let encrypted:string;
        try{encrypted=await this.cipher.protect(JSON.stringify({version:1,vaultId:this.vaultId,session}));}catch(error){throw Error(error instanceof Error&&error.message.startsWith(STORAGE_ERROR)?error.message:STORAGE_ERROR);}
        if(!encrypted||encrypted.length>65536||!/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted))throw Error(STORAGE_ERROR);
        await this.write(encrypted);
      }else await unlink(this.file).catch(error=>{if((error as NodeJS.ErrnoException).code!=="ENOENT")throw Error(STORAGE_ERROR);});
      try{await commit();}
      catch{
        try{if(previous===undefined)await unlink(this.file).catch(error=>{if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;});else await this.write(previous);}
        catch{throw Error("Could not restore the encrypted session after a settings error. Reconnect X.");}
        throw Error(STORAGE_ERROR);
      }
    });
  }
  saveAndCommit(value:XLocalSession,commit:()=>Promise<void>):Promise<void>{return this.mutate(value,commit);}
  forgetAndCommit(commit:()=>Promise<void>):Promise<void>{return this.mutate(undefined,commit);}
}
