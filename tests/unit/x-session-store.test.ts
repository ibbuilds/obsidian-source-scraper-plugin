import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync,copyFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createCipheriv,createDecipheriv,randomBytes} from "node:crypto";
import {XSessionStore,type SessionCipher} from "../../src/x-session-store.ts";
const vaultId="a".repeat(24),session={accountSession:"synthetic-test-auth",csrf:"synthetic-test-csrf"};
function testCipher():SessionCipher{
  const key=randomBytes(32);
  return {async protect(value){const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv),encrypted=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString("base64");},
    async unprotect(value){const bytes=Buffer.from(value,"base64"),cipher=createDecipheriv("aes-256-gcm",key,bytes.subarray(0,12),{authTagLength:16});cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString("utf8");}};
}
test("encrypted X sessions survive new store instances, stay separate per vault and are forgotten explicitly",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"ss-session-")),cipher=testCipher();
  try{
    const first=new XSessionStore({directory,vaultId,cipher,platform:"win32"});assert.equal(await first.load(),undefined);
    await first.saveAndCommit(session,async()=>{});const raw=readFileSync(first.file,"utf8");
    assert.ok(!raw.includes(session.accountSession)&&!raw.includes(session.csrf));
    const reopened=new XSessionStore({directory,vaultId,cipher,platform:"win32"});assert.deepEqual(await reopened.load(),session);
    const other=new XSessionStore({directory,vaultId:"b".repeat(24),cipher,platform:"win32"});assert.equal(await other.load(),undefined);
    copyFileSync(first.file,other.file);await assert.rejects(other.load(),/encrypted X session/);
    await reopened.forgetAndCommit(async()=>{});assert.equal(existsSync(first.file),false);assert.equal(await first.load(),undefined);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
test("failed preference commits restore the exact prior ciphertext; a rejected operation does not poison later saves",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"ss-session-rollback-"));
  try{
    const store=new XSessionStore({directory,vaultId,cipher:testCipher(),platform:"win32"});
    await store.saveAndCommit(session,async()=>{});const prior=readFileSync(store.file,"utf8");
    await assert.rejects(store.saveAndCommit({...session,csrf:"synthetic-replacement"},async()=>{throw Error("synthetic-sensitive-error");}),error=>!String(error).includes("synthetic-sensitive-error"));
    assert.equal(readFileSync(store.file,"utf8"),prior);assert.deepEqual(await store.load(),session);
    await assert.rejects(store.forgetAndCommit(async()=>{throw Error("failed preferences");}),/encrypted X session/);
    assert.equal(readFileSync(store.file,"utf8"),prior);
    await store.saveAndCommit({...session,csrf:"synthetic-replacement"},async()=>{});assert.equal((await store.load())?.csrf,"synthetic-replacement");
  }finally{rmSync(directory,{recursive:true,force:true});}
});
test("corrupt ciphertext and invalid sessions fail closed without leaking values or a plaintext fallback",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"ss-session-invalid-")),cipher=testCipher();
  try{
    const store=new XSessionStore({directory,vaultId,cipher,platform:"win32"});
    await assert.rejects(store.saveAndCommit({accountSession:"",csrf:"x"},async()=>{}));assert.equal(existsSync(store.file),false);
    writeFileSync(store.file,"broken encrypted payload");await assert.rejects(store.load(),/encrypted X session/);
    const raw=await cipher.protect(JSON.stringify({version:1,vaultId,session:{accountSession:100,csrf:true}}));writeFileSync(store.file,raw);
    await assert.rejects(store.load(),/encrypted X session/);
    const bad=new XSessionStore({directory,vaultId,cipher:{async protect(){throw Error(session.accountSession);},async unprotect(){throw Error("not used");}},platform:"win32"});
    await assert.rejects(bad.saveAndCommit(session,async()=>{}));assert.equal(readFileSync(store.file,"utf8"),raw);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
test("unsupported operating systems keep memory-only behavior and do not write credentials",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"ss-session-unsupported-"));
  try{
    const store=new XSessionStore({directory,vaultId,platform:"linux"});let commits=0;
    await store.saveAndCommit(session,async()=>{commits++;});assert.equal(commits,1);assert.equal(store.supported,false);assert.equal(await store.load(),undefined);assert.equal(existsSync(store.file),false);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
test("real Windows DPAPI encrypts and restores a synthetic session for the current user",{skip:process.platform!=="win32"},async()=>{
  const directory=mkdtempSync(join(tmpdir(),"ss-session-dpapi-"));
  try{
    const first=new XSessionStore({directory,vaultId});await first.saveAndCommit(session,async()=>{});
    const bytes=readFileSync(first.file,"utf8");assert.match(bytes,/^[A-Za-z0-9+/]+={0,2}$/);assert.ok(!bytes.includes("synthetic"));
    assert.deepEqual(await new XSessionStore({directory,vaultId}).load(),session);
    await first.forgetAndCommit(async()=>{});assert.equal(existsSync(first.file),false);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
