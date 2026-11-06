import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync,symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {SourceScraperProvider,type ProviderOptions} from "../../src/mcp-provider.ts";
import {DEFAULT_NOTE_MAPPING_JSON} from "../../src/note-mapping.ts";

test("MCP grants are local, namespaced, bounded and cannot be expanded by tool arguments",async()=>{
  const root=mkdtempSync(join(tmpdir(),"ss-provider-policy-"));
  try{
    const options:ProviderOptions={cliPath:join(root,"not-installed.mjs"),cliHash:"",nodeExecutable:process.execPath,
      projects:[],workspacePath:root,statePath:join(root,"state.json"),vaultPath:root,
      mapping:()=>DEFAULT_NOTE_MAPPING_JSON,pathExists:()=>false,
      stage:()=>{throw Error("must not stage")},checkRead:()=>{},readReference:async()=>""};
    const provider=new SourceScraperProvider(options),call=(name:string,args:Record<string,unknown>={})=>provider.execute("source_scraper_"+name,args);
    assert.equal(provider.tools.length,27);assert.equal(new Set(provider.tools.map(t=>t.name)).size,27);
    assert.ok(provider.tools.every(t=>t.inputSchema.additionalProperties===false));
    await assert.rejects(call("list_projects",{command:"arbitrary"}),/INVALID_INPUT/);
    await assert.rejects(call("run_project",{projectId:"missing",requestId:"test"}),/PROJECT_NOT_ALLOWED/);
    await assert.rejects(call("save_selected_notes",{previewId:"invented",requestId:"test",userAuthorized:true}),/INVALID_INPUT/);
    await assert.rejects(call("save_selected_notes",{previewId:"invented",requestId:"test"}),/INVALID_INPUT/);
    const manifest={id:"unsafe-project",name:"Untrusted executable",sources:[{id:"untrusted",adapter:"mcp-stdio",config:{command:"node",args:["secret.js"],tool:"run"}}],
      pipeline:["observation-entity"],evaluator:"keyword",policy:{includeKeywords:[],excludeKeywords:[],minimumScore:0},outputs:[]};
    await assert.rejects(call("create_project",{manifest}),/SOURCE_NOT_TRUSTED/);
    const publicManifest={...manifest,sources:[{id:"public-source",adapter:"public-json",config:{url:"https://example.invalid/public.json"}}]};
    await assert.rejects(call("create_project",{manifest:publicManifest}),/WORKSPACE_IS_VAULT/);
    provider.dispose();await assert.rejects(call("capabilities"),/UNLOADED/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("changed local manifests fail before a subprocess or source can run",async()=>{
  const root=mkdtempSync(join(tmpdir(),"ss-provider-manifest-"));
  try{
    const projectPath=join(root,"project.json"),cliPath=join(root,"cli.mjs"),raw="{}\n";
    writeFileSync(projectPath,raw);writeFileSync(cliPath,"throw Error('must never execute');");
    const digest=(s:string)=>createHash("sha256").update(s).digest("hex");
    const provider=new SourceScraperProvider({cliPath,cliHash:digest(readFileSync(cliPath,"utf8")),nodeExecutable:process.execPath,
      projects:[{id:"local-project",configPath:projectPath,manifestHash:digest(raw)}],workspacePath:root,statePath:join(root,"state.json"),vaultPath:root,
      mapping:()=>DEFAULT_NOTE_MAPPING_JSON,pathExists:()=>false,
      stage:()=>{},checkRead:()=>{},readReference:async()=>""});
    writeFileSync(projectPath,raw+" ");
    await assert.rejects(provider.execute("source_scraper_validate_project",{projectId:"local-project"}),/manifest changed/);
    provider.dispose();
  }finally{rmSync(root,{recursive:true,force:true});}
});

for(const descendantLink of [false,true])test(descendantLink?
  "links below a trusted workspace remain forbidden even when they point inside it":
  "a trusted workspace may have a system-style alias above its root",async()=>{
  const root=mkdtempSync(join(tmpdir(),"ss-provider-root-alias-"));
  try{
    const physical=join(root,"physical"),alias=join(root,"alias");mkdirSync(physical);mkdirSync(join(physical,"workspace"));
    symlinkSync(physical,alias,process.platform==="win32"?"junction":"dir");
    const workspace=join(alias,"workspace");mkdirSync(join(workspace,"origin"));
    const path=join(workspace,"origin","project.json"),raw="{}\n";writeFileSync(path,raw);
    let configPath=path;
    if(descendantLink){symlinkSync(join(physical,"workspace","origin"),join(workspace,"linked"),process.platform==="win32"?"junction":"dir");configPath=join(workspace,"linked","project.json");}
    const digest=createHash("sha256").update(raw).digest("hex");
    const provider=new SourceScraperProvider({cliPath:join(root,"absent.mjs"),cliHash:"",nodeExecutable:process.execPath,
      projects:[{id:"local-project",configPath,manifestHash:digest}],workspacePath:workspace,statePath:join(root,"state.json"),vaultPath:root,
      mapping:()=>DEFAULT_NOTE_MAPPING_JSON,pathExists:()=>false,stage:()=>{},checkRead:()=>{},readReference:async()=>""});
    writeFileSync(path,raw+" ");
    await assert.rejects(provider.execute("source_scraper_validate_project",{projectId:"local-project"}),descendantLink?/linked project path/:/manifest changed/);
    provider.dispose();
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("non-X CLI work never inherits X session credentials or local read permission",async()=>{
 const root=mkdtempSync(join(tmpdir(),"ss-adapter-env-"));let provider:SourceScraperProvider|undefined;
 try{
  const cliPath=join(root,"fixture.mjs"),configPath=join(root,"project.json"),hash=(v:string)=>createHash("sha256").update(v).digest("hex");
  writeFileSync(cliPath,`const c=process.argv[2];console.log(JSON.stringify(c==='version'?{name:'source-scraper',jsonSchemaVersion:1,capabilities:['agent-assessments-v1','selected-entity-export-v1']}:{read:!!process.env.SOURCE_SCRAPER_X_LOCAL_APPROVED,session:!!process.env.SOURCE_SCRAPER_X_ACCOUNT_SESSION,csrf:!!process.env.SOURCE_SCRAPER_X_CSRF,python:!!process.env.SOURCE_SCRAPER_X_PYTHON}));`);
  writeFileSync(join(root,"items.json"),'[]');const manifest={id:"env-fixture",name:"Environment fixture",sources:[{id:"local",adapter:"json-file",config:{path:"items.json"}}],pipeline:["observation-entity"],evaluator:"keyword",policy:{includeKeywords:[],excludeKeywords:[],minimumScore:0},outputs:[]};
  for(const usesX of [false,true]){
   const raw=JSON.stringify({...manifest,sources:usesX?[{id:"x-local",adapter:"x-for-you-local",config:{accountId:"12345"}}]:manifest.sources});writeFileSync(configPath,raw);
   provider=new SourceScraperProvider({cliPath,cliHash:hash(readFileSync(cliPath,"utf8")),nodeExecutable:process.execPath,projects:[{id:manifest.id,configPath,manifestHash:hash(raw)}],workspacePath:root,statePath:join(root,"state.json"),vaultPath:join(root,"vault"),allowXProvider:true,xPythonPath:process.execPath,getXSession:()=>({accountSession:"synthetic-auth",csrf:"synthetic-csrf"}),mapping:()=>DEFAULT_NOTE_MAPPING_JSON,pathExists:()=>false,stage:()=>{},checkRead:()=>{},readReference:async()=>""});
   assert.deepEqual(await provider.execute("source_scraper_validate_project",{projectId:manifest.id}),{read:usesX,session:usesX,csrf:usesX,python:usesX});provider.dispose();provider=undefined;
  }
 }finally{provider?.dispose();rmSync(root,{recursive:true,force:true});}
});
