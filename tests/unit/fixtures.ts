import type {EntityRecord} from "../../src/contracts.ts";
export const project="generic-library";
export const first:EntityRecord={
  projectId:project,key:"record:no-url",type:"research-item",
  title:"A source record with no URL",attributes:{confidenceClaim:"unverified",measurements:[2,3]},
  category:"unassessed",score:40,confidence:0.5,
  reasons:["Synthetic fixture, not human approval"],review:"pending",
  updatedAt:"2026-10-24T00:00:00.000Z",observationCount:1,
  provenance:{mentions:[{connectionId:"fixture",itemId:"record-001",evidence:[]}],
    reviews:[],assessmentHistory:[],mentionsTruncated:false}
};
export const second:EntityRecord={
  projectId:project,key:"web:https://example.org/resource",type:"web-resource",
  title:"General research resource",url:"https://example.org/resource",
  attributes:{description:"Example sourced data",license:"unverified source assertion"},
  category:"candidate",score:75,confidence:0.6,reasons:["Matches user policy"],
  review:"approved",updatedAt:"2026-10-24T00:00:00.000Z",observationCount:2,
  provenance:{mentions:[{connectionId:"public",itemId:"post-002",url:"https://example.org/post"}],
    reviews:[{decision:"approved",reason:"Human review in source engine"}],
    assessmentHistory:[],mentionsTruncated:false}
};
export const envelope={schemaVersion:1,dataset:"entities",projectId:project,
  exportedAt:"2026-10-24T00:00:00Z",limit:100000,offset:0,count:2,records:[first,second]};
