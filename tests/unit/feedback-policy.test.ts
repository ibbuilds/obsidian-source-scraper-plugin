import {test} from "node:test";import assert from "node:assert/strict";
import {checkResource as evaluateResource,relatedResourceUrl,type PublicResourceEvidence,LOCAL_CHECKS,OPTIONAL_CHECKS,feedbackProfileHash,parseFeedbackProfile,parseFeedbackProfiles,resourceCandidate,type FeedbackProfile} from "../../src/feedback-policy.ts";
import {ResourceMemory} from "../../src/resource-memory.ts";
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from "node:fs";import {tmpdir} from "node:os";import {join} from "node:path";
const url="https://github.com/org/ui",fingerprint="a".repeat(64),entity={attributes:{discoveryText:"A reusable UI components library: https://github.com/org/ui"}};
const profile:FeedbackProfile={version:1,includeTerms:["ui","components"],reuseTerms:["library"],excludeTerms:["tiny"],blockedPostTerms:["sponsored","giveaway"],requiredChecks:[...OPTIONAL_CHECKS]},profileHash=feedbackProfileHash("x",profile);
const checkResource=(e:Parameters<typeof evaluateResource>[0],fp:string,p:PublicResourceEvidence,now=Date.now())=>evaluateResource(e,fp,p,profile,profileHash,now,[url]);
const proof=():PublicResourceEvidence=>({version:1,url,checkedAt:new Date().toISOString(),status:"checked",repository:{url,name:"org/ui",description:"A reusable UI components library",topics:["ui-components"],license:"MIT",openSource:true,archived:false,disabled:false,homepage:""},rootEntries:["src","tests","package.json"],readme:"# Components\n## Installation and usage\n```js\nimport { Button } from 'ui'\n```\nExamples: https://example.org/demo",package:{name:"ui",description:"UI components library",main:"src/index.js",module:"",exports:true,bin:false,workspaces:false,testScript:"node --test tests/*.test.js"},evidence:[{url,quote:"MIT reusable UI components, usage, tests and examples are retained."}]});
test("configured feedback requires every evidence gate rather than keywords, stars or popularity",()=>{
 const complete=checkResource(entity,fingerprint,proof());assert.equal(complete.eligible,true);assert.ok(LOCAL_CHECKS.every(k=>complete.checks[k]));
 for(const missing of ["license","tests","output","documentation","topic","examples","active"]){const p=proof();if(missing==="license")p.repository!.openSource=false;if(missing==="tests")p.package!.testScript='echo "no test specified"';if(missing==="output"){p.package=undefined;p.rootEntries=["tests"];};if(missing==="documentation")p.readme="UI UI UI stars 1000000";if(missing==="topic"){p.repository!.description="Database engine";p.repository!.topics=["database"];p.package!.description="Database engine";p.readme="# Engine\n## Usage\n```js\nconnect()\n```\nExamples https://example.org/demo";}if(missing==="examples")p.readme=p.readme!.split("Examples")[0];if(missing==="active")p.repository!.archived=true;assert.equal(checkResource(entity,fingerprint,p).eligible,false,missing);}
 const demo=proof();demo.repository!.description="A tiny React component demo";demo.package!.description="A tiny React component demo";demo.readme="# Tiny component\n## Usage\n```js\ncomponent()\n```\nDemo https://example.org";assert.equal(checkResource(entity,fingerprint,demo).eligible,false);
 assert.equal(checkResource({attributes:{discoveryText:"Sponsored UI giveaway"}},fingerprint,proof()).eligible,false);
});

test("the whole retained source post is checked: related official links pass, mixed resource lists stay pending",()=>{
 const p=proof();p.repository!.homepage="https://ui.example/";
 assert.equal(evaluateResource(entity,fingerprint,p,profile,profileHash,Date.now(),[url,"https://ui.example/docs"]).eligible,true);
 assert.equal(evaluateResource(entity,fingerprint,p,profile,profileHash,Date.now(),[url,"https://github.com/other/video"]).eligible,false);
 assert.equal(evaluateResource(entity,fingerprint,p,profile,profileHash).eligible,false);
 assert.equal(relatedResourceUrl("https://github.com/org/ui-other",[url]),false);
 assert.equal(relatedResourceUrl("https://github.com/other/ui",[url]),false);
 assert.equal(relatedResourceUrl("https://ui.example:4443/",["https://ui.example/"]),false);
});

test("topics and requirements are user-owned: another domain can pass with different criteria",()=>{
 const p=proof();p.repository!.description="Distributed database client";p.repository!.topics=["database"];p.package!.description="Database client";p.package!.testScript="";p.readme="# Database\nUsage ```js\nconnect()\n```";
 const database:FeedbackProfile={version:1,includeTerms:["database"],reuseTerms:[],excludeTerms:[],blockedPostTerms:[],requiredChecks:["freeAccess","activeSource"]};
 const changed=feedbackProfileHash("x",database);assert.notEqual(changed,profileHash);assert.notEqual(feedbackProfileHash("another-project",database),changed);
 const result=evaluateResource(entity,fingerprint,p,database,changed,Date.now(),[url]);assert.equal(result.eligible,true);assert.equal(result.checks.automatedChecks,false);assert.equal(result.checks.examples,false);
 assert.equal(resourceCandidate({title:"Distributed database client",attributes:{}},database),true);
 assert.equal(resourceCandidate({title:"UI components",attributes:{}},database),false);
 assert.deepEqual(parseFeedbackProfiles("{}"),{});
 const allTopics=parseFeedbackProfile({...database,includeTerms:[]});assert.equal(resourceCandidate({title:"Anything",attributes:{}},allTopics),true);
 assert.deepEqual(parseFeedbackProfile({...database,includeTerms:[" Database ","database"]}).includeTerms,["database"]);
 for(const invalid of [{...database,requiredChecks:["unknown"]},{...database,includeTerms:"database"},{...database,includeTerms:[""]},{...database,run:"command"}])assert.throws(()=>parseFeedbackProfile(invalid));
});

test("profile changes invalidate queued local actions and never qualify manual or AI actions implicitly",()=>{
 const root=mkdtempSync(join(tmpdir(),"ss-profile-change-")),memory=new ResourceMemory(join(root,"resources.json"));
 try{const first=checkResource(entity,fingerprint,proof());memory.recordLocalCheck("user",url,first);
 const action={resource:url,projectId:"x",key:url,accountId:"123",postId:"456",postUrl:"https://x.com/org/status/456",postTextHash:"b".repeat(64),fingerprint};
 assert.throws(()=>memory.queue("user",action),/NOT_EVALUATED/);assert.throws(()=>memory.queue("user",{...action,origin:"local-policy",profileHash:"f".repeat(64)}),/NOT_EVALUATED/);
 memory.queue("user",{...action,origin:"local-policy",profileHash});memory.recordLocalCheck("user",url,{...first,profileHash:"f".repeat(64)});
 assert.equal(memory.actions()[0].state,"cancelled");assert.equal(memory.localEligible("user",url,fingerprint,profileHash),false);
 }finally{memory.close();rmSync(root,{recursive:true,force:true});}
});
test("local policy decisions stay separate from AI and human choices and can qualify one deduplicated like",async()=>{
 const root=mkdtempSync(join(tmpdir(),"ss-local-policy-"));let memory=new ResourceMemory(join(root,"resources.json"));
 try{memory.recordLocalCheck("user",url,checkResource(entity,fingerprint,proof()));assert.equal(memory.assessment("user",url),undefined);assert.equal(memory.humanReview("user",url),undefined);
 const action={resource:url,projectId:"x",key:url,accountId:"123",postId:"456",postUrl:"https://x.com/org/status/456",postTextHash:"b".repeat(64),fingerprint,profileHash,origin:"local-policy" as const};memory.queue("user",action);memory.setFeedback(true);let liked=false,sends=0;await memory.dispatch({stillValid:async()=>true,verify:async()=>liked,send:async()=>{sends++;liked=true;}});assert.equal(memory.actions()[0].state,"confirmed");memory=new ResourceMemory(join(root,"resources.json"));memory.queue("user",action);assert.equal(memory.actions().length,1);assert.equal(sends,1);memory.reject("user",url);assert.throws(()=>memory.queue("user",action),/REJECTED/);
 }finally{memory.close();rmSync(root,{recursive:true,force:true});}
});
test("incomplete, stale or expired local checks cannot queue feedback",()=>{
 const root=mkdtempSync(join(tmpdir(),"ss-local-expired-")),memory=new ResourceMemory(join(root,"resources.json"));
 const action={resource:url,projectId:"x",key:url,accountId:"123",postId:"456",postUrl:"https://x.com/org/status/456",postTextHash:"b".repeat(64),fingerprint};
 try{const check=checkResource(entity,fingerprint,proof());assert.throws(()=>memory.recordLocalCheck("user",url,{...check,checks:{...check.checks,freeAccess:false}}),/INVALID_LOCAL/);memory.recordLocalCheck("user",url,{...check,expiresAt:new Date(Date.now()-1).toISOString()});assert.throws(()=>memory.queue("user",action),/NOT_EVALUATED/);memory.recordLocalCheck("user",url,{...check,fingerprint:"c".repeat(64)});assert.throws(()=>memory.queue("user",action),/NOT_EVALUATED/);}finally{memory.close();rmSync(root,{recursive:true,force:true});}
});

test("rejecting a verified related homepage blocks repository feedback even if a separate AI assessment exists",async()=>{
 const root=mkdtempSync(join(tmpdir(),"ss-related-rejection-")),memory=new ResourceMemory(join(root,"resources.json"));const p=proof();p.repository!.homepage="https://example.org/";
 try{memory.recordLocalCheck("user",url,checkResource(entity,fingerprint,p));memory.assess("user",url,{decision:"recommended",fingerprint,utility:"The fixture exposes reusable UI components.",reuse:"The fixture works across multiple independent projects.",quality:"The fixture output matches its documented expectations.",freeAccess:"The fixture is freely reusable synthetic test content.",usableOutput:"The fixture includes reusable output in its test data.",unknowns:[],evidence:[{url,quote:"Synthetic fixture evidence establishes reusable UI output."}],postSuitable:true,at:""});const details={resource:url,projectId:"x",key:url,accountId:"123",postId:"456",postUrl:"https://x.com/org/status/456",postTextHash:"b".repeat(64),fingerprint,profileHash,origin:"local-policy" as const};memory.queue("user",details);memory.setFeedback(true);let sends=0;await memory.dispatch({stillValid:async()=>true,verify:async()=>{memory.reject("user",p.repository!.homepage);return false;},send:async()=>{sends++;}});assert.equal(sends,0);assert.equal(memory.actions()[0].state,"cancelled");assert.equal(memory.localEligible("user",url),false);memory.restore("user",p.repository!.homepage);assert.equal(memory.localEligible("user",url),true);}finally{memory.close();rmSync(root,{recursive:true,force:true});}
});

test("a policy upgrade only retires a known unsent preflight refusal, never an uncertain or confirmed mutation",()=>{
 for(const state of ["failed","uncertain","confirmed"]){const root=mkdtempSync(join(tmpdir(),"ss-policy-migration-")),file=join(root,"resources.json");let memory=new ResourceMemory(file);
  try{memory.recordLocalCheck("user",url,checkResource(entity,fingerprint,proof()));memory.queue("user",{resource:url,projectId:"x",key:url,accountId:"123",postId:"456",postUrl:"https://x.com/org/status/456",postTextHash:"b".repeat(64),fingerprint,profileHash,origin:"local-policy"});memory.close();const raw=JSON.parse(readFileSync(file,"utf8"));raw.localChecks["user|"+url].policy="legacy-policy";raw.actions[0].state=state;raw.actions[0].attempts=state==="failed"?0:1;raw.actions[0].error="X_POST_ADDITIONAL_LINKS_NEED_REVIEW";writeFileSync(file,JSON.stringify(raw));memory=new ResourceMemory(file);assert.equal(memory.localEligible("user",url),false);memory.recordLocalCheck("user",url,checkResource(entity,fingerprint,proof()));assert.equal(memory.actions()[0].state,state==="failed"?"cancelled":state);}finally{memory.close();rmSync(root,{recursive:true,force:true});}
 }
});
