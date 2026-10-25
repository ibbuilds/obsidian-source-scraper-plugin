import {lstatSync,realpathSync} from "node:fs";
import {join} from "node:path";
import type {EntityRecord} from "./contracts.ts";
import {folderPath,notePath,renderNote} from "./render.ts";
export interface VaultLike {
  getAbstractFileByPath(path:string):{path:string;children?:unknown[]}|null;
  createFolder(path:string):Promise<unknown>;
  create(path:string,content:string):Promise<unknown>;
}
/** Never calls modify, rename, delete, trash or process on a vault note. */
export function selectedPlans(folder:string,items:readonly EntityRecord[]):Array<{path:string;content:string;entity:EntityRecord}>{
  if(items.length>200)throw new Error("Select at most 200 records per write");
  const checked=folderPath(folder);
  return items.map(entity=>({path:notePath(checked,entity),content:renderNote(entity),entity}));
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
  rootPath?:string):Promise<WriteResult>{
  const plans=selectedPlans(folder,items);
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
