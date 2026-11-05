import {createHash} from "node:crypto";
import {dirname,resolve} from "node:path";
import type {ProjectManifest} from "./project-manifest.ts";
export function sourceProfile(project:ProjectManifest,configPath:string):ProjectManifest{
 const next=structuredClone(project);
 for(const source of next.sources)if(["json-file","json-snapshot"].includes(source.adapter)&&typeof source.config.path==="string")source.config.path=resolve(dirname(configPath),source.config.path);
 next.id="source-profile-"+createHash("sha256").update(JSON.stringify(next)).digest("hex").slice(0,12);return next;
}
