import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {setTimeout as delay} from "node:timers/promises";
import {CliBridge} from "../../src/cli-bridge.ts";
import {envelope} from "./fixtures.ts";
test("optional bridge checks public version then invokes fixed CLI commands without a shell",async()=>{
  const root=mkdtempSync(join(tmpdir(),"ss-cli-bridge-"));
  try{
    const cliPath=join(root,"mock.mjs"),configPath=join(root,"project.json");
    writeFileSync(configPath,"{}");
    writeFileSync(cliPath,`const cmd=process.argv[2];
if(cmd==="version")console.log(JSON.stringify({name:"source-scraper",version:"0.14.0",jsonSchemaVersion:1}));
else if(cmd==="validate")console.log(JSON.stringify({valid:true,id:"generic-library"}));
else if(cmd==="review")console.log(JSON.stringify({entity:{key:"record:no-url",review:"approved"}}));
else if(cmd==="run")console.log(JSON.stringify({id:"generic-library",result:{success:true}}));
else if(cmd==="export")console.log(JSON.stringify(${JSON.stringify(envelope)}));
else process.exit(19);`);
    const bridge=new CliBridge(),config={nodeExecutable:process.execPath,cliPath,configPath};
    assert.equal(await bridge.checkVersion(config),"0.14.0");
    const rows=await bridge.runAndImport(config);
    assert.equal(rows.records.length,2);
    assert.equal(bridge.running,false);
    await bridge.review(config,"generic-library","record:no-url","approved","Human verification");
    await assert.rejects(
      bridge.review(config,"other-project","record:no-url","approved","Should not write"),
      /differs from imported project/
    );
    await assert.rejects(
      bridge.review(config,"generic-library","record:no-url","approved"," "),
      /Review reason required/
    );
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

test("CLI imports preserve Unicode titles and keys across pipe chunks",async()=>{
  const root=mkdtempSync(join(tmpdir(),"ss-cli-unicode-"));
  try{
    const cliPath=join(root,"mock.mjs"),configPath=join(root,"project.json");
    writeFileSync(configPath,"{}");
    const source=structuredClone(envelope);
    source.records[0].title="Investigación 研究 🔎";
    source.records[0].key="record:clé-研究-🔎";
    // Split inside every non-ASCII code point, including key and title. Short
    // delays force separate pipe data events without depending on chunk sizes.
    writeFileSync(cliPath,`const cmd=process.argv[2];
if(cmd==="version")console.log(JSON.stringify({name:"source-scraper",version:"0.14.0",jsonSchemaVersion:1}));
else if(cmd==="validate")console.log(JSON.stringify({valid:true,id:"generic-library"}));
else if(cmd==="run")console.log(JSON.stringify({id:"generic-library",result:{success:true}}));
else if(cmd==="export"){
  const bytes=Buffer.from(${JSON.stringify(JSON.stringify(source))});
  let start=0;
  for(let i=0;i<bytes.length;i++){
    if(bytes[i]>=0xc0){
      process.stdout.write(bytes.subarray(start,i+1));
      start=i+1;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
  }
  process.stdout.write(bytes.subarray(start));
}else process.exit(19);`);
    const bridge=new CliBridge();
    const imported=await bridge.runAndImport({nodeExecutable:process.execPath,cliPath,configPath});
    assert.equal(imported.records[0].title,source.records[0].title);
    assert.equal(imported.records[0].key,source.records[0].key);
    assert.equal(bridge.running,false);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("CLI response cap counts bytes for multibyte output",async()=>{
  const root=mkdtempSync(join(tmpdir(),"ss-cli-output-limit-"));
  try{
    const cliPath=join(root,"mock.mjs"),configPath=join(root,"project.json");
    writeFileSync(configPath,"{}");
    writeFileSync(cliPath,`const cmd=process.argv[2];
if(cmd==="version")console.log(JSON.stringify({name:"source-scraper",version:"0.14.0",jsonSchemaVersion:1}));
else if(cmd==="validate")console.log(JSON.stringify({valid:true,id:"generic-library"}));
else if(cmd==="run")console.log(JSON.stringify({id:"generic-library",result:{success:true}}));
else if(cmd==="export")process.stdout.write(JSON.stringify({text:"é".repeat(4_500_001)}));
else process.exit(19);`);
    const bridge=new CliBridge();
    await assert.rejects(
      bridge.runAndImport({nodeExecutable:process.execPath,cliPath,configPath}),
      /9 MB response cap/
    );
    assert.equal(bridge.running,false);
  }finally{rmSync(root,{recursive:true,force:true});}
});

async function waitForFile(path:string):Promise<void>{
  const deadline=Date.now()+3000;
  while(!existsSync(path)){
    if(Date.now()>deadline)throw new Error("CLI fixture did not create its marker");
    await delay(10);
  }
}
function alive(pid:number):boolean{
  try{process.kill(pid,0);return true;}catch{return false;}
}

for(const mode of ["normal","delayed","ignored"] as const){
  test("CLI cancellation waits for child close ("+mode+" SIGTERM)",{
    // Windows terminates on SIGTERM regardless of JavaScript signal handlers.
    skip:process.platform==="win32"&&mode!=="normal",timeout:6000
  },async()=>{
    const root=mkdtempSync(join(tmpdir(),"ss-cli-cancel-"));
    const bridge=new CliBridge();
    let pid:number|undefined;
    try{
      const cliPath=join(root,"mock.mjs"),configPath=join(root,"project.json");
      const started=join(root,"started"),stopping=join(root,"stopping"),release=join(root,"release");
      writeFileSync(configPath,"{}");
      writeFileSync(cliPath,`import {writeFileSync,existsSync} from "node:fs";
const mode=${JSON.stringify(mode)};
if(mode!=="normal")process.on("SIGTERM",()=>{
  writeFileSync(${JSON.stringify(stopping)},"ready");
  if(mode==="delayed")setInterval(()=>{
    if(existsSync(${JSON.stringify(release)})){
      console.log(JSON.stringify({name:"source-scraper",version:"0.14.0",jsonSchemaVersion:1}));
      process.exit(0);
    }
  },10);
});
writeFileSync(${JSON.stringify(started)},String(process.pid));
setInterval(()=>{},1000);`);
      const config={nodeExecutable:process.execPath,cliPath,configPath};
      // Attach both handlers immediately so any regression cannot leave an
      // unhandled rejection while the test waits for the subprocess marker.
      let settled=false;
      const outcome=bridge.checkVersion(config).then(
        ()=>{settled=true;return undefined;},
        (error:unknown)=>{settled=true;return error;}
      );
      await waitForFile(started);
      pid=Number(readFileSync(started,"utf8"));
      bridge.cancel();
      if(mode!=="normal"){
        await waitForFile(stopping);
        assert.equal(alive(pid),true);
        assert.equal(settled,false,"cancellation must wait for the actual child close");
        assert.equal(bridge.running,true);
        await assert.rejects(bridge.checkVersion(config),/Another Source Scraper command is running/);
        if(mode==="delayed")writeFileSync(release,"stop now");
      }
      const error=await outcome;
      assert.ok(error instanceof Error);
      assert.match(error.message,/cancelled/);
      assert.equal(alive(pid),false,"the direct CLI process must be gone before unlocking");
      assert.equal(bridge.running,false);
      // A graceful zero exit after cancellation is still cancellation, and
      // once it really closes the bridge can run another independent command.
      writeFileSync(cliPath,'console.log(JSON.stringify({name:"source-scraper",version:"0.14.0",jsonSchemaVersion:1}));');
      assert.equal(await bridge.checkVersion(config),"0.14.0");
    }finally{
      bridge.cancel();
      if(pid&&alive(pid))process.kill(pid,"SIGKILL");
      rmSync(root,{recursive:true,force:true});
    }
  });
}

test("a failed CLI spawn settles and releases the running lock",{timeout:4000},async()=>{
  const root=mkdtempSync(join(tmpdir(),"ss-cli-start-failure-"));
  try{
    const cliPath=join(root,"mock.mjs"),configPath=join(root,"project.json");
    writeFileSync(configPath,"{}");
    writeFileSync(cliPath,'console.log(JSON.stringify({name:"source-scraper",version:"0.14.0",jsonSchemaVersion:1}));');
    const bridge=new CliBridge();
    await assert.rejects(bridge.checkVersion({nodeExecutable:join(root,"missing-node"),cliPath,configPath}),
      /CLI could not start/);
    assert.equal(bridge.running,false);
    assert.equal(await bridge.checkVersion({nodeExecutable:process.execPath,cliPath,configPath}),"0.14.0");
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("cancel detaches inherited pipes after the direct CLI has exited",{timeout:6000},async()=>{
  const root=mkdtempSync(join(tmpdir(),"ss-cli-inherited-pipes-"));
  const bridge=new CliBridge();
  let directPid:number|undefined,descendantPid:number|undefined;
  try{
    const cliPath=join(root,"mock.mjs"),configPath=join(root,"project.json"),started=join(root,"started");
    const descendantPath=join(root,"descendant.mjs"),ready=join(root,"descendant-ready");
    writeFileSync(configPath,"{}");
    // Windows needs detached:true for the descendant to survive its parent's
    // exit. Keep inherited pipes intentionally, and wait for the descendant's
    // own ready marker so this tests cancellation rather than a startup race.
    writeFileSync(descendantPath,`import {writeFileSync,renameSync} from "node:fs";
setInterval(()=>{},1000);
writeFileSync(${JSON.stringify(ready+".tmp")},String(process.pid));
renameSync(${JSON.stringify(ready+".tmp")},${JSON.stringify(ready)});`);
    writeFileSync(cliPath,`import {spawn} from "node:child_process";
import {writeFileSync,renameSync,existsSync} from "node:fs";
import {setTimeout as delay} from "node:timers/promises";
const descendant=spawn(process.execPath,[${JSON.stringify(descendantPath)}],{
  detached:true,windowsHide:true,stdio:["ignore","inherit","inherit"]
});
writeFileSync(${JSON.stringify(started+".tmp")},JSON.stringify({direct:process.pid,descendant:descendant.pid}));
renameSync(${JSON.stringify(started+".tmp")},${JSON.stringify(started)});
const deadline=Date.now()+3000;
while(!existsSync(${JSON.stringify(ready)})){
  if(Date.now()>deadline)throw new Error("Descendant fixture did not start");
  await delay(10);
}
descendant.unref();
console.log(JSON.stringify({name:"source-scraper",version:"0.14.0",jsonSchemaVersion:1}));`);
    const outcome=bridge.checkVersion({nodeExecutable:process.execPath,cliPath,configPath})
      .then(()=>undefined,(error:unknown)=>error);
    await waitForFile(started);
    const pids=JSON.parse(readFileSync(started,"utf8")) as {direct:number;descendant:number};
    directPid=pids.direct;descendantPid=pids.descendant;
    await waitForFile(ready);
    assert.equal(Number(readFileSync(ready,"utf8")),descendantPid);
    const deadline=Date.now()+3000;
    while(alive(directPid)){
      if(Date.now()>deadline)throw new Error("Direct CLI fixture did not exit");
      await delay(10);
    }
    assert.equal(alive(descendantPid),true);
    assert.equal(bridge.running,true,"inherited output pipes are still open");
    bridge.cancel();
    const error=await outcome;
    assert.ok(error instanceof Error);
    assert.match(error.message,/cancelled/);
    assert.equal(bridge.running,false);
    assert.equal(alive(descendantPid),true,"cancel must not kill an arbitrary process tree");
  }finally{
    bridge.cancel();
    for(const pid of [directPid,descendantPid])if(pid&&alive(pid))process.kill(pid,"SIGKILL");
    rmSync(root,{recursive:true,force:true});
  }
});
