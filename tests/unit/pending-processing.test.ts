import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {SourceScraperProvider} from "../../src/mcp-provider.ts";
import {DEFAULT_NOTE_MAPPING_JSON} from "../../src/note-mapping.ts";

test("durable public enrichment advances without continuous collection, resource checks, AI or X credentials",async()=>{
 const root=mkdtempSync(join(tmpdir(),"ss-processing-")),cli=join(root,"cli.mjs"),configPath=join(root,"project.json"),sha=(v:string|Buffer)=>createHash("sha256").update(v).digest("hex");let provider:SourceScraperProvider|undefined;
 try{
  const manifest={id:"public-links",name:"Public links",sources:[{id:"fixture",adapter:"json-file",config:{path:"items.json"}}],pipeline:["observation-entity","public-metadata"],evaluator:"keyword",policy:{includeKeywords:[],excludeKeywords:[],minimumScore:0},outputs:[]},raw=JSON.stringify(manifest);writeFileSync(configPath,raw);writeFileSync(join(root,"items.json"),"[]");writeFileSync(join(root,".source-scraper.sqlite"),"");
  writeFileSync(cli,`const c=process.argv[2];if(c==='version')console.log(JSON.stringify({name:'source-scraper',jsonSchemaVersion:1,capabilities:['agent-assessments-v1','selected-entity-export-v1','pending-processing-v1','pending-processing-v2']}));else {if(c!=='process-pending'||process.env.SOURCE_SCRAPER_X_ACCOUNT_SESSION||process.env.SOURCE_SCRAPER_X_CSRF||process.env.SOURCE_SCRAPER_X_LOCAL_APPROVED)throw Error('unexpected source/credential');console.log(JSON.stringify({result:{processed:1,pending:0,attemptedUrls:1,completedUrls:1,unavailableUrls:0,blocked:0,lastSuccessAt:'2026-11-13T00:00:00Z'},retryFailed:process.argv.includes('--retry-failed')}));}`);
  provider=new SourceScraperProvider({cliPath:cli,cliHash:sha(readFileSync(cli)),nodeExecutable:process.execPath,projects:[{id:manifest.id,configPath,manifestHash:sha(raw)}],workspacePath:root,statePath:join(root,"state.json"),vaultPath:join(root,"vault"),activeProjectId:()=>manifest.id,allowXProvider:true,getXSession:()=>({accountSession:"synthetic-session",csrf:"synthetic-csrf"}),localFeedbackEnabled:()=>false,mapping:()=>DEFAULT_NOTE_MAPPING_JSON,pathExists:()=>false,stage:()=>{},checkRead:()=>{},readReference:async()=>""});
  assert.equal(provider.cycle.snapshot().continuous,undefined);await (provider as any).pendingProcessingTick();const state=provider.processingStatus(manifest.id);assert.equal(state.error,undefined,JSON.stringify(state));assert.equal(state.completedUrls,1);assert.equal(state.pending,0);assert.equal(provider.processingStatus("other").pending,null);
  const retry:any=await provider.execute('source_scraper_process_pending',{projectId:manifest.id,retryFailed:true});assert.equal(retry.retryFailed,true);await assert.rejects(provider.execute('source_scraper_process_pending',{projectId:manifest.id,retryFailed:'true'}),/INVALID_INPUT/);
 }finally{provider?.dispose();rmSync(root,{recursive:true,force:true});}
});
