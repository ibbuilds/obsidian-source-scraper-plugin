import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,readdirSync,symlinkSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
// @ts-ignore Node-only distribution installer is intentionally plain JavaScript.
import {planInstallation,applyInstallation} from '../../scripts/install-integration.mjs';
const sha=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'ss-install-')),bundle=join(root,'bundle'),vault=join(root,'vault'),workspace=join(root,'workspace');for(const p of [bundle,vault,workspace])mkdirSync(p);
 writeFileSync(join(vault,'References.md'),'Existing private note');const files:Record<string,string>={};
 for(const id of ['engine','source-scraper','vault-as-mcp']){mkdirSync(join(bundle,id));for(const name of id==='engine'?['source-scraper.mjs']:['main.js','manifest.json','styles.css']){const bytes=name==='manifest.json'?JSON.stringify({id,version:'1.1.0'}):'synthetic build '+name;writeFileSync(join(bundle,id,name),bytes);files[id+'/'+name]=sha(bytes);}}
 writeFileSync(join(bundle,'integration.json'),JSON.stringify({schemaVersion:1,engineCommit:'a'.repeat(40),pluginCommit:'b'.repeat(40),hostCommit:'c'.repeat(40),files,noteWritesSupported:false}));
 return {root,bundle,vault,workspace,node:process.execPath};
}
test('installer is read-only by default and installs only allowlisted code/config, preserving notes and secrets',()=>{
 const f=fixture();try{
  mkdirSync(join(f.vault,'.obsidian','plugins','vault-as-mcp'),{recursive:true});
  writeFileSync(join(f.vault,'.obsidian','plugins','vault-as-mcp','data.json'),JSON.stringify({apiKey:'private-test-only',enabledToolProviders:['other'],port:5555}));
  const before=readdirSync(f.workspace);const plan=planInstallation(f);assert.deepEqual(readdirSync(f.workspace),before);
  assert.throws(()=>applyInstallation(plan),/Close Obsidian/);assert.throws(()=>applyInstallation(plan,{obsidianClosed:true}),/fingerprint/);
  const result=applyInstallation(plan,{obsidianClosed:true,trustBundle:plan.manifestHash});assert.equal(result.noteWrites,0);assert.equal(result.sourceRuns,0);
  assert.equal(readFileSync(join(f.vault,'References.md'),'utf8'),'Existing private note');
  const host=JSON.parse(readFileSync(join(f.vault,'.obsidian/plugins/vault-as-mcp/data.json'),'utf8'));assert.equal(host.apiKey,'private-test-only');assert.equal(host.port,5555);assert.deepEqual(host.enabledToolProviders,['other','source-scraper']);
  const settings=JSON.parse(readFileSync(join(f.vault,'.obsidian/plugins/source-scraper/data.json'),'utf8'));assert.equal(settings.mcpEnabled,'true');assert.equal(settings.xProviderEnabled,undefined);assert.equal(settings.xLikesEnabled,undefined);assert.equal(JSON.parse(settings.mcpProjectsJson).length,1);
  assert.equal(planInstallation(f).targets.length,0,'second installation is idempotent');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('tampered bundles, nested workspaces and linked plugin destinations fail before writes',()=>{
 const f=fixture();try{
  assert.throws(()=>planInstallation({...f,workspace:f.vault}),/Workspace/);
  assert.throws(()=>planInstallation({...f,trustBundle:'0'.repeat(64)}),/fingerprint/);
  writeFileSync(join(f.bundle,'source-scraper/main.js'),'changed');assert.throws(()=>planInstallation(f),/fingerprint/);assert.deepEqual(readdirSync(f.workspace),[]);
 }finally{rmSync(f.root,{recursive:true,force:true});}
 const g=fixture();try{mkdirSync(join(g.vault,'.obsidian','plugins'),{recursive:true});symlinkSync(g.workspace,join(g.vault,'.obsidian/plugins/source-scraper'),process.platform==='win32'?'junction':'dir');assert.throws(()=>planInstallation(g),/Linked/);}finally{rmSync(g.root,{recursive:true,force:true});}
});
test('failed installation restores owned files and never changes user notes',()=>{
 const f=fixture();try{
  const plan=planInstallation(f);assert.throws(()=>applyInstallation(plan,{obsidianClosed:true,trustBundle:plan.manifestHash,beforeWrite:(n:number)=>{if(n===2)throw Error('synthetic interruption');}}),/rolled back/);
  assert.equal(existsSync(join(f.vault,'.obsidian/plugins/source-scraper/main.js')),false);assert.equal(readFileSync(join(f.vault,'References.md'),'utf8'),'Existing private note');assert.equal(existsSync(join(f.vault,'.obsidian/.source-scraper-install.lock')),false);
  const backups=join(f.workspace,'installation-backups');const receipt=JSON.parse(readFileSync(join(backups,readdirSync(backups)[0],'receipt.json'),'utf8'));assert.equal(receipt.status,'rolled-back');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('concurrent changes are preserved, never silently overwritten',()=>{
 const f=fixture();try{
  const plan=planInstallation(f);const target=plan.targets[0].path;mkdirSync(join(f.vault,'.obsidian/plugins/source-scraper'),{recursive:true});writeFileSync(target,'concurrent content');
  assert.throws(()=>applyInstallation(plan,{obsidianClosed:true,trustBundle:plan.manifestHash}),/changed after planning/);assert.equal(readFileSync(target,'utf8'),'concurrent content');assert.deepEqual(readdirSync(f.workspace),[]);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
