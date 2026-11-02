import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {buildXFeedProject,validateLocalSession,xFeedReadiness,normalizeXAccountId,xFeedVariant} from "../../src/x-feed.ts";
import {cliEnvironment} from "../../src/cli-bridge.ts";
import {SourceScraperProvider,writeWorkspaceProject} from "../../src/mcp-provider.ts";
import {DEFAULT_NOTE_MAPPING_JSON} from "../../src/note-mapping.ts";
test("local setup accepts a numeric account ID or twid and versions changed filters without replacing the original",()=>{
  for(const value of ["123456","u=123456","u%3D123456",'"u=123456"'])assert.equal(normalizeXAccountId(value),"123456");
  for(const value of ["","u=abc","%bad","-1","u=123; other=value"])assert.throws(()=>normalizeXAccountId(value));
  const original=buildXFeedProject("123456","react","",50,1),changed=buildXFeedProject("123456","rust","",50,1);
  assert.equal(xFeedVariant(changed).id,xFeedVariant(changed).id);assert.notEqual(xFeedVariant(original).id,xFeedVariant(changed).id);
  assert.equal(original.id,"x-for-you-resources");assert.deepEqual(xFeedVariant(changed).outputs,[]);
});

test("masked local session values are bounded, never saved and only forwarded under a local grant",()=>{
  const session=validateLocalSession("synthetic-auth-value","synthetic-csrf-value");
  for(const value of ["","has space","newline\n","x".repeat(8193)])assert.throws(()=>validateLocalSession(value,"valid"),/Enter both/);
  assert.deepEqual(xFeedReadiness(session),{csrfConfigured:true,accountSessionConfigured:true});
  const disabled=cliEnvironment(false,undefined,session);
  assert.equal(disabled.SOURCE_SCRAPER_X_ACCOUNT_SESSION,undefined);
  const allowed=cliEnvironment(true,"/isolated/python",session);
  assert.equal(allowed.SOURCE_SCRAPER_X_ACCOUNT_SESSION,session.accountSession);
  assert.equal(allowed.SOURCE_SCRAPER_X_CSRF,session.csrf);
  assert.equal(allowed.SOURCE_SCRAPER_X_PYTHON,"/isolated/python");
  assert.notEqual(process.env.SOURCE_SCRAPER_X_ACCOUNT_SESSION,session.accountSession);
});

test("X setup produces a bounded credential-free discovery project with editable quality filters",()=>{
  const project=buildXFeedProject("1234567890","react, motion","giveaway",50,1);
  assert.equal(project.sources[0].adapter,"x-for-you-local");
  assert.deepEqual(project.sources[0].config,{accountId:"1234567890",pagesPerRun:1});
  assert.deepEqual(project.policy,{includeKeywords:["react","motion"],excludeKeywords:["giveaway"],minimumScore:50});
  assert.deepEqual(project.outputs,[]);assert.equal(project.pipeline[0],"x-discovery");
  assert.throws(()=>buildXFeedProject("not-numeric","react","",50,1),/numeric/);
  assert.throws(()=>buildXFeedProject("123","react","",50,11),/1–10/);
  assert.throws(()=>buildXFeedProject("123","react","",101,1),/minimumScore/);
});

test("local setup writes only outside the vault, is create-only and never creates note paths",()=>{
  const root=mkdtempSync(join(tmpdir(),"ss-x-workspace-"));
  try{
    const vault=join(root,"vault"),workspace=join(root,"workspace");mkdirSync(vault);mkdirSync(workspace);
    const project=buildXFeedProject("1234567890","react","",50,1);
    assert.throws(()=>writeWorkspaceProject(vault,vault,project),/WORKSPACE_IS_VAULT/);
    const installed=writeWorkspaceProject(workspace,vault,project),raw=readFileSync(installed.configPath,"utf8");
    assert.equal(installed.manifestHash,createHash("sha256").update(raw).digest("hex"));
    assert.deepEqual(JSON.parse(raw).outputs,[]);
    assert.throws(()=>writeWorkspaceProject(workspace,vault,project),/EEXIST/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("a disabled local grant strips inherited X credentials and approval, while an enabled grant never changes the parent environment",()=>{
  const names=["SOURCE_SCRAPER_X_PROVIDER_APPROVED","SOURCE_SCRAPER_GETXAPI_API_KEY","SOURCE_SCRAPER_X_ACCOUNT_SESSION","SOURCE_SCRAPER_X_CSRF","SOURCE_SCRAPER_X_LOCAL_APPROVED"];
  const prior=names.map(k=>process.env[k]);
  try{
    process.env[names[0]]="inherited-untrusted-grant";process.env[names[1]]="fixture-key";process.env[names[2]]="fixture-session";
    const disabled=cliEnvironment(false);assert.ok(names.every(k=>disabled[k]===undefined));
    const enabled=cliEnvironment(true);assert.equal(enabled.SOURCE_SCRAPER_X_LOCAL_APPROVED,"local-read-only");
    assert.equal(enabled.SOURCE_SCRAPER_GETXAPI_API_KEY,undefined);assert.equal(enabled.SOURCE_SCRAPER_X_PROVIDER_APPROVED,undefined);
    assert.equal(process.env[names[0]],"inherited-untrusted-grant");
  }finally{names.forEach((k,i)=>{if(prior[i]===undefined)delete process.env[k];else process.env[k]=prior[i];});}
});

test("MCP cannot enable the X provider or remotely register paid account sources; existing X findings remain readable when the grant is off",async()=>{
  const root=mkdtempSync(join(tmpdir(),"ss-x-provider-"));
  try{
    const vault=join(root,"vault"),workspace=join(root,"workspace");mkdirSync(vault);mkdirSync(workspace);
    const manifest=buildXFeedProject("1234567890","react","",50,1),project=writeWorkspaceProject(workspace,vault,manifest);
    const cliPath=join(root,"fake-cli.mjs");
    writeFileSync(cliPath,"const c=process.argv[2]; if(c==='version') console.log(JSON.stringify({name:'source-scraper',jsonSchemaVersion:1,capabilities:['agent-assessments-v1','selected-entity-export-v1']})); else if(c==='query') console.log(JSON.stringify({records:[]})); else throw Error('must not run');");
    const provider=new SourceScraperProvider({cliPath,cliHash:createHash("sha256").update(readFileSync(cliPath)).digest("hex"),nodeExecutable:process.execPath,
      projects:[project],workspacePath:workspace,statePath:join(root,"state.json"),vaultPath:vault,
      mapping:()=>DEFAULT_NOTE_MAPPING_JSON,pathExists:()=>false,stage:()=>{},checkRead:()=>{},readReference:async()=>""});
    try{
      const caps=await provider.execute("source_scraper_capabilities",{}) as {xFeed:{localGrant:boolean;liveVerified:boolean}};
      assert.equal(caps.xFeed.localGrant,false);assert.equal(caps.xFeed.liveVerified,false);
      await assert.rejects(provider.execute("source_scraper_run_project",{projectId:project.id,requestId:"test"}),/APPROVAL_REQUIRED/);
      await assert.rejects(provider.execute("source_scraper_run_project",{projectId:project.id,requestId:"test",allowXProvider:true}),/INVALID_INPUT/);
      await assert.rejects(provider.execute("source_scraper_create_project",{manifest:{...manifest,id:"other-x"}}),/SOURCE_NOT_TRUSTED/);
      assert.deepEqual(await provider.execute("source_scraper_list_findings",{projectId:project.id}),{records:[]});
    }finally{provider.dispose();}
  }finally{rmSync(root,{recursive:true,force:true});}
});
