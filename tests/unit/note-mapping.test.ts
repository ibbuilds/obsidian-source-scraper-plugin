import {test} from "node:test";
import assert from "node:assert/strict";
import {DEFAULT_NOTE_MAPPING,DEFAULT_NOTE_MAPPING_JSON,parseNoteMapping,mappedEntityField} from "../../src/note-mapping.ts";
import {renderNote} from "../../src/render.ts";
import {first,second} from "./fixtures.ts";

test("portable generic mapping default keeps complete evidence and assessment",()=>{
  assert.deepEqual(parseNoteMapping(DEFAULT_NOTE_MAPPING_JSON),DEFAULT_NOTE_MAPPING);
  const markdown=renderNote(second,DEFAULT_NOTE_MAPPING);
  assert.match(markdown,/## Machine assessment/);
  assert.match(markdown,/## Structured attributes/);
  assert.match(markdown,/## Evidence and review history/);
});
test("users choose arbitrary entity attributes and note sections without personal rules",()=>{
  const config=parseNoteMapping(JSON.stringify({
    version:1,titleField:"attributes.description",
    properties:{source_license:"attributes.license",machine_score:"score"},
    sections:{assessment:false,attributes:false,provenance:true}
  }));
  const markdown=renderNote(second,config);
  assert.match(markdown,/^# Example sourced data$/m);
  assert.match(markdown,/source_license: "unverified source assertion"/);
  assert.match(markdown,/machine_score: 75/);
  assert.match(markdown,/### Human reviews/);
  assert.doesNotMatch(markdown,/## Machine assessment/);
  assert.doesNotMatch(markdown,/## Structured attributes/);
  assert.equal(mappedEntityField(second,"attributes.description"),"Example sourced data");
});
test("missing mapped metadata is omitted, never invented",()=>{
  const config=parseNoteMapping(JSON.stringify({version:1,titleField:"attributes.unknown",
    properties:{unknown:"attributes.unknown",source_id:"key"},
    sections:{assessment:false,attributes:false,provenance:false}}));
  const markdown=renderNote(first,config);
  assert.match(markdown,/^# A source record with no URL$/m);
  assert.match(markdown,/source_id: "record:no-url"/);
  assert.doesNotMatch(markdown,/unknown:/);
  assert.doesNotMatch(markdown,/## Evidence and review history/);
});
test("reject malformed mapping, prototype pollution paths, collisions and credential-like fields",()=>{
  const base={version:1,titleField:"title",properties:{},sections:{}};
  const invalid=[
    {...base,version:2},
    {...base,titleField:"attributes.__proto__"},
    {...base,titleField:"constructor"},
    {...base,properties:{score:"score"}},
    {...base,properties:{"bad:yaml":"type"}},
    {...base,properties:{project:"attributes.description"}},
    {...base,properties:{test:"attributes.constructor"}},
    {...base,properties:{auth:"source.secret"}},
    {...base,sections:{provenance:"yes"}},
    {...base,properties:Object.fromEntries(Array.from({length:21},(_,i)=>["attr"+i,"score"]))}
  ];
  for(const mapping of invalid){
    assert.throws(()=>parseNoteMapping(JSON.stringify(mapping)),/Invalid|Unsupported|Too many|reserved|allowed|version/i);
  }
  assert.throws(()=>parseNoteMapping("{"),/Invalid mapping JSON/);
  assert.throws(()=>parseNoteMapping(" ".repeat(12001)),/12 KB/);
});
test("mapping arbitrary source data never executes Markdown embeds as active unindented content",()=>{
  const suspicious={...second,attributes:{description:"Hello ![[Secret.md]]\n# heading",
    license:"---\nowner: alternate"}};
  const mapping=parseNoteMapping(JSON.stringify({
    version:1,titleField:"attributes.description",
    properties:{declared_license:"attributes.license"}
  }));
  const markdown=renderNote(suspicious,mapping);
  assert.doesNotMatch(markdown,/^!\[\[Secret.md\]\]/m);
  assert.doesNotMatch(markdown,/^# heading$/m);
  assert.doesNotMatch(markdown,/^owner: alternate$/m);
  assert.match(markdown,/declared_license: ".*\\nowner: alternate"/);
});
