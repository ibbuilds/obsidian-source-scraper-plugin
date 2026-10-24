import {createHash} from "node:crypto";
import type {EntityRecord} from "./contracts.ts";
import {checkedUrl} from "./contracts.ts";

/** Only relative, ordinary note folders. No root file or dot/hidden folders. */
export function folderPath(input:string):string{
  const trimmed=input.trim();
  const parts=trimmed.split("/");
  if(parts.length<1||parts.length>5||parts.some(x=>
    !x||x==="."||x===".."||x.startsWith(".")||
    x.length>64||!/^[\p{L}\p{N} _-]+$/u.test(x)))
    throw new Error("Use a normal vault-relative folder without dots or traversal");
  return parts.join("/");
}
function escaped(value:unknown,limit=500):string{
  return String(value??"").replace(/[\u0000-\u001f\u007f]/g," ").slice(0,limit)
    .replace(/[\\`*_{}\[\]()#+.!|<>~-]/g,"\\$&");
}
const yaml=(value:unknown):string=>JSON.stringify(String(value??"")
  .replace(/[\u0000-\u001f\u007f]/g," ").slice(0,2000));
export function notePath(folder:string,record:EntityRecord):string{
  const id=createHash("sha256").update(record.projectId+"\0"+record.key).digest("hex").slice(0,24);
  return folderPath(folder)+"/"+record.projectId+"/"+id+".md";
}
function codeBlock(value:unknown):string{
  // Indented code, not fences: a malicious literal triple-backtick cannot
  // escape back into active Markdown/Obsidian embeds.
  return JSON.stringify(value,null,2).split("\n").map(line=>"    "+line).join("\n");
}
export function renderNote(entity:EntityRecord):string{
  const heading=escaped(entity.title,200);
  const url=checkedUrl(entity.url,"entity URL");
  const lines=[
    "---",
    "type: source-scraper-entity",
    "project: "+yaml(entity.projectId),
    "identity: "+yaml(entity.key),
    "entity_type: "+yaml(entity.type),
    "title: "+yaml(entity.title),
    "category: "+yaml(entity.category),
    "review: "+yaml(entity.review),
    "score: "+entity.score,
    "confidence: "+entity.confidence,
    "observation_count: "+entity.observationCount,
    "updated_at: "+yaml(entity.updatedAt),
    "---","",
    "# "+heading,"",
    ...(url?["Source: ["+heading+"](<"+url+">)",""]:[]),
    "## Machine assessment","",
    "- **Category:** "+escaped(entity.category,100),
    "- **Score:** "+entity.score+"/100",
    "- **Confidence:** "+entity.confidence,
    "- **Human review:** "+escaped(entity.review,20),
    ...entity.reasons.map(reason=>"- "+escaped(reason,400)),
    "",
    "## Structured attributes","",
    codeBlock(entity.attributes),"",
    "## Evidence and review history","",
  ];
  if(entity.provenance){
    lines.push("**Source mentions:** "+entity.provenance.mentions.length+
      (entity.provenance.mentionsTruncated?" (truncated by source export)":""));
    lines.push("","### Mentions","",codeBlock(entity.provenance.mentions),"",
      "### Human reviews","",codeBlock(entity.provenance.reviews),"",
      "### Assessment history","",codeBlock(entity.provenance.assessmentHistory),"");
  }else lines.push("Provenance was not included in the source export. No evidence was inferred.","");
  lines.push("> Automated scores are not human approval. Verify sources and licenses independently.","");
  return lines.join("\n");
}
