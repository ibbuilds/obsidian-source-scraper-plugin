import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {isAbsolute,relative,sep} from 'node:path';
import {CliBridge} from './cli-bridge.ts';
import {parseProjectManifest} from './project-manifest.ts';
export const REQUIRED_ENGINE_CAPABILITIES=[
  'agent-assessments-v1','selected-entity-export-v1','collection-filters-v1',
  'candidate-thresholds-v1','resource-batch-v1','resource-quality-v1','resource-admission-v1'
] as const;
export type HealthCheck={id:string;status:'pass'|'fail'|'pending';message:string};
export interface IntegrationHealthInput {
  pluginVersion:string;vaultPath:string;
  settings:{cliPath:string;mcpCliHash:string;nodeExecutable:string;mcpWorkspacePath:string;mcpProjectsJson:string;mcpEnabled:string};
  host:{present:boolean;apiVersion?:number;providerEnabled:boolean;registeredTools:number};
}
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function boundedRead(path:string,max:number):Buffer{
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw Error('Invalid local file');
  return readFileSync(path);
}
/** Explicit local diagnostic: only a trusted CLI's version command is run. No source, note or settings writes. */
export async function diagnoseIntegration(input:IntegrationHealthInput){
  const checks:HealthCheck[]=[];
  const add=(id:string,pass:boolean,message:string)=>checks.push({id,status:pass?'pass':'fail',message});
  const s=input.settings;
  add('mcp-enabled',s.mcpEnabled==='true','Enable MCP access in Source Scraper settings.');
  add('host-installed',input.host.present,'The existing Vault as MCP host must be enabled.');
  add('host-api',input.host.apiVersion===1,'Use the reviewed host build with provider API v1.');
  add('host-permission',input.host.providerEnabled,'Enable source-scraper in the host enabledToolProviders setting.');
  add('provider-registration',input.host.registeredTools===28,`Registered Source Scraper tools: ${input.host.registeredTools}; expected 28.`);
  let workspaceReady=false,cliReady=false,nodeReady=false;
  try{
    const workspace=realpathSync(s.mcpWorkspacePath),vault=realpathSync(input.vaultPath),r=relative(vault,workspace);
    workspaceReady=isAbsolute(s.mcpWorkspacePath)&&lstatSync(workspace).isDirectory()&&Boolean(r)&&(isAbsolute(r)||r==='..'||r.startsWith('..'+sep));
  }catch{/* Report a bounded diagnostic, never raw private paths. */}
  add('workspace',workspaceReady,'Configure an existing absolute project workspace outside the vault.');
  try{cliReady=isAbsolute(s.cliPath)&&/^[a-f0-9]{64}$/.test(s.mcpCliHash)&&digest(boundedRead(s.cliPath,16_000_000))===s.mcpCliHash;}catch{}
  add('cli-trust',cliReady,'The installed CLI must match its locally registered SHA-256.');
  try{nodeReady=isAbsolute(s.nodeExecutable)&&lstatSync(realpathSync(s.nodeExecutable)).isFile();}catch{}
  add('node',nodeReady,'Configure an absolute installed Node.js executable.');
  let projectsReady=false,projectCount=0;
  try{
    if(Buffer.byteLength(s.mcpProjectsJson)>1_000_000)throw Error('Registry too large');
    const entries=JSON.parse(s.mcpProjectsJson);
    if(!Array.isArray(entries)||entries.length<1||entries.length>100)throw Error('Registry missing');
    const ids=new Set<string>(),root=realpathSync(s.mcpWorkspacePath);
    for(const p of entries){
      if(!p||typeof p.id!=='string'||ids.has(p.id)||!isAbsolute(p.configPath)||!/^[a-f0-9]{64}$/.test(p.manifestHash))throw Error('Registry invalid');
      ids.add(p.id);const path=realpathSync(p.configPath),r=relative(root,path);
      if(!r||isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('Project outside workspace');
      const bytes=boundedRead(p.configPath,1_000_000);
      if(digest(bytes)!==p.manifestHash||parseProjectManifest(bytes.toString('utf8')).id!==p.id)throw Error('Project changed');
    }
    projectCount=entries.length;projectsReady=true;
  }catch{}
  add('projects',projectsReady,'Register at least one valid project manifest with its current digest.');
  let engineVersion:string|undefined;
  if(cliReady&&nodeReady){
    const bridge=new CliBridge();
    try{
      const value=await bridge.invoke({cliPath:s.cliPath,nodeExecutable:s.nodeExecutable,configPath:'',allowXProvider:false,allowXLikes:false},'version') as {name?:string;version?:string;jsonSchemaVersion?:number;capabilities?:string[]};
      const compatible=value.name==='source-scraper'&&value.jsonSchemaVersion===1&&REQUIRED_ENGINE_CAPABILITIES.every(c=>value.capabilities?.includes(c));
      engineVersion=typeof value.version==='string'?value.version:undefined;
      add('engine-contract',compatible,compatible?'Required engine contracts verified.':'Update the trusted engine: required integration contracts are missing.');
    }catch{add('engine-contract',false,'The trusted CLI did not return a supported version response.');}
    finally{bridge.cancel();}
  }else checks.push({id:'engine-contract',status:'pending',message:'No process launched because local executable trust is not established.'});
  checks.push({id:'chatgpt-discovery',status:'pending',message:'After local checks pass, refresh the existing ChatGPT app tools and call source_scraper_capabilities. Local registration is not cloud discovery.'});
  return {schemaVersion:1,pluginVersion:input.pluginVersion,engineVersion,projectCount,localReady:checks.every(c=>c.status!=='fail'&&(c.status!=='pending'||c.id==='chatgpt-discovery')),checks,sourceRequests:0,noteWrites:0,xLiveVerification:'not-probed'};
}
