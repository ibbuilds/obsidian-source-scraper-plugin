import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";import {join,resolve,dirname} from "node:path";import {spawnSync} from "node:child_process";import {createHash} from "node:crypto";
import {SourceScraperProvider} from "../src/mcp-provider.ts";import {DEFAULT_NOTE_MAPPING_JSON} from "../src/note-mapping.ts";
const cli=resolve(process.argv[2]||"../engine/dist/source-scraper.mjs"),root=mkdtempSync(join(tmpdir(),"ss-manual-flow-")),workspace=join(root,"projects"),vault=join(root,"vault");mkdirSync(workspace);mkdirSync(vault);const note=join(vault,"References.md"),original="Fixture note must stay unchanged.\n";writeFileSync(note,original);
const hash=x=>createHash("sha256").update(x).digest("hex");let provider;
try{
 const projects=[];
 for(const id of ["manual-one","manual-two"]){const dir=join(workspace,id);const init=spawnSync(process.execPath,[cli,"init","--dir",dir],{encoding:"utf8"});assert.equal(init.status,0,init.stderr);const file=join(dir,"project.json"),manifest=JSON.parse(readFileSync(file,"utf8"));manifest.id=id;manifest.pipeline=["linked-resources"];manifest.policy.minimumScore=0;const raw=JSON.stringify(manifest);writeFileSync(file,raw);projects.push({id,configPath:file,manifestHash:hash(raw)});}
 const options={cliPath:cli,cliHash:hash(readFileSync(cli)),nodeExecutable:process.execPath,projects,workspacePath:workspace,statePath:join(root,"private","state.json"),vaultPath:vault,mapping:()=>DEFAULT_NOTE_MAPPING_JSON,pathExists:()=>false,stage:()=>{},checkRead:()=>{},readReference:async()=>""};
 provider=new SourceScraperProvider(options);const call=(name,args={})=>provider.execute("source_scraper_"+name,args);
 for(const project of projects){const job=await call("run_project",{projectId:project.id,requestId:project.id});let status;do{await new Promise(r=>setTimeout(r,10));status=await call("get_run_status",{jobId:job.id});}while(status.state==="running");assert.equal(status.state,"succeeded",JSON.stringify(status));}
 const result=await call("list_findings",{projectId:"manual-one",evaluation:"all"}),entity=result.records.find(e=>e.type==="web-resource");assert.ok(entity);
 await provider.saveHumanReview("manual-one",entity.key,"approved","");assert.equal(provider.memory.humanReview("user",entity.url).decision,"approved");assert.equal(provider.memory.assessment("user",entity.url),undefined);assert.equal(provider.memory.actions().length,0);
 await provider.saveHumanReview("manual-one",entity.key,"rejected","");assert.equal((await call("list_findings",{projectId:"manual-one"})).count,0);assert.equal((await call("list_findings",{projectId:"manual-two"})).count,0);
 provider.dispose();provider=new SourceScraperProvider(options);assert.equal((await provider.execute("source_scraper_list_rejected",{projectId:"manual-one"})).records.length,1);
 provider.memory.restore("user",entity.url);const restored=await provider.execute("source_scraper_list_findings",{projectId:"manual-one",evaluation:"all"});assert.equal(restored.count,1);assert.equal(restored.records[0].review,"pending");
 await provider.execute("source_scraper_resource_decision",{projectId:"manual-one",key:entity.key,action:"approve",reason:"User explicitly chose approval"});assert.equal(provider.memory.humanReview("user",entity.url).origin,"user-mcp");
 assert.equal(readFileSync(note,"utf8"),original);console.log(JSON.stringify({passed:true,realCli:true,manualApprove:true,optionalReason:true,crossProjectReject:true,restart:true,explicitRestore:true,aiRequired:false,likesSent:0,notesChanged:0}));
}finally{provider?.dispose();assert.equal(dirname(root),resolve(tmpdir()));rmSync(root,{recursive:true,force:true});}
