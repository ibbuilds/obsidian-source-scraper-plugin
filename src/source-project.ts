import {createHash} from "node:crypto";import {checkedUrl} from "./contracts.ts";import {parseProjectManifest} from "./project-manifest.ts";
export function buildPublicSource(adapter:string,input:string,name:string){
 if(!["rss","public-product"].includes(adapter))throw Error("Choose a supported public source type");
 const url=checkedUrl(input.trim());if(!url)throw Error("Enter a public source URL");if(adapter==="public-product"&&new URL(url).protocol!=="https:")throw Error("Product pages require an HTTPS URL");
 const source={id:"public-source",adapter,config:adapter==="rss"?{url}:{urls:[url]}};
 const id="source-"+createHash("sha256").update(JSON.stringify(source)).digest("hex").slice(0,12);
 return parseProjectManifest(JSON.stringify({id,name:name.trim()||new URL(url).hostname,sources:[source],pipeline:["extract-links"],evaluator:"keyword",policy:{includeKeywords:[],excludeKeywords:[],minimumScore:0},filters:{version:1,entity:{requiredFields:["url"]}},outputs:[]}));
}
