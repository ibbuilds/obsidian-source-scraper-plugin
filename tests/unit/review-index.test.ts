import {test} from "node:test";
import assert from "node:assert/strict";
import {ReviewIndex} from "../../src/review-index.ts";
import type {EntityRecord} from "../../src/contracts.ts";
test("review index retains existing per-field substring semantics and input order",()=>{
 const records=Array.from({length:4000},(_,i)=>({key:"key:"+i,title:i%2?"Design System "+i:"Other "+i,type:"web-resource",category:"library"} as EntityRecord));
 const index=new ReviewIndex(records);
 for(const query of ["", "DESIGN", "design system", "key:3999", "resource", "library", "System key:", "missing", "", "DESIGN"]){
  const expected=records.filter(e=>[e.title,e.key,e.type,e.category].some(value=>value.toLowerCase().includes(query.toLowerCase())));
  assert.deepEqual(index.filter(query),expected);
 }
 const other=new ReviewIndex([{...records[0],title:"Different project"}]);assert.equal(other.filter("design").length,0);
});
