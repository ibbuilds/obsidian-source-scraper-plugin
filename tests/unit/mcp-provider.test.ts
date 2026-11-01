import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync} from "node:fs";
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
    assert.equal(provider.tools.length,15);assert.equal(new Set(provider.tools.map(t=>t.name)).size,15);
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
