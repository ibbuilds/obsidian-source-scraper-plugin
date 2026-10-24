import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync,lstatSync,symlinkSync} from "node:fs";
import {join,dirname} from "node:path";
import {tmpdir} from "node:os";
import {createOnlyNotes,selectedPlans,type VaultLike} from "../../src/vault-writer.ts";
import {first,second} from "./fixtures.ts";

class MockVault implements VaultLike{
  readonly root:string;
  constructor(root:string){this.root=root;}
  getAbstractFileByPath(path:string):{path:string;children?:unknown[]}|null{
    const absolute=join(this.root,path);
    if(!existsSync(absolute))return null;
    const stat=lstatSync(absolute);
    return stat.isDirectory()?{path,children:[]}:{path};
  }
  async createFolder(path:string):Promise<void>{mkdirSync(join(this.root,path));}
  async create(path:string,content:string):Promise<void>{
    const fs=await import("node:fs/promises");
    await fs.writeFile(join(this.root,path),content,{flag:"wx"});
  }
}
test("create-only output never changes existing vault notes or manual edits",async()=>{
  const root=mkdtempSync(join(tmpdir(),"ss-new-plugin-vault-"));
  const references="# Existing references\n- [Original](https://example.org)\n";
  const old=join(root,"References.md");
  try{
    writeFileSync(old,references);
    mkdirSync(join(root,"Projects"));writeFileSync(join(root,"Projects","user.md"),"Private authored content");
    const vault=new MockVault(root),folder="Source Scraper/Imported";
    const firstResult=await createOnlyNotes(vault,folder,[first,second],root);
    assert.equal(firstResult.created,2);
    assert.deepEqual(firstResult.conflicts,[]);
    assert.equal(readFileSync(old,"utf8"),references);
    assert.equal(readFileSync(join(root,"Projects","user.md"),"utf8"),"Private authored content");
    const selected=selectedPlans(folder,[first,second]);
    const edited="User manually edited a created note; never overwritten";
    writeFileSync(join(root,selected[0].path),edited);
    const replay=await createOnlyNotes(vault,folder,[first,second],root);
    assert.equal(replay.created,0);
    assert.equal(replay.conflicts.length,2);
    assert.equal(readFileSync(join(root,selected[0].path),"utf8"),edited);
    assert.equal(readFileSync(old,"utf8"),references);
    assert.equal(readFileSync(join(root,"Projects","user.md"),"utf8"),"Private authored content");
  }finally{rmSync(root,{recursive:true,force:true});}
});
test("blocks symlink destination and mixed-up folder conflicts without touching other files",async()=>{
  const root=mkdtempSync(join(tmpdir(),"ss-unsafe-plugin-"));
  const outside=mkdtempSync(join(tmpdir(),"ss-external-"));
  try{
    const vault=new MockVault(root);
    symlinkSync(outside,join(root,"Linked"));
    await assert.rejects(createOnlyNotes(vault,"Linked/Imports",[first],root),/symbolic-link/);
    assert.equal(existsSync(join(outside,"Imports")),false);
    writeFileSync(join(root,"Existing"),"not a directory");
    await assert.rejects(createOnlyNotes(vault,"Existing/Foo",[first],root),/conflicts with a file/);
    assert.equal(readFileSync(join(root,"Existing"),"utf8"),"not a directory");
  }finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});
test("nothing written with an empty record selection",async()=>{
  const root=mkdtempSync(join(tmpdir(),"ss-noop-"));
  try{
    const result=await createOnlyNotes(new MockVault(root),"Source Scraper/Imported",[],root);
    assert.equal(result.created,0);
    assert.equal(existsSync(join(root,"Source Scraper")),false);
  }finally{rmSync(root,{recursive:true,force:true});}
});
