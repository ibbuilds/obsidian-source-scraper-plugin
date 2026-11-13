import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {diagnoseIntegration,REQUIRED_ENGINE_CAPABILITIES} from '../../src/integration-health.ts';
import {sourceScraperToolDefinitions} from '../../src/mcp-provider.ts';
const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
test('diagnostics separate host, trust, engine compatibility and cloud discovery without writes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ss-health-'));
 try{
  const workspace=join(root,'workspace'),vault=join(root,'vault');mkdirSync(workspace);mkdirSync(vault);
  const cli=join(workspace,'cli.mjs'),project=join(workspace,'project.json');
  writeFileSync(cli,`if(process.argv[2]!=='version')throw Error('source execution forbidden');console.log(JSON.stringify(${JSON.stringify({name:'source-scraper',version:'test',jsonSchemaVersion:1,capabilities:REQUIRED_ENGINE_CAPABILITIES})}));`);
  writeFileSync(project,JSON.stringify({id:'health-test',name:'Health test',sources:[{id:'local',adapter:'json-file',config:{path:'observations.json'}}],pipeline:['extract-links'],evaluator:'keyword',policy:{includeKeywords:[],excludeKeywords:[],minimumScore:0},outputs:[]}));
  const input={pluginVersion:'1.1.0',vaultPath:vault,settings:{cliPath:cli,mcpCliHash:hash(cli),nodeExecutable:process.execPath,mcpWorkspacePath:workspace,mcpProjectsJson:JSON.stringify([{id:'health-test',configPath:project,manifestHash:hash(project)}]),mcpEnabled:'true'},host:{present:true,apiVersion:1,providerEnabled:true,registeredTools:28}};
  const good=await diagnoseIntegration(input);assert.equal(good.localReady,true);assert.equal(good.engineVersion,'test');assert.equal(good.checks.find(c=>c.id==='chatgpt-discovery')?.status,'pending');assert.equal(good.sourceRequests,0);assert.equal(good.noteWrites,0);
  const bad=await diagnoseIntegration({...input,settings:{...input.settings,mcpCliHash:'0'.repeat(64)},host:{...input.host,apiVersion:0}});assert.equal(bad.localReady,false);assert.equal(bad.checks.find(c=>c.id==='engine-contract')?.status,'pending');assert.equal(bad.checks.find(c=>c.id==='host-api')?.status,'fail');
  writeFileSync(project,readFileSync(project,'utf8')+' ');assert.equal((await diagnoseIntegration(input)).checks.find(c=>c.id==='projects')?.status,'fail');
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('tool inventory is stable, isolated, namespaced and honest about external actions',()=>{
 const tools=sourceScraperToolDefinitions();assert.equal(tools.length,33);assert.equal(new Set(tools.map(t=>t.name)).size,33);
 assert.ok(tools.find(t=>t.name==='source_scraper_review_posts')?.annotations.openWorldHint);
 for(const t of tools){assert.match(t.name,/^source_scraper_/);assert.equal(t.inputSchema.additionalProperties,false);}
 assert.ok(tools.find(t=>t.name==='source_scraper_control_cycle')?.annotations.openWorldHint);
 assert.ok(tools.find(t=>t.name==='source_scraper_control_feedback')?.annotations.openWorldHint);
 assert.ok(!tools.some(t=>t.name==='source_scraper_save_selected_notes'));
 tools[0].inputSchema.required.push('mutated');assert.ok(!sourceScraperToolDefinitions()[0].inputSchema.required.includes('mutated'));
});
