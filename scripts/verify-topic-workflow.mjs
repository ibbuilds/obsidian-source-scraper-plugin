/** Real engine/CLI/MCP contract, synthetic retained X evidence; no X network or note writes. */
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {tmpdir} from "node:os";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {SourceScraperProvider} from "../src/mcp-provider.ts";
import {DEFAULT_NOTE_MAPPING_JSON} from "../src/note-mapping.ts";
const cli=resolve(process.argv[2]||"../engine/dist/source-scraper.mjs"),engine=resolve(dirname(cli),".."),root=mkdtempSync(join(tmpdir(),"ss-topic-contract-")),workspace=join(root,"projects"),vault=join(root,"vault");
const load=path=>import(pathToFileURL(join(engine,path)).href),digest=v=>createHash("sha256").update(v).digest("hex");
let provider;
try{
 mkdirSync(workspace);mkdirSync(vault);writeFileSync(join(vault,"Existing.md"),"Preserve this note exactly");
 const {runProject}=await load("packages/core/engine.ts"),{createDefaultRegistry}=await load("packages/core/extensions.ts");
 const {KnowledgeStore}=await load("packages/storage/knowledge.ts"),registry=createDefaultRegistry();let sourceReads=0;
 const observations=[
  {id:"101",type:"x-post",url:"https://x.com/designer/status/101",text:"UI typography, hierarchy and spacing study: small demo",urls:[],media:["https://pbs.twimg.com/media/ui.jpg"],attributes:{metrics:{likes:120},mediaEvidenceComplete:true}},
  {id:"102",type:"x-post",url:"https://x.com/designer/status/102",text:"A reusable UI toolkit with direct source files",urls:["https://example.org/toolkit"],media:[],attributes:{metrics:{likes:50},mediaEvidenceComplete:true}},
  {id:"103",type:"x-post",url:"https://x.com/news/status/103",text:"politics and unrelated news",urls:["https://example.org/news"],media:[],attributes:{metrics:{likes:10000},mediaEvidenceComplete:true}}
 ];
 registry.sources.set("x-for-you-local",{id:"x-for-you-local",async collect(){sourceReads++;return {observations,hasMore:false};}});
 const project={id:"topic-contract",name:"Retained X fixture",sources:[{id:"feed",adapter:"x-for-you-local",config:{accountId:"123456"}}],pipeline:["x-discovery"],evaluator:"keyword",policy:{includeKeywords:[],excludeKeywords:[],minimumScore:0},outputs:[]};
 const configPath=join(workspace,"project.json"),raw=JSON.stringify(project),database=join(workspace,".source-scraper.sqlite");writeFileSync(configPath,raw);await runProject(database,project,registry);
 let profile={version:1,description:"Interface design and reusable UI sources",includeTerms:["UI"],excludeTerms:["politics","small demo"],postExcludeTerms:["politics"],blockedPostTerms:[],reuseTerms:[],requiredChecks:[],minimumLikes:10};
 let likesAllowed=false;
 const options={cliPath:cli,cliHash:digest(readFileSync(cli)),nodeExecutable:process.execPath,projects:[{id:project.id,configPath,manifestHash:digest(raw)}],workspacePath:workspace,statePath:join(root,"private","state.json"),vaultPath:vault,allowXProvider:true,allowXLikes:()=>likesAllowed,feedbackProfile:()=>profile,mapping:()=>DEFAULT_NOTE_MAPPING_JSON,pathExists:()=>false,stage:()=>{throw Error("No staging expected");},checkRead:()=>{},readReference:async()=>""};
 provider=new SourceScraperProvider(options);const call=(name,args={})=>provider.execute("source_scraper_"+name,{projectId:project.id,...args});
 const [packet,concurrentResources]=await Promise.all([call("get_posts"),call("get_resources")]);assert.equal(concurrentResources.total,2);assert.equal(packet.records.length,3);assert.equal(packet.records[0].urls.length,0);assert.equal(packet.records[2].decision.state,"irrelevant");assert.ok(packet.reviewContract);
 const decision=(d,state="pertinent")=>({fingerprint:d.fingerprint,profileHash:packet.profileHash,state,reason:"The complete observed evidence concerns interface composition and reusable UI.",wholePostReviewed:true,uncertainties:[],evidence:[{kind:"text",quote:d.observation.text},...d.media.map(url=>({kind:"visual",url,note:"Reviewed its composition, type hierarchy and interface layout in the supplied image."}))]});
 const first=packet.records[0],items=[{key:first.key,review:decision(first)}];
 await assert.rejects(call("review_posts",{requestId:"permission-denied",items:[{...items[0],queueLike:true}]}),/APPROVAL_REQUIRED/);
 const dry=await call("review_posts",{requestId:"dry-run-topic-01",items});assert.equal(dry.saved,1);assert.equal(dry.likesQueued,0);assert.equal(provider.memory.actions().length,0);
 assert.equal((await call("review_posts",{requestId:"dry-run-topic-01",items})).replayed,true);
 likesAllowed=true;await provider.localFeedback(true);
 const queued=await call("review_posts",{requestId:"queue-topic-01",items:[{...items[0],queueLike:true}]});assert.equal(queued.likesQueued,1);assert.equal(provider.memory.actions()[0].target,"post");assert.equal(provider.memory.actions()[0].resource,first.observation.url);
 const humanItems=[{key:first.key,review:{...decision(first,"irrelevant"),wholePostReviewed:false}}];await provider.reviewPosts({projectId:project.id,requestId:"human-topic-01",items:humanItems},"user-interface");assert.equal(provider.memory.actions()[0].state,"cancelled");
 await assert.rejects(call("review_posts",{requestId:"agent-override-01",items}),/USER_DECISION/);
 await assert.rejects(call("review_posts",{requestId:"queue-topic-01",items:[{...items[0],queueLike:true}]}),/EVIDENCE_CHANGED/);
 assert.equal(provider.memory.postReview("123456","101").origin,"user-interface");
 const resources=await call("get_resources");assert.equal(resources.total,2);assert.ok(resources.records.every(r=>r.key!==first.observation.url));
 const topics=await call("get_relevance"),news=topics.records.find(r=>r.entity.url==="https://example.org/news");
 const resourceReview={fingerprint:news.fingerprint,profileHash:topics.profileHash,state:"irrelevant",reason:"The directly linked page describes unrelated news, outside the configured interface topic.",wholePostReviewed:false,uncertainties:[],evidence:[]};
 await call("review_relevance",{requestId:"resource-topic-01",items:[{key:news.key,review:resourceReview}]});assert.equal((await call("get_resources")).total,1);
 assert.equal((await call("get_resources",{relevance:"irrelevant"})).total,1);
 assert.equal((await call("process_pending")).result.processed,0);assert.equal(sourceReads,1);
 provider.dispose();provider=new SourceScraperProvider(options);assert.equal((await call("get_resources")).total,1);assert.equal(provider.memory.actions()[0].state,"cancelled");
 profile={...profile,requireTopicReview:true};assert.equal((await call("get_resources")).total,0);assert.equal((await call("get_resources",{relevance:"uncertain"})).total,1);const candidates=await call("get_relevance"),toolkit=candidates.records.find(r=>r.entity.url==="https://example.org/toolkit");await call("review_relevance",{requestId:"topic-positive-resource",items:[{key:toolkit.key,review:{fingerprint:toolkit.fingerprint,profileHash:candidates.profileHash,state:"pertinent",reason:"The source provides reusable UI toolkit files for building interfaces.",wholePostReviewed:true,uncertainties:[],evidence:[{kind:"page",url:"https://example.org/toolkit",quote:"Reusable UI toolkit files are available for building interface components."}]}}]});assert.equal((await call("get_resources")).total,1);assert.equal(sourceReads,1);
 const store=new KnowledgeStore(database);try{assert.equal(store.listObservations(project.id).length,3);}finally{store.close();}
 assert.equal(readFileSync(join(vault,"Existing.md"),"utf8"),"Preserve this note exactly");
 console.log(JSON.stringify({passed:true,realEngine:true,syntheticX:true,postResourceSeparation:true,wholeVisualEvidence:true,dryRun:true,humanPrecedence:true,staleReceiptDenied:true,sourceReads,realLikes:0,notesChanged:0,restart:true}));
}finally{provider?.dispose();rmSync(root,{recursive:true,force:true});}
