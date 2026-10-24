import {test} from "node:test";
import assert from "node:assert/strict";
import {parseExport,checkedUrl,MAX_RECORDS} from "../../src/contracts.ts";
import {envelope,first,second} from "./fixtures.ts";
test("valid generic JSON v1 loads identity, evidence, score and missing URLs",()=>{
  const d=parseExport(JSON.stringify(envelope));
  assert.equal(d.projectId,"generic-library");
  assert.equal(d.records.length,2);
  assert.equal(d.records[0].url,undefined);
  assert.equal(d.records[1].review,"approved");
  assert.equal(d.records[1].provenance?.reviews[0].decision,"approved");
});
test("NDJSON lines from independent Source Scraper export load consistently",()=>{
  const lines=envelope.records.map(record=>JSON.stringify({schemaVersion:1,
    dataset:"entities",projectId:envelope.projectId,record})).join("\n")+"\n";
  const d=parseExport(lines);
  assert.equal(d.records.length,2);
  assert.deepEqual(d.records.map(x=>x.key),[first.key,second.key]);
});
test("fail closed on incompatible schema, dataset, count, duplicate identity or project",()=>{
  const cases=[
    {...envelope,schemaVersion:2},
    {...envelope,dataset:"observations"},
    {...envelope,count:3},
    {...envelope,records:[first,first]},
    {...envelope,records:[first,{...second,projectId:"other"}]}
  ];
  for(const input of cases)assert.throws(()=>parseExport(JSON.stringify(input)),/Invalid Source Scraper export/);
});
test("reject malicious URL schemes, credentials, prototype keys and oversized inputs",()=>{
  for(const url of ["javascript:alert(1)","obsidian://open?vault=private",
    "https://user:secret@example.org/","https://example.org/?access_token=private",
    "file:///etc/passwd"]){
    assert.throws(()=>checkedUrl(url),/Invalid Source Scraper export/);
    assert.throws(()=>parseExport(JSON.stringify({...envelope,count:1,records:[{...first,url}]})),/Invalid Source Scraper export/);
  }
  assert.throws(()=>parseExport(JSON.stringify({...envelope,count:1,records:[{...first,
    attributes:JSON.parse('{"__proto__":{"polluted":true}}')}] })),/unsafe property key/);
  assert.throws(()=>parseExport(JSON.stringify({...envelope,count:1,records:[{...first,
    attributes:{deep:{deep:{deep:{deep:{deep:{deep:{deep:{deep:{deep:{deep:{deep:{deep:{deep:"x"}}}}}}}}}}}}}}] })),/nested|Invalid/);
  assert.throws(()=>parseExport(" ".repeat(8_000_001)),/exceeds 8 MB/);
  assert.throws(()=>parseExport(JSON.stringify({...envelope,count:MAX_RECORDS+1,
    records:Array(MAX_RECORDS+1).fill(first)})),/record limit/);
});
test("NDJSON requires one project, version and no blank lines",()=>{
  const line=(record:unknown)=>JSON.stringify({schemaVersion:1,dataset:"entities",
    projectId:"generic-library",record});
  assert.throws(()=>parseExport(line(first)+"\n\n"+line(second)),/blank NDJSON/);
  assert.throws(()=>parseExport(line(first)+"\n"+line({...second,projectId:"other"})),/entity belongs/);
  assert.throws(()=>parseExport(line(first)+"\n"+JSON.stringify({
    schemaVersion:2,dataset:"entities",projectId:"generic-library",record:second
  })),/unsupported NDJSON/);
});
