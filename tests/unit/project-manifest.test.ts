import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,lstatSync,symlinkSync} from "node:fs";
import {writeFile as writeExclusive} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {parseProjectManifest,GENERIC_TEMPLATE,createNewProjectFile} from "../../src/project-manifest.ts";
import type {VaultLike} from "../../src/vault-writer.ts";

class TestVault implements VaultLike {
  readonly root:string;
  constructor(root:string){this.root=root;}
  getAbstractFileByPath(path:string):{path:string;children?:unknown[]}|null {
    const absolute=join(this.root,path);
    if(!existsSync(absolute))return null;
    return lstatSync(absolute).isDirectory()?{path,children:[]}:{path};
  }
  async createFolder(path:string):Promise<void>{mkdirSync(join(this.root,path));}
  async create(path:string,content:string):Promise<void>{
    await writeExclusive(join(this.root,path),content,{flag:"wx"});
  }
}
test("neutral generalist template is valid with no personal keywords or outputs",()=>{
  const p=parseProjectManifest(GENERIC_TEMPLATE);
  assert.equal(p.id,"my-research");
  assert.equal(p.sources.length,1);
  assert.equal(p.sources[0].adapter,"json-file");
  assert.deepEqual(p.policy.includeKeywords,[]);
  assert.deepEqual(p.policy.excludeKeywords,[]);
  assert.deepEqual(p.outputs,[]);
});
test("general projects allow any normalized adapter, nested watch rules and a generic evaluator",()=>{
  const input={id:"neutral-research",name:"Source-independent workflow",
    sources:[{id:"sources-1",adapter:"custom-feed",config:{path:"./items.json",settings:{refresh:true}}}],
    pipeline:["observation-entity","custom-processor"],evaluator:"my-evaluator",
    policy:{includeKeywords:[],excludeKeywords:["duplicate"],minimumScore:0},
    outputs:[{id:"unused",adapter:"my-output",config:{folder:"Generated"}}],
    watch:{rules:[{id:"version-changed",path:"/attributes/version",operator:"changed"}]},
    entitySchemas:{"source-record":{fields:{version:"string"}}}};
  const parsed=parseProjectManifest(JSON.stringify(input));
  assert.equal(parsed.sources[0].adapter,"custom-feed");
  assert.equal(parsed.outputs[0].adapter,"my-output");
  assert.deepEqual(parsed.pipeline,input.pipeline);
  assert.deepEqual(parsed.watch,input.watch);
  assert.deepEqual(parsed.entitySchemas,input.entitySchemas);
});
test("reject malformed project objects, duplicate connection IDs, unsafe source paths and embedded credentials",()=>{
  const source=JSON.parse(GENERIC_TEMPLATE) as Record<string,unknown>;
  const invalid=[
    {...source,id:"../escape"},
    {...source,sources:[]},
    {...source,sources:[{id:"x",adapter:"rss",config:{url:"https://example.org/feed"}},
      {id:"x",adapter:"rss",config:{url:"https://example.org/other"}}]},
    {...source,policy:{minimumScore:-4,includeKeywords:[],excludeKeywords:[]}},
    {...source,pipeline:["__proto__"]},
    {...source,sources:[{id:"local",adapter:"json-file",config:{api_key:"secret"}}]},
    {...source,sources:[{id:"local",adapter:"rss",config:{url:"https://example.org?session=abcd"}}]},
    {...source,outputs:[{id:"notify",adapter:"webhook",config:{authorization:"Bearer secret"}}]},
    {...source,sources:[{id:"local",adapter:"json-file",config:JSON.parse('{"__proto__":123}')}]}
  ];
  for(const input of invalid){
    assert.throws(()=>parseProjectManifest(JSON.stringify(input)),
      /Invalid|Unsafe|Credentials|credential|Duplicate|requires at least/i);
  }
  assert.throws(()=>parseProjectManifest("{"),/Invalid project JSON/);
  assert.throws(()=>parseProjectManifest(" ".repeat(200001)),/200 KB/);
});
test("a new manifest can be created once; changing source afterward cannot replace it",async()=>{
  const root=mkdtempSync(join(tmpdir(),"source-scraper-manifest-"));
  const refs="# My original references\nNever overwrite.\n";
  try{
    const vault=new TestVault(root);
    writeFileSync(join(root,"References.md"),refs);
    mkdirSync(join(root,"Projects"));
    writeFileSync(join(root,"Projects","Important.md"),"User-authored content");
    const one=await createNewProjectFile(vault,"Source Scraper/Projects",GENERIC_TEMPLATE,root);
    assert.equal(one.created,true);
    assert.equal(one.path,"Source Scraper/Projects/my-research.json");
    const original=readFileSync(join(root,one.path),"utf8");
    assert.equal(parseProjectManifest(original).id,"my-research");
    const modified=JSON.stringify({...JSON.parse(GENERIC_TEMPLATE),name:"Changed input"});
    const again=await createNewProjectFile(vault,"Source Scraper/Projects",modified,root);
    assert.deepEqual(again,{path:one.path,created:false});
    assert.equal(readFileSync(join(root,one.path),"utf8"),original);
    assert.equal(readFileSync(join(root,"References.md"),"utf8"),refs);
    assert.equal(readFileSync(join(root,"Projects","Important.md"),"utf8"),"User-authored content");
  }finally{rmSync(root,{recursive:true,force:true});}
});
test("project manifest cannot follow symlinks or escape to a hidden/foreign folder",async()=>{
  const root=mkdtempSync(join(tmpdir(),"source-scraper-manifest-safety-"));
  const outside=mkdtempSync(join(tmpdir(),"source-scraper-manifest-outside-"));
  try{
    const vault=new TestVault(root);
    symlinkSync(outside,join(root,"Linked"));
    await assert.rejects(createNewProjectFile(vault,"Linked/Projects",GENERIC_TEMPLATE,root),/symbolic-link/);
    assert.equal(existsSync(join(outside,"Projects")),false);
    for(const folder of [".obsidian/plugins","../Projects","/root","a//b","a\\b"]){
      await assert.rejects(createNewProjectFile(vault,folder,GENERIC_TEMPLATE,root),/normal vault-relative folder/);
    }
  }finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});
