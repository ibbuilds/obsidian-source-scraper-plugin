import {test} from "node:test";import assert from "node:assert/strict";
import {referenceBaseline,validateVisualReview} from "../../src/reference-quality.ts";
test("reference revisions, provenance and distinct rendered examples are required; metadata is not a visual review",async()=>{
 const text="# Inspiration\n[One](https://ref.example/one)\n[Two](https://ref.example/two)",baseline=await referenceBaseline(["References.md"],async()=>text);
 const explanation="Observed layout and interaction evidence in the specific rendered example, compared with the selected reference.";
 const review={baselineHash:baseline.hash,comparisons:baseline.links.map((r,i)=>({referenceUrl:r.url,sampleUrl:"https://candidate.example/demo/"+i,composition:explanation,typography:explanation,interaction:explanation,usefulness:explanation,verdict:"meets" as const}))};
 assert.equal(validateVisualReview(review,baseline).comparisons.length,2);
 assert.throws(()=>validateVisualReview({keywords:["design"],license:"MIT"},baseline),/REFERENCE_REVIEW/);
 for(const verdict of ["below","unknown"])assert.throws(()=>validateVisualReview({...review,comparisons:[{...review.comparisons[0],verdict},review.comparisons[1]]},baseline),/QUALITY_NOT_ESTABLISHED/);
 assert.throws(()=>validateVisualReview({...review,comparisons:[review.comparisons[0],review.comparisons[0]]},baseline),/DISTINCT/);
 assert.throws(()=>validateVisualReview({...review,comparisons:review.comparisons.map(c=>({...c,referenceUrl:"https://unconfigured.example/"}))},baseline),/QUALITY_NOT_ESTABLISHED/);
 const changed=await referenceBaseline(["References.md"],async()=>text+"\nChanged standard");assert.throws(()=>validateVisualReview(review,changed),/STALE/);
});
