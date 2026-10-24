import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {CliBridge} from "../../src/cli-bridge.ts";
import {envelope} from "./fixtures.ts";
test("optional bridge checks public version then invokes fixed CLI commands without a shell",async()=>{
  const root=mkdtempSync(join(tmpdir(),"ss-cli-bridge-"));
  try{
    const cliPath=join(root,"mock.mjs"),configPath=join(root,"project.json");
    writeFileSync(configPath,"{}");
    writeFileSync(cliPath,`const cmd=process.argv[2];
if(cmd==="version")console.log(JSON.stringify({name:"source-scraper",version:"0.14.0",jsonSchemaVersion:1}));
else if(cmd==="run")console.log(JSON.stringify({result:{success:true}}));
else if(cmd==="export")console.log(JSON.stringify(${JSON.stringify(envelope)}));
else process.exit(19);`);
    const bridge=new CliBridge(),config={nodeExecutable:process.execPath,cliPath,configPath};
    assert.equal(await bridge.checkVersion(config),"0.14.0");
    const rows=await bridge.runAndImport(config);
    assert.equal(rows.records.length,2);
    assert.equal(bridge.running,false);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test("unsupported CLI version cannot trigger project collection",async()=>{
  const root=mkdtempSync(join(tmpdir(),"ss-cli-untrusted-"));
  try{
    const cliPath=join(root,"mock.mjs"),configPath=join(root,"project.json");
    writeFileSync(configPath,"{}");
    writeFileSync(cliPath,`console.log(JSON.stringify({name:"other",jsonSchemaVersion:3}));`);
    const client=new CliBridge();
    await assert.rejects(client.runAndImport({nodeExecutable:process.execPath,cliPath,configPath}),/Unsupported/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
