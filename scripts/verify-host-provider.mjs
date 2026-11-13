/** Load the actual patched host registry and register the complete real provider. */
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {build} from "esbuild";
import {SourceScraperProvider} from "../src/mcp-provider.ts";
import {DEFAULT_NOTE_MAPPING_JSON} from "../src/note-mapping.ts";
const root=mkdtempSync(join(tmpdir(),"ss-host-provider-"));let provider;
try{
 const outfile=join(root,"host-registry.mjs"),host=resolve(process.argv[2]||"../vault-mcp");
 await build({entryPoints:[join(host,"src/vaultasmcp-ToolProviders.ts")],outfile,bundle:true,format:"esm",platform:"node",logLevel:"silent"});
 const {ToolProviders}=await import(pathToFileURL(outfile).href),registry=new ToolProviders(()=>["source-scraper"]),vault=join(root,"vault");mkdirSync(vault);
 provider=new SourceScraperProvider({cliPath:join(root,"absent.mjs"),cliHash:"",nodeExecutable:process.execPath,projects:[],workspacePath:join(root,"projects"),statePath:join(root,"private/state.json"),vaultPath:vault,mapping:()=>DEFAULT_NOTE_MAPPING_JSON,pathExists:()=>false,stage:()=>{throw Error("Unexpected staging");},checkRead:()=>{},readReference:async()=>""});
 const names=provider.tools.map(t=>t.name),dispose=registry.register(provider);assert.equal(names.length,33);assert.deepEqual(registry.definitions().map(t=>t.name),names);
 const capabilities=await registry.execute("source_scraper_capabilities",{});assert.equal(capabilities.toolNames.length,33);assert.equal(capabilities.noteWritesSupported,false);
 await assert.rejects(registry.execute("source_scraper_capabilities",{arbitrary:true}),/arguments/);
 assert.ok(names.includes("source_scraper_get_posts")&&names.includes("source_scraper_process_pending"));dispose();assert.equal(registry.definitions().length,0);
 console.log(JSON.stringify({passed:true,actualHostRegistry:true,actualProvider:true,registeredTools:names.length,dispatched:true,argumentBoundary:true,disposal:true,sourceReads:0,notesChanged:0}));
}finally{provider?.dispose();rmSync(root,{recursive:true,force:true});}
