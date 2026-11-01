import {parseProjectManifest,type ProjectManifest} from "./project-manifest.ts";

export function xFeedReadiness(){return {
  apiKeyConfigured:Boolean(process.env.SOURCE_SCRAPER_GETXAPI_API_KEY),
  accountSessionConfigured:Boolean(process.env.SOURCE_SCRAPER_X_ACCOUNT_SESSION)
};}
/** No credential, endpoint, command or vault path is accepted by this setup contract. */
export function buildXFeedProject(accountId:string,include:string,exclude:string,minimumScore:number,pagesPerRun:number):ProjectManifest{
  if(!/^\d{1,30}$/.test(accountId))throw Error("Enter the connected account's numeric X user ID");
  if(!Number.isInteger(pagesPerRun)||pagesPerRun<1||pagesPerRun>10)throw Error("Use 1–10 provider pages per run");
  const terms=(s:string)=>s.split(/[,\n]/).map(v=>v.trim()).filter(Boolean);
  return parseProjectManifest(JSON.stringify({id:"x-for-you-resources",name:"X For You resource discovery",
    sources:[{id:"x-for-you",adapter:"x-for-you",config:{accountId,pagesPerRun}}],
    pipeline:["x-discovery","public-metadata"],evaluator:"keyword",
    policy:{includeKeywords:terms(include),excludeKeywords:terms(exclude),minimumScore},outputs:[]}));
}
