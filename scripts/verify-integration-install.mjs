import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {planInstallation,applyInstallation} from './install-integration.mjs';
const bundle=resolve(process.argv[2]),root=mkdtempSync(join(tmpdir(),'ss-bundle-acceptance-'));
try{
 const vault=join(root,'vault'),workspace=join(root,'workspace');mkdirSync(vault);mkdirSync(workspace);
 writeFileSync(join(vault,'References.md'),'Protected synthetic reference');
 const plan=planInstallation({bundle,vault,workspace}),result=applyInstallation(plan,{obsidianClosed:true,trustBundle:plan.manifestHash});
 assert.equal(result.noteWrites,0);assert.equal(result.sourceRuns,0);
 assert.equal(readFileSync(join(vault,'References.md'),'utf8'),'Protected synthetic reference');
 const settings=JSON.parse(readFileSync(join(vault,'.obsidian/plugins/source-scraper/data.json'),'utf8'));
 const invoke=(...args)=>JSON.parse(execFileSync(process.execPath,[settings.cliPath,...args],{encoding:'utf8',maxBuffer:9_000_000,timeout:30000}));
 const version=invoke('version');assert.equal(version.version,'0.15.0');assert.ok(version.capabilities.includes('resource-admission-v1'));
 const project=JSON.parse(settings.mcpProjectsJson)[0];assert.equal(invoke('validate','--config',project.configPath).valid,true);
 const run=invoke('run','--config',project.configPath);assert.equal(run.result.success,true);
 const data=invoke('export','--config',project.configPath);assert.equal(data.count,1);assert.equal(data.records[0].url,'https://example.org/resource');
 assert.equal(planInstallation({bundle,vault,workspace}).targets.length,0);
 assert.equal(readFileSync(join(vault,'References.md'),'utf8'),'Protected synthetic reference');
 console.log(JSON.stringify({installedBundle:true,offlineStarterEntities:data.count,idempotent:true,notesChanged:0,networkRequests:0,deviceAcceptance:'synthetic-only',cloudConnectorAcceptance:'not-tested'}));
}finally{rmSync(root,{recursive:true,force:true});}
