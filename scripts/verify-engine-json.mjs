import {readFileSync} from "node:fs";
import {parseExport} from "../src/contracts.ts";
import {renderNote,notePath} from "../src/render.ts";
const path=process.argv[2];
if(!path)throw Error("A real Source Scraper export path is required");
const result=parseExport(readFileSync(path,"utf8"));
if(result.schemaVersion!==1||result.dataset!=="entities"||!result.records.length){
  throw Error("No real versioned Source Scraper entities found");
}
for(const entity of result.records){
  if(!entity.key||!entity.provenance?.mentions.length){
    throw Error("Missing original identity or evidence");
  }
  const preview=renderNote(entity);
  const dest=notePath("Source Scraper/Imported",entity);
  if(!preview.includes("source-scraper-entity")||
    !/^Source Scraper\/Imported\/[a-z0-9_-]+\/[a-f0-9]{24}\.md$/.test(dest)){
    throw Error("Plugin cannot safely preview an actual engine record");
  }
}
console.log(JSON.stringify({contractVersion:1,records:result.records.length,
  provenance:true,vaultModified:false}));
