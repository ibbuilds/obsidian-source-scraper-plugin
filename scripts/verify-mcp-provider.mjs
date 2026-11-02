import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,lstatSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {SourceScraperProvider} from "../src/mcp-provider.ts";
import {DEFAULT_NOTE_MAPPING_JSON} from "../src/note-mapping.ts";

const binary=resolve(process.argv[2]||"../engine/dist/source-scraper.mjs");
const root=mkdtempSync(join(tmpdir(),"ss-mcp-integration-")),workspace=join(root,"projects"),vault=join(root,"vault");
mkdirSync(workspace);mkdirSync(vault);writeFileSync(join(vault,"References.md"),"Existing user note\n");
const init=spawnSync(process.execPath,[binary,"init","--dir",join(workspace,"offline")],{encoding:"utf8"});
assert.equal(init.status,0,init.stderr);
const configPath=join(workspace,"offline","project.json"),hash=s=>createHash("sha256").update(s).digest("hex");
const vaultApi={
  getAbstractFileByPath(path){const p=join(vault,path);return existsSync(p)?{path,...(lstatSync(p).isDirectory()?{children:[]}:{})}:null;},
  async createFolder(path){mkdirSync(join(vault,path));},
  async create(path,content){writeFileSync(join(vault,path),content,{flag:"wx"});}
};
let staged;
const options={cliPath:binary,cliHash:hash(readFileSync(binary)),nodeExecutable:process.execPath,
  projects:[{id:"starter-project",configPath,manifestHash:hash(readFileSync(configPath))}],workspacePath:workspace,
  statePath:join(root,"state.json"),vaultPath:vault,pathExists:path=>Boolean(vaultApi.getAbstractFileByPath(path)),
  mapping:()=>DEFAULT_NOTE_MAPPING_JSON,stage:v=>{staged=v;},checkRead:()=>{},readReference:async()=>"Synthetic reference"};
let provider=new SourceScraperProvider(options);
const call=(name,args={})=>provider.execute("source_scraper_"+name,args);
await assert.rejects(call("run_project",{projectId:"arbitrary",requestId:"wrong"}),/PROJECT_NOT_ALLOWED/);
await assert.rejects(call("list_projects",{shell:"whoami"}),/INVALID_INPUT/);
const job=await call("run_project",{projectId:"starter-project",requestId:"run-1"});
assert.equal((await call("run_project",{projectId:"starter-project",requestId:"run-1"})).id,job.id);
let status;
for(let i=0;i<200;i++){status=await call("get_run_status",{jobId:job.id});if(!["running","queued"].includes(status.state))break;await new Promise(r=>setTimeout(r,25));}
assert.equal(status.state,"succeeded",JSON.stringify(status));
const findings=await call("list_findings",{projectId:"starter-project",limit:100});
assert.ok(findings.count>=2);const selected=findings.records.slice(0,2).map(e=>e.key);
const filter={version:1,sourceIds:["local-observations"],entity:{fields:["key"],includeTerms:[selected[0]],matchMode:"substring"}};
const filtered=await call("list_findings",{projectId:"starter-project",limit:1,filters:filter});
assert.deepEqual(filtered.records.map(e=>e.key),[selected[0]]);assert.ok(filtered.filtering);
assert.equal((await call("list_findings",{projectId:"starter-project",filters:{version:1,entity:{fields:["key"],excludeTerms:selected,matchMode:"substring"}}})).records.some(e=>selected.includes(e.key)),false);
assert.equal((await call("list_findings",{projectId:"starter-project",limit:100})).count,findings.count,"filter requests never delete stored evidence");
await assert.rejects(call("run_project",{projectId:"starter-project",requestId:"unknown-source",sourceIds:["unregistered"]}),/INVALID_FILTER/);
const scoped=await call("run_project",{projectId:"starter-project",requestId:"source-scope",sourceIds:["local-observations"]});
for(let i=0;i<200;i++){status=await call("get_run_status",{jobId:scoped.id});if(!["running","queued"].includes(status.state))break;await new Promise(r=>setTimeout(r,25));}
assert.equal(status.state,"succeeded",JSON.stringify(status));
const oldCli=join(root,"old-cli.mjs");writeFileSync(oldCli,'console.log(JSON.stringify({name:"source-scraper",jsonSchemaVersion:1,capabilities:["agent-assessments-v1","selected-entity-export-v1"]}));');
const oldProvider=new SourceScraperProvider({...options,cliPath:oldCli,cliHash:hash(readFileSync(oldCli)),statePath:join(root,"old-state.json")});
await assert.rejects(oldProvider.execute("source_scraper_list_findings",{projectId:"starter-project",filters:filter}),/collection-filters-v1/);oldProvider.dispose();

const detail=await call("inspect_finding",{projectId:"starter-project",key:selected[0]});
const assessment={evidenceFingerprint:detail.fingerprint,rubric:"Synthetic acceptance rubric: traceable source evidence and clear utility",recommendation:"recommend",
  reasons:["Synthetic test judgment; not an actual LLM evaluation"],uncertainties:["License not independently verified"],references:[],actor:"acceptance-harness",model:"simulated"};
await call("record_ai_assessment",{projectId:"starter-project",key:selected[0],assessment});
const agentRecords=await call("list_assessments",{projectId:"starter-project",key:selected[0]});
assert.equal(agentRecords.records.length,1);assert.equal(agentRecords.records[0].stale,false);
assert.equal((await call("inspect_finding",{projectId:"starter-project",key:selected[0]})).entity.review,"pending");
await call("stage_findings",{projectId:"starter-project",keys:selected});assert.equal(staged.records.length,2);
assert.equal(readFileSync(join(vault,"References.md"),"utf8"),"Existing user note\n");
const preview=await call("preview_selected_notes",{projectId:"starter-project",keys:selected,folder:"Acceptance/New"});
assert.equal(existsSync(join(vault,"Acceptance")),false);
assert.equal(preview.noteWritesSupported,false);
assert.equal(provider.tools.some(t=>t.name==="source_scraper_save_selected_notes"),false);
await assert.rejects(call("save_selected_notes",{previewId:"invented",requestId:"save-1"}),/INVALID_INPUT/);
assert.equal(existsSync(join(vault,"Acceptance")),false);
provider.dispose();provider=new SourceScraperProvider(options);await provider.restoreQueue();assert.equal(staged.records.length,2);
writeFileSync(configPath,readFileSync(configPath,"utf8")+"\n");
await assert.rejects(call("validate_project",{projectId:"starter-project"}),/SOURCE_NOT_TRUSTED/);
assert.equal(readFileSync(join(vault,"References.md"),"utf8"),"Existing user note\n");
provider.dispose();console.log(JSON.stringify({passed:true,realCli:true,genericFilters:true,sourceSelection:true,oldCliFailsClosed:true,simulatedAssessment:true,entities:findings.count,staged:2,
  createdInSyntheticVault:0,noNoteWriteTool:true,jobRetryIdempotent:true,draftsReadOnly:true,restartQueue:true,manifestTrust:true,personalVaultWrites:0,evidenceDirectory:root}));
