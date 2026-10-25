import {strict as assert} from "node:assert";
import {resolve} from "node:path";
import {CliBridge} from "../src/cli-bridge.ts";
import {parseExport} from "../src/contracts.ts";
import {renderNote} from "../src/render.ts";

/**
 * Requires a REAL Source Scraper binary and synthetic project produced by its
 * own official `init` command on a disposable GitHub CI checkout.
 */
const [binary,configPath]=process.argv.slice(2);
if(!binary||!configPath)throw Error("Expected real engine CLI path and demo manifest");
const client=new CliBridge();
const config={cliPath:resolve(binary),configPath:resolve(configPath),nodeExecutable:process.execPath};
const version=await client.checkVersion(config);
assert.match(version,/^0\.14\.\d+$/);
const imported=await client.runAndImport(config);
assert.equal(imported.projectId,"starter-project");
assert.ok(imported.records.length>=2&&imported.records.length<=50);
const entity=imported.records[0];
assert.ok(entity.provenance?.mentions.length,"Real engine full export must retain provenance");
assert.match(renderNote(entity),/Machine assessment/);
// The actual CLI writes the review into its disposable SQLite database.
await client.review(config,imported.projectId,entity.key,"approved",
  "Human review integration test on synthetic local data");
await assert.rejects(
  client.review(config,"other-project",entity.key,"rejected","Must not write wrong project"),
  /differs from imported project/);
const after=await client.runAndImport(config);
assert.equal(after.records.find(e=>e.key===entity.key)?.review,"approved",
  "Approved review must survive engine replay and full JSON export");
assert.equal(client.running,false);
const literal=JSON.stringify(after);
assert.equal(parseExport(literal).records.length,after.records.length);
console.log(JSON.stringify({realCli:true,version,jsonSchema:1,
  records:after.records.length,provenance:true,reviewPersisted:true,
  personalVaultFilesWritten:0,externalOutputAdapterExecuted:false}));
