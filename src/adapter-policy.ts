import type {ProjectManifest} from "./project-manifest.ts";
export const hasXSource=(project:Pick<ProjectManifest,"sources">)=>project.sources.some(s=>s.adapter==="x-for-you-local");
export const isXOnlyProject=(project:Pick<ProjectManifest,"sources">)=>project.sources.length>0&&project.sources.every(s=>s.adapter==="x-for-you-local");
/** X effects require retained provenance from the actual X connection, never an attribute alone. */
export function xPostContext(project:ProjectManifest,entity:{attributes:Record<string,unknown>},mentions:Record<string,unknown>[],requestedPostId?:string){
 const postUrl=entity.attributes.discoveryPost;
 const match=typeof postUrl==="string"?/^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/(\d+)$/.exec(postUrl):null;
 if(!match||requestedPostId!==undefined&&requestedPostId!==match[1])return undefined;
 const source=project.sources.find(source=>source.adapter==="x-for-you-local"&&typeof source.config.accountId==="string"&&/^\d{1,30}$/.test(source.config.accountId)&&mentions.some(m=>m.active===true&&m.connectionId===source.id&&m.itemId===match[1]&&m.url===postUrl));
 return source?{postId:match[1],postUrl:postUrl as string,accountId:source.config.accountId as string}:undefined;
}
