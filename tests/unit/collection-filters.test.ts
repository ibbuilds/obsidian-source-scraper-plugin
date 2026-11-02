import {test} from "node:test";
import assert from "node:assert/strict";
import {parseProjectManifest,GENERIC_TEMPLATE} from "../../src/project-manifest.ts";
import {parseCollectionFilters,compileCollectionFilters} from "../../src/collection-filters.ts";

test("projects retain generic collection filters separately from heuristic scores",()=>{
  const input={...JSON.parse(GENERIC_TEMPLATE),filters:{version:1,sourceIds:["local"],
    observation:{includeTerms:["data","research"],includeMode:"any",excludeTerms:["giveaway"]},
    entity:{requiredFields:["url"],allowedDomains:["example.org"]}}};
  const parsed=parseProjectManifest(JSON.stringify(input));
  assert.deepEqual(parsed.filters,input.filters);
  assert.deepEqual(parsed.policy.includeKeywords,[]);
  assert.deepEqual(parseProjectManifest(JSON.stringify(parsed)).filters,input.filters);
  for(const filters of [{version:1,entity:{regex:".*"}},{version:1,sourceIds:["not-registered"]},
    {version:1,entity:{fields:["attributes.__proto__.x"],includeTerms:["x"]}}])
    assert.throws(()=>parseProjectManifest(JSON.stringify({...input,filters})),/INVALID_FILTER/);
});
test("runtime filters narrow configured scopes and do not promote a post claim into entity evidence",()=>{
  const saved=parseCollectionFilters({version:1,entity:{includeTerms:["research"]}},["local"]);
  const request=parseCollectionFilters({version:1,entity:{excludeTerms:["giveaway"]}},["local"]);
  const filter=compileCollectionFilters(["local"],saved,request);
  assert.equal(filter.match({title:"Research tool"},()=>[]).matched,true);
  assert.equal(filter.match({title:"Research giveaway"},()=>[]).matched,false);
  assert.equal(filter.match({title:"Unrelated",attributes:{discoveryText:"research"}},()=>[]).matched,false);
});
