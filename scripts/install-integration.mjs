/** Offline, allowlisted installer. Defaults to a read-only plan; never collects sources or touches notes. */
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,writeFileSync,mkdirSync,renameSync,unlinkSync,realpathSync,openSync,closeSync} from 'node:fs';
import {resolve,relative,dirname,join,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const ASSETS=['engine/source-scraper.mjs','source-scraper/main.js','source-scraper/manifest.json','source-scraper/styles.css','vault-as-mcp/main.js','vault-as-mcp/manifest.json','vault-as-mcp/styles.css'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const within=(root,path)=>{const r=relative(root,path);return !r||!isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+sep);};
function file(path,max=16_000_000){const s=lstatSync(path);if(s.isSymbolicLink()||!s.isFile()||s.size>max)throw Error('Unsafe or oversized installation file');return readFileSync(path);}
function safe(root,path){
 if(!within(root,path))throw Error('Path escapes installation root');
 let p=path;while(p!==root){let stat;try{stat=lstatSync(p);}catch(error){if(error.code!=='ENOENT')throw error;}if(stat?.isSymbolicLink())throw Error('Linked installation path denied');p=dirname(p);}
 return path;
}
const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
function objectFile(path){if(!existsSync(path))return {};const value=JSON.parse(file(path,4_000_000));if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid existing settings; nothing changed');return value;}
/** Build the complete write set before creating any file or directory. */
export function planInstallation({bundle,vault,workspace,node=process.execPath,trustBundle}){
 for(const p of [bundle,vault,workspace,node])if(typeof p!=='string'||!isAbsolute(p))throw Error('Use absolute paths');
 bundle=realpathSync(bundle);vault=realpathSync(vault);workspace=realpathSync(workspace);node=realpathSync(node);
 if(!lstatSync(vault).isDirectory()||!lstatSync(workspace).isDirectory()||within(vault,workspace)||within(workspace,vault))throw Error('Workspace must be a separate existing directory outside the vault');
 if(!lstatSync(node).isFile())throw Error('Node executable missing');
 const metadata=file(safe(bundle,join(bundle,'integration.json')),1_000_000),manifestHash=sha(metadata),manifest=JSON.parse(metadata);
 if(trustBundle!==undefined&&trustBundle!==manifestHash)throw Error('Integration manifest fingerprint mismatch');
 if(manifest.schemaVersion!==1||manifest.noteWritesSupported!==false||![manifest.engineCommit,manifest.pluginCommit,manifest.hostCommit].every(v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v)))throw Error('Invalid integration provenance');
 const assets=new Map();for(const name of ASSETS){const bytes=file(safe(bundle,join(bundle,name)));if(!/^[a-f0-9]{64}$/.test(manifest.files?.[name])||sha(bytes)!==manifest.files[name])throw Error('Bundle artifact fingerprint mismatch: '+name);assets.set(name,bytes);}
 for(const id of ['source-scraper','vault-as-mcp']){const m=JSON.parse(assets.get(id+'/manifest.json'));if(m.id!==id)throw Error('Plugin identity mismatch');}
 const config=safe(vault,join(vault,'.obsidian')),targets=[];
 const add=(root,target,bytes,immutable=false)=>{
  safe(root,target);const before=existsSync(target)?file(target):null;
  if(immutable&&before&&!before.equals(bytes))throw Error('Existing runtime or starter file differs; preserving it');
  if(!before?.equals(bytes))targets.push({root,path:target,before,after:bytes});
 };
 for(const id of ['source-scraper','vault-as-mcp'])for(const name of ['main.js','manifest.json','styles.css'])add(vault,join(config,'plugins',id,name),assets.get(id+'/'+name));
 const enginePath=safe(workspace,join(workspace,'runtime',manifest.files['engine/source-scraper.mjs'],'source-scraper.mjs'));
 add(workspace,enginePath,assets.get('engine/source-scraper.mjs'),true);
 const settingsPath=safe(vault,join(config,'plugins','source-scraper','data.json')),settings=objectFile(settingsPath);
 const projects=JSON.parse(settings.mcpProjectsJson??'[]');if(!Array.isArray(projects)||projects.length>100)throw Error('Invalid project registry');
 const ids=new Set();for(const p of projects){
  if(!p||typeof p.id!=='string'||ids.has(p.id)||typeof p.configPath!=='string'||!isAbsolute(p.configPath))throw Error('Invalid project registry');ids.add(p.id);
  const bytes=file(safe(workspace,p.configPath),1_000_000);if(sha(bytes)!==p.manifestHash||JSON.parse(bytes).id!==p.id)throw Error('Existing project trust changed; verify it locally before installation');
 }
 if(projects.length===0){
  const projectDir=join(workspace,'projects','source-scraper-starter'),projectPath=join(projectDir,'project.json');
  const observations=[{id:'local-example',type:'example',title:'Local example — not your X feed',url:'https://example.org/post',urls:['https://example.org/resource'],text:'Synthetic resource used to verify the local integration.'}];
  const project={id:'source-scraper-starter',name:'Local example — not your X feed',sources:[{id:'local-example',adapter:'json-file',config:{path:'observations.json'}}],pipeline:['linked-resources'],evaluator:'keyword',policy:{includeKeywords:[],excludeKeywords:[],minimumScore:0},outputs:[]};
  const bytes=jsonBytes(project);add(workspace,projectPath,bytes,true);add(workspace,join(projectDir,'observations.json'),jsonBytes(observations),true);
  projects.push({id:project.id,configPath:projectPath,manifestHash:sha(bytes)});
 }
 const configured={...settings,cliPath:enginePath,mcpCliHash:manifest.files['engine/source-scraper.mjs'],nodeExecutable:node,mcpWorkspacePath:workspace,mcpProjectsJson:JSON.stringify(projects),mcpEnabled:'true',configPath:settings.configPath||projects[0].configPath};
 add(vault,settingsPath,jsonBytes(configured));
 const hostPath=safe(vault,join(config,'plugins','vault-as-mcp','data.json')),host=objectFile(hostPath);
 if(host.enabledToolProviders!==undefined&&(!Array.isArray(host.enabledToolProviders)||host.enabledToolProviders.some(v=>typeof v!=='string')))throw Error('Invalid host provider configuration');
 add(vault,hostPath,jsonBytes({...host,enabledToolProviders:[...new Set([...(host.enabledToolProviders??[]),'source-scraper'])]}));
 const enabledPath=safe(vault,join(config,'community-plugins.json'));
 const enabled=existsSync(enabledPath)?JSON.parse(file(enabledPath,1_000_000)):[];
 if(!Array.isArray(enabled)||enabled.some(v=>typeof v!=='string'))throw Error('Invalid enabled plugin list');
 add(vault,enabledPath,jsonBytes([...new Set([...enabled,'vault-as-mcp','source-scraper'])]));
 return {schemaVersion:1,vault,workspace,manifestHash,targets,engineCommit:manifest.engineCommit,pluginCommit:manifest.pluginCommit,projectCount:projects.length};
}
function atomic(root,path,bytes){safe(root,path);mkdirSync(dirname(path),{recursive:true});safe(root,path);const temp=path+'.'+randomUUID()+'.tmp';try{writeFileSync(temp,bytes,{flag:'wx',mode:0o600});renameSync(temp,path);}finally{if(existsSync(temp))unlinkSync(temp);}}
const equalCurrent=(path,bytes)=>bytes===null?!existsSync(path):existsSync(path)&&sha(file(path))===sha(bytes);
export function applyInstallation(plan,{obsidianClosed=false,trustBundle,beforeWrite}={}){
 if(!obsidianClosed)throw Error('Close Obsidian and explicitly pass --obsidian-closed');
 if(trustBundle!==plan.manifestHash)throw Error('Explicit --trust-bundle fingerprint required');
 for(const item of plan.targets){safe(item.root,item.path);if(!equalCurrent(item.path,item.before))throw Error('Installation changed after planning; nothing changed');}
 const config=safe(plan.vault,join(plan.vault,'.obsidian'));mkdirSync(config,{recursive:true});
 const lock=safe(plan.vault,join(config,'.source-scraper-install.lock'));const fd=openSync(lock,'wx',0o600);
 const backup=safe(plan.workspace,join(plan.workspace,'installation-backups',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()));
 const written=[];let receipt;
 try{
  mkdirSync(backup,{recursive:true,mode:0o700});
  const records=plan.targets.map((item,index)=>{if(item.before!==null)writeFileSync(join(backup,index+'.bak'),item.before,{flag:'wx',mode:0o600});return {path:item.path,root:item.root,before:item.before===null?null:sha(item.before),after:sha(item.after),backup:item.before===null?null:index+'.bak'};});
  receipt={schemaVersion:1,status:'prepared',vault:plan.vault,workspace:plan.workspace,manifestHash:plan.manifestHash,records};
  writeFileSync(join(backup,'receipt.json'),jsonBytes(receipt),{flag:'wx',mode:0o600});
  for(const item of plan.targets){
   beforeWrite?.(written.length);safe(item.root,item.path);
   if(!equalCurrent(item.path,item.before))throw Error('Concurrent installation change; rolling back owned writes');
   atomic(item.root,item.path,item.after);written.push(item);
  }
  receipt.status='installed';atomic(plan.workspace,join(backup,'receipt.json'),jsonBytes(receipt));
  return {installed:true,filesChanged:written.length,projectCount:plan.projectCount,backupDirectory:backup,noteWrites:0,sourceRuns:0,xPermissionChanged:false,cloudConnectorAcceptance:'not-tested'};
 }catch(error){
  const conflicts=[];
  for(const item of written.reverse()){
   try{safe(item.root,item.path);if(!equalCurrent(item.path,item.after)){conflicts.push(item.path);continue;}if(item.before===null)unlinkSync(item.path);else atomic(item.root,item.path,item.before);}catch{conflicts.push(item.path);}
  }
  if(receipt){receipt.status=conflicts.length?'rollback-needs-review':'rolled-back';receipt.conflicts=conflicts;try{atomic(plan.workspace,join(backup,'receipt.json'),jsonBytes(receipt));}catch{}}
  throw Error(conflicts.length?'Installation failed; preserve the private backup receipt and resolve rollback conflicts.':'Installation failed; owned changes were rolled back.',{cause:error});
 }finally{closeSync(fd);unlinkSync(lock);}
}
function args(argv){const options={};for(let i=0;i<argv.length;i++){
 const key=argv[i];if(['--apply','--obsidian-closed'].includes(key)){options[key.slice(2)]=true;continue;}
 if(!['--bundle','--vault','--workspace','--node','--trust-bundle'].includes(key)||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Invalid arguments');
 if(options[key.slice(2)]!==undefined)throw Error('Duplicate argument');options[key.slice(2)]=argv[++i];
 }return options;}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const a=args(process.argv.slice(2)),plan=planInstallation({bundle:a.bundle??dirname(fileURLToPath(import.meta.url)),vault:a.vault,workspace:a.workspace,node:a.node??process.execPath,trustBundle:a['trust-bundle']});
  const result=a.apply?applyInstallation(plan,{obsidianClosed:a['obsidian-closed']===true,trustBundle:a['trust-bundle']}):{dryRun:true,filesToChange:plan.targets.length,projectCount:plan.projectCount,manifestHash:plan.manifestHash,noteWrites:0,sourceRuns:0,next:'Review the plan, close Obsidian, and repeat with --apply --obsidian-closed --trust-bundle <manifestHash>.'};
  console.log(JSON.stringify(result,null,2));
 }catch(error){console.error(error instanceof Error?error.message:'Installation failed');process.exitCode=1;}
}
