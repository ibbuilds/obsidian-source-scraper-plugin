import {test} from "node:test";import assert from "node:assert/strict";
import {xPostContext} from "../../src/adapter-policy.ts";import {sourceProfile} from "../../src/source-profile.ts";import {buildXFeedProject} from "../../src/x-feed.ts";import {resolve} from "node:path";
test("X effects require the matching X connection even in mixed-source projects",()=>{
 const p=buildXFeedProject("12345","","",0,1);p.sources.push({id:"public",adapter:"rss",config:{url:"https://example.org/feed"}});
 const entity={attributes:{discoveryPost:"https://x.com/studio/status/123"}},mention={connectionId:p.sources[0].id,itemId:"123",url:entity.attributes.discoveryPost,active:true};
 assert.equal(xPostContext(p,entity,[mention])?.accountId,"12345");
 for(const bad of [{...mention,connectionId:"public"},{...mention,active:false},{...mention,itemId:"321"},{...mention,url:"https://example.org/status/123"}])assert.equal(xPostContext(p,entity,[bad]),undefined);
 assert.equal(xPostContext({...p,sources:p.sources.slice(1)},entity,[mention]),undefined);assert.equal(xPostContext(p,entity,[mention],"321"),undefined);assert.equal(xPostContext(p,{attributes:{discoveryPost:"https://example.org/status/123"}},[mention]),undefined);
});
test("generic filter profiles preserve local source paths and never become X projects",()=>{
 const p={...buildXFeedProject("12345","","",0,1),id:"generic",sources:[{id:"local",adapter:"json-file",config:{path:"items.json"}}]};const next=sourceProfile(p,resolve("fixture","project.json"));assert.match(next.id,/^source-profile-/);assert.equal(next.sources[0].config.path,resolve("fixture","items.json"));assert.equal(p.sources[0].config.path,"items.json");assert.deepEqual(sourceProfile(p,resolve("fixture","project.json")),next);
});
