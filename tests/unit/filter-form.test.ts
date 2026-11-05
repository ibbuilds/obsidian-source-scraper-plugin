import {test} from "node:test";
import assert from "node:assert/strict";
import {buildXFeedProject} from "../../src/x-feed.ts";
import {feedFilterForm,applyFeedFilterForm} from "../../src/filter-form.ts";
import {compileCollectionFilters} from "../../src/collection-filters.ts";
test("visual feed filters enforce terms, age and engagement together without changing the original",()=>{
 const original=buildXFeedProject("12345","design","sponsored",0,1),before=JSON.stringify(original);
 const form={...feedFilterForm(original),include:"design, typography",exclude:"giveaway",days:"30",likes:"100",reposts:"5",pages:"2"};
 const next=applyFeedFilterForm(original,form);assert.equal(JSON.stringify(original),before);assert.equal(next.sources[0].config.pagesPerRun,2);
 const filter=compileCollectionFilters(["x-for-you"],next.filters,undefined,new Date("2026-11-03T12:00:00Z").getTime());
 const entity={type:"web-resource",url:"https://example.org"},observation={type:"x-post",text:"design system",occurredAt:"2026-11-02T12:00:00Z",attributes:{metrics:{likes:100,reposts:5}}};
 const match=(value:unknown)=>filter.match(entity,()=>[{sourceId:"x-for-you",observation:value}]);
 assert.equal(match(observation).matched,true);
 for(const wrong of [{...observation,text:"unrelated"},{...observation,text:"design giveaway"},{...observation,occurredAt:"2025-01-01T00:00:00Z"},{...observation,attributes:{metrics:{likes:99,reposts:5}}},{...observation,attributes:{metrics:{likes:100}}}])assert.equal(match(wrong).matched,false);
 assert.deepEqual(feedFilterForm(next),form);
});
test("saving visual controls preserves advanced domains, date boundaries, maxima and other counters",()=>{
 const p=buildXFeedProject("12345","design","",0,1);
 p.filters={version:1,sourceIds:["x-for-you"],entity:{allowedDomains:["example.org"]},observation:{fields:["text"],matchMode:"word",dateRanges:[{field:"occurredAt",from:"2026-10-01T10:00:00Z",maxAgeDays:30}],numericRanges:[{field:"attributes.metrics.likes",min:100,max:500},{field:"attributes.metrics.views",min:1000}]}};
 const form={...feedFilterForm(p),include:"design",likes:"200"};const next=applyFeedFilterForm(p,form);
 assert.deepEqual(next.filters?.entity?.allowedDomains,["example.org"]);assert.deepEqual(next.filters?.sourceIds,["x-for-you"]);assert.equal(next.filters?.observation?.matchMode,"word");
 assert.ok(next.filters?.observation?.dateRanges?.some(r=>r.from==="2026-10-01T10:00:00.000Z"));assert.ok(next.filters?.observation?.numericRanges?.some(r=>r.max===500));assert.ok(next.filters?.observation?.numericRanges?.some(r=>r.field==="attributes.metrics.views"&&r.min===1000));
 assert.equal(feedFilterForm(next).likes,"200");assert.equal(feedFilterForm(next).days,"30");
 for(const bad of ["-1","1.5","hello","Infinity"])assert.throws(()=>applyFeedFilterForm(p,{...form,likes:bad}));
 assert.throws(()=>applyFeedFilterForm(p,{...form,pages:"11"}));assert.throws(()=>applyFeedFilterForm(p,{...form,days:"0"}));
});

test("generic link filters preserve source metrics and types without requiring X",()=>{
 const p={...buildXFeedProject("12345","","",0,1),id:"generic",sources:[{id:"feed",adapter:"rss",config:{url:"https://example.org/feed"}}],pipeline:["observation-entity"],filters:{version:1 as const,observation:{numericRanges:[{field:"attributes.metrics.likes",min:4}]}}};
 const next=applyFeedFilterForm(p,{...feedFilterForm(p),include:"typography",likes:"999",pages:"irrelevant"});
 assert.deepEqual(next.filters?.observation?.numericRanges,[{field:"attributes.metrics.likes",min:4}]);assert.equal(next.filters?.entity?.types,undefined);assert.deepEqual(next.filters?.entity?.requiredFields,["url"]);assert.deepEqual(next.sources,p.sources);
 const filter=compileCollectionFilters(["feed"],next.filters);assert.equal(filter.match({type:"feed-entry",url:"https://example.org/resource"},()=>[{sourceId:"feed",observation:{text:"typography",attributes:{metrics:{likes:5}}}}]).matched,true);
});

test("editing common filters in mixed projects leaves X connection limits untouched",()=>{
 const p=buildXFeedProject("12345","","",0,7);p.sources.push({id:"feed",adapter:"rss",config:{url:"https://example.org/feed"}});
 const next=applyFeedFilterForm(p,{...feedFilterForm(p),include:"typography",pages:"not a visible control"});assert.deepEqual(next.sources,p.sources);
});
