import {lstatSync,realpathSync} from "node:fs";
import {join} from "node:path";
import type {EntityRecord} from "./contracts.ts";
import {folderPath,notePath,renderNote} from "./render.ts";
import type {NoteMapping} from "./note-mapping.ts";
export interface VaultLike {
  getAbstractFileByPath(path:string):{path:string;children?:unknown[]}|null;
  createFolder(path:string):Promise<unknown>;
  create(path:string,content:string):Promise<unknown>;
}
/** Never calls modify, rename, delete, trash or process on a vault note. */
export function selectedPlans(folder:string,items:readonly EntityRecord[],
  mapping?:NoteMapping):Array<{path:string;content:string;entity:EntityRecord}>{
  if(items.length>200)throw new Error("Select at most 200 records per write");
  const checked=folderPath(folder);
  return items.map(entity=>({path:notePath(checked,entity),content:renderNote(entity,mapping),entity}));
}
function symlinkCheck(root:string|undefined,relative:string):void{
  if(!root)return;
  const canonical=realpathSync(root);
  const parts=relative.split("/");
  let current=canonical;
  for(const part of parts){
    current=join(current,part);
    try{
      if(lstatSync(current).isSymbolicLink())
        throw new Error("Refusing to write through a symbolic-link path");
    }catch(error){
      const code=(error as NodeJS.ErrnoException).code;
      if(code==="ENOTDIR")throw new Error("Output directory conflicts with a file");
      if(code!=="ENOENT")throw error;
    }
  }
}
export interface WriteResult {created:number;conflicts:string[];paths:string[]}
export async function createOnlyNotes(vault:VaultLike,folder:string,items:readonly EntityRecord[],
  rootPath?:string,mapping?:NoteMapping):Promise<WriteResult>{
  const plans=selectedPlans(folder,items,mapping);
  // Preflight every target before creating *any* folders, including symlinks.
  for(const item of plans)symlinkCheck(rootPath,item.path);
  const folders=new Set<string>();
  for(const plan of plans){
    const parts=plan.path.split("/");
    for(let i=1;i<parts.length;i++)folders.add(parts.slice(0,i).join("/"));
  }
  for(const path of [...folders].sort((a,b)=>a.split("/").length-b.split("/").length)){
    symlinkCheck(rootPath,path);
    const existing=vault.getAbstractFileByPath(path);
    if(existing){
      if(!Array.isArray(existing.children))throw new Error("Output directory conflicts with a file: "+path);
      continue;
    }
    // Make only the explicitly selected destination/project directory.
    await vault.createFolder(path);
  }
  const result:WriteResult={created:0,conflicts:[],paths:[]};
  for(const item of plans){
    symlinkCheck(rootPath,item.path);
    if(vault.getAbstractFileByPath(item.path)){
      result.conflicts.push(item.path);continue;
    }
    try{
      // Obsidian Vault.create is create-only and rejects existing paths.
      await vault.create(item.path,item.content);
      result.created++;
      result.paths.push(item.path);
    }catch(error){
      // If a path appeared during an asynchronous create, refuse overwriting.
      if(vault.getAbstractFileByPath(item.path)){result.conflicts.push(item.path);continue;}
      throw error;
    }
  }
  return result;
}

/**
 * Save a user-authored project JSON manifest without taking ownership of any
 * existing vault file. This follows the same symlink and path preflight as
 * entity-note output, and only supports validated project-id JSON filenames.
 */
export async function createOnlyDocument(vault:VaultLike,relativePath:string,
  content:string,rootPath?:string):Promise<{path:string;created:boolean}>{
  const slash=relativePath.lastIndexOf("/");
  if(slash<1)throw new Error("A dedicated project folder is required");
  const dir=folderPath(relativePath.slice(0,slash));
  const name=relativePath.slice(slash+1);
  if(!/^[a-z][a-z0-9_-]{1,63}\.json$/.test(name))
    throw new Error("Project filename must be a safe project id with .json");
  if(typeof content!=="string"||!content||Buffer.byteLength(content,"utf8")>200000)
    throw new Error("Project manifest exceeds its size limit");
  const path=dir+"/"+name;
  // Verify every ancestor before any file or directory creation.
  symlinkCheck(rootPath,path);
  const ancestors=dir.split("/");
  for(let i=1;i<=ancestors.length;i++){
    const parent=ancestors.slice(0,i).join("/");
    symlinkCheck(rootPath,parent);
    const existing=vault.getAbstractFileByPath(parent);
    if(existing){
      if(!Array.isArray(existing.children))
        throw new Error("Project directory conflicts with an existing file");
      continue;
    }
    await vault.createFolder(parent);
  }
  symlinkCheck(rootPath,path);
  if(vault.getAbstractFileByPath(path))return {path,created:false};
  try{
    await vault.create(path,content);
    return {path,created:true};
  }catch(error){
    if(vault.getAbstractFileByPath(path))return {path,created:false};
    throw error;
  }
}
