import {parseProjectManifest,type ProjectManifest} from "./project-manifest.ts";
import type {XLocalSession} from "./cli-bridge.ts";

export function xFeedReadiness(session?:XLocalSession){return {
  csrfConfigured:Boolean(session?.csrf||process.env.SOURCE_SCRAPER_X_CSRF),
  accountSessionConfigured:Boolean(session?.accountSession||process.env.SOURCE_SCRAPER_X_ACCOUNT_SESSION)
};}
export function validateLocalSession(accountSession:string,csrf:string):XLocalSession{
  if([accountSession,csrf].some(s=>!s||s.length>8192||/[^\x21-\x7e]/.test(s)))throw Error("Enter both local session values without spaces");
  return {accountSession,csrf};
}
/** No credential, endpoint, command or vault path is accepted by this setup contract. */
export function buildXFeedProject(accountId:string,include:string,exclude:string,minimumScore:number,pagesPerRun:number):ProjectManifest{
  if(!/^\d{1,30}$/.test(accountId))throw Error("Enter the connected account's numeric X user ID");
  if(!Number.isInteger(pagesPerRun)||pagesPerRun<1||pagesPerRun>10)throw Error("Use 1–10 provider pages per run");
  const terms=(s:string)=>s.split(/[,\n]/).map(v=>v.trim()).filter(Boolean);
  return parseProjectManifest(JSON.stringify({id:"x-for-you-resources",name:"X For You resource discovery",
    sources:[{id:"x-for-you",adapter:"x-for-you-local",config:{accountId,pagesPerRun}}],
    pipeline:["x-discovery","public-metadata"],evaluator:"keyword",
    policy:{includeKeywords:terms(include),excludeKeywords:terms(exclude),minimumScore},outputs:[]}));
}
