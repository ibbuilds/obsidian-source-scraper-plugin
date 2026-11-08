import {test} from "node:test";import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";import {join} from "node:path";import {tmpdir} from "node:os";
import {referenceBaseline} from "../../src/reference-quality.ts";
import {parseCurationPolicy,validateQualityReview,type QualityReview} from "../../src/curation-policy.ts";
import {DESIGN_FRONTEND_PRESET} from "../../src/design-frontend-preset.ts";
import {parseFeedbackProfile,feedbackProfileHash} from "../../src/feedback-policy.ts";
import {ResourceMemory} from "../../src/resource-memory.ts";
const policy=parseCurationPolicy(DESIGN_FRONTEND_PRESET),fingerprint="a".repeat(64),profileHash="b".repeat(64);
const note="Specific inspected evidence demonstrating the configured category criterion and useful free functionality.";
const proof={url:"https://candidate.example/docs",quote:note};
async function fixture(category="inspiration"){
 const c=policy.categories.find(c=>c.id===category)!;
 const baseline=await referenceBaseline(["References.md"],async()=>"# "+c.referenceSections[0]+"\n[One](https://ref.example/one)\n[Two](https://ref.example/two)\n# Unrelated\n[Other](https://other.example/)");
 const review:QualityReview={version:1,fingerprint,profileHash,baselineHash:baseline.hash,category,decision:"qualified",reason:note,relevance:note,access:{mode:"unmetered-free",scope:"The substantial core collection is freely usable indefinitely; an optional paid MCP does not restrict browsing.",evidence:[proof]},criteria:c.criteria.map(c=>({id:c.id,verdict:"meets",note,evidence:[proof]})),comparisons:baseline.links.slice(0,2).map((r,i)=>({referenceUrl:r.url,sampleUrl:"https://candidate.example/example/"+i,note}))};
 return {baseline,review,check:(r:unknown=review)=>validateQualityReview(r,policy,profileHash,baseline,["https://candidate.example/"],fingerprint)};
}
test("design galleries, UX research and frontend tools qualify under their own rubric, without requiring every source to be a repository",async()=>{
 for(const category of ["inspiration","ux-research","frontend-tools","components"]){const {review,check}=await fixture(category);assert.equal(check().category,category);assert.equal(review.access.mode,"unmetered-free");}
});
test("trial, viewing meters, paid core and unknown access never qualify; optional paid services do not disqualify a usable free core",async()=>{
 const {review,check}=await fixture();for(const mode of ["trial","metered","paid","unknown"])assert.throws(()=>check({...review,access:{...review.access,mode}}),/QUALITY_NOT_ESTABLISHED/);
 assert.equal(check().decision,"qualified");
});
test("each category criterion, direct evidence and two appropriate comparisons are mandatory",async()=>{
 const {review,check}=await fixture();
 assert.throws(()=>check({...review,criteria:review.criteria.slice(1)}),/QUALITY_NOT_ESTABLISHED/);
 assert.throws(()=>check({...review,criteria:review.criteria.map(c=>({...c,verdict:"unknown"}))}),/QUALITY_NOT_ESTABLISHED/);
 assert.throws(()=>check({...review,access:{...review.access,evidence:[]}}),/EVIDENCE_REQUIRED/);
 assert.throws(()=>check({...review,comparisons:review.comparisons.map(c=>({...c,referenceUrl:"https://other.example/"}))}),/CATEGORY_COMPARISON/);
 assert.throws(()=>check({...review,comparisons:[review.comparisons[0],review.comparisons[0]]}),/QUALITY_NOT_ESTABLISHED/);
 assert.throws(()=>check({...review,criteria:review.criteria.map(c=>({...c,evidence:[{...proof,url:"https://unrelated.example/"}]}))}),/INVALID_QUALITY_EVIDENCE/);
});
test("policy, references and fingerprint changes fail closed; exclusions and unknowns never become human rejections",async()=>{
 const {review,check}=await fixture();
 for(const key of ["profileHash","baselineHash","fingerprint"])assert.throws(()=>check({...review,[key]:"changed"}),/STALE/);
 const pending={...review,decision:"pending",access:{mode:"unknown",scope:"",evidence:[]},criteria:[],comparisons:[],relevance:""};
 assert.equal(check(pending).decision,"pending");
 assert.equal(check({...pending,decision:"excluded",access:{...pending.access,mode:"metered"}}).decision,"excluded");
});
test("curation is optional user-owned configuration; malformed or duplicate rules fail rather than silently weakening the standard",()=>{
 const base={version:1,includeTerms:[],reuseTerms:[],excludeTerms:[],blockedPostTerms:[],requiredChecks:[]};
 assert.equal(parseFeedbackProfile(base).curation,undefined);
 assert.equal(parseFeedbackProfile({...base,curation:policy}).curation?.categories.length,8);
 assert.notEqual(feedbackProfileHash("project-a",base as any),feedbackProfileHash("project-a",{...base,curation:policy} as any));
 assert.throws(()=>parseCurationPolicy({...policy,categories:[policy.categories[0],policy.categories[0]]}),/INVALID/);
 assert.throws(()=>parseCurationPolicy({...policy,maxAgeDays:365}),/INVALID/);
});
test("qualified evidence survives restart, stays project-scoped and never implies Keep, AI recommendation or a like",async()=>{
 const {review}=await fixture(),root=mkdtempSync(join(tmpdir(),"ss-curation-"));
 try{const file=join(root,"resources.json"),memory=new ResourceMemory(file);
 memory.transaction(()=>memory.recordQualification("design-project","https://candidate.example/",{...review,entityUpdatedAt:"2026-01-01",at:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),origin:"user-interface"}));
 const restarted=new ResourceMemory(file);assert.equal(restarted.qualification("design-project","https://candidate.example/")?.decision,"qualified");assert.equal(restarted.qualification("other-project","https://candidate.example/"),undefined);
 assert.equal(restarted.humanReview("user","https://candidate.example/"),undefined);assert.equal(restarted.assessment("user","https://candidate.example/"),undefined);assert.equal(restarted.actions().length,0);assert.equal(restarted.rejected("user","https://candidate.example/"),false);
 assert.throws(()=>restarted.transaction(()=>{restarted.recordQualification("other-project","https://candidate.example/",memory.qualification("design-project","https://candidate.example/")!);throw Error("abort");}),/abort/);assert.equal(new ResourceMemory(file).qualification("other-project","https://candidate.example/"),undefined);
 }finally{rmSync(root,{recursive:true,force:true});}
});
