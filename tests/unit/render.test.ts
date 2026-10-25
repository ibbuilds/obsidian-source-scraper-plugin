import {test} from "node:test";
import assert from "node:assert/strict";
import {folderPath,notePath,renderNote} from "../../src/render.ts";
import {first,second} from "./fixtures.ts";
test("content is generic and preserves source evidence without fabricated metadata",()=>{
  const md=renderNote(first);
  assert.match(md,/type: source-scraper-entity/);
  assert.match(md,/Synthetic fixture/);
  assert.match(md,/## Evidence and review history/);
  assert.match(md,/record-001/);
  assert.doesNotMatch(md,/Resource: \[/);
  assert.doesNotMatch(md,/X For You|React UI|References\.md/);
  assert.match(renderNote(second),/Human reviews/);
  assert.match(renderNote(second),/Human review in source engine/);
});
test("filenames are stable for project and key; folder paths cannot traverse",()=>{
  assert.equal(notePath("Source Scraper/Imported",first),notePath("Source Scraper/Imported",first));
  assert.notEqual(notePath("Source Scraper/Imported",first),notePath("Source Scraper/Imported",second));
  assert.match(notePath("Source Scraper/Imported",first),/^Source Scraper\/Imported\/generic-library\/[a-f0-9]{24}\.md$/);
  for(const bad of ["../Projects","/etc","Source Scraper/../Projects",".obsidian/plugins",
    "Source Scraper\\Bad","", "foo//bar","foo/a.md","foo/"]){
    assert.throws(()=>folderPath(bad),/normal vault-relative folder/);
  }
});
test("markdown injection stays in escaped text or an indented JSON block",()=>{
  const evil={...first,title:"Hello ![[Secret.md]]\n# injected",
    attributes:{custom:"```\n![[Vault.md]]\n```",note:"---\nplugin: evil"},
    reasons:["[click](javascript:alert(1))","![[private]]"]};
  const md=renderNote(evil);
  assert.doesNotMatch(md,/\n# injected/);
  assert.doesNotMatch(md,/\n!\[\[Vault\.md\]\]/);
  assert.match(md,/    "custom":/);
  assert.ok(md.includes("\\n![[Vault.md]]"),"Unsafe embed stays escaped inside JSON");
  assert.match(md,/review: "pending"/);
});
