export const UI_POLICY="ui-resources-v1" as const;
export const UI_TERMS=["ui","ux","design","component","typography","tokens","interface","css","react","figma","skill","animation","motion"];
export const LOCAL_CHECKS=["uiFocus","reusableOutput","freeAccess","documentation","automatedChecks","examples","activeSource","suitablePost"] as const;
export type LocalCheckName=typeof LOCAL_CHECKS[number];
export interface LocalResourceCheck {
 policy:typeof UI_POLICY;fingerprint:string;eligible:boolean;postSuitable:boolean;
 checks:Record<LocalCheckName,boolean>;reasons:string[];evidence:Array<{url:string;quote:string}>;
 checkedAt:string;expiresAt:string;
 relatedResources?:string[];
}
export interface PublicResourceEvidence {
 version:1;url:string;checkedAt:string;status:"checked"|"pending";reason?:string;retryAfterSeconds?:number;
 repository?:{url:string;name:string;description:string;topics:string[];license:string;openSource:boolean;archived:boolean;disabled:boolean;homepage:string};
 rootEntries?:string[];readme?:string;
 package?:{name:string;description:string;main:string;module:string;exports:boolean;bin:boolean;workspaces:boolean;testScript:string};
 evidence:Array<{url:string;quote:string}>;
}
const ui=/\b(?:ui|ux|css|typography|design[ -]tokens?|design[ -]system|user[ -]interface|component[ -]library|ui[ -]components?)\b/i;
/** Retrieval priority only; this function never authorizes feedback. */
export function uiCandidate(entity:{title:string;attributes:Record<string,unknown>}){return /\b(?:ui|ux|css|design|skills?|frontend|components?|typography|tokens?|interface|react|figma|animation|motion)\b/i.test(entity.title+" "+String(entity.attributes.description??"")+" "+String(entity.attributes.discoveryText??""));}
/** Deterministic structural evidence. No aesthetic score, human decision or AI record. */
export function checkUiResource(entity:{attributes:Record<string,unknown>},fingerprint:string,proof:PublicResourceEvidence,now=Date.now()):LocalResourceCheck{
 const repo=proof.repository,p=proof.package,readme=proof.readme??"",entries=proof.rootEntries??[];
 const scope=[repo?.description,p?.description,readme.slice(0,3000)].join(" ");
 const output=Boolean(p&&(p.main||p.module||p.exports||p.bin||p.workspaces))||entries.some(s=>/^(?:skills?|SKILL\.md)$/.test(s));
 const broad=/\b(?:libraries|library|toolkit|framework|design system|components|design tokens|skills|editor|export|generator|icons|fonts|typography)\b/i.test(scope)&&!/(?:\b(?:single|one|tiny|small)\s+(?:react\s+)?(?:component|effect|animation|indicator|demo)\b|voice indicator|text transition)/i.test([repo?.description,p?.description].join(" "));
 const post=String(entity.attributes.discoveryText??""),name=repo?.name.split("/").at(-1)??"";
 const checks:Record<LocalCheckName,boolean>={
  uiFocus:Boolean(repo&&(ui.test(repo.description)||repo.topics.some(t=>ui.test(t))||repo.topics.includes("design")&&/\b(?:ui|frontend|user interface|web design)\b/i.test(readme))),
  reusableOutput:output&&broad,
  freeAccess:repo?.openSource===true&&Boolean(repo.license),
  documentation:/^#{1,4}\s/m.test(readme)&&/```/.test(readme)&&/\b(?:installation|install|usage|getting started|quick start|how to use|instala\S*|uso)\b/i.test(readme),
  automatedChecks:Boolean(p&&/(?:\b(?:vitest|jest|playwright|pytest|mocha|ava|bun test|node\s+(?:--[\w-]+\s+)*--test|cargo test)\b|\bnode\s+[\w./-]*(?:test|check)[\w./-]*\.(?:mjs|cjs|js|ts)\b|\b(?:turbo|nx|npm|pnpm|yarn)\b[^;]*\btest\b)/.test(p.testScript)&&!/(?:no test specified|echo\s+["']?test)/i.test(p.testScript)&&entries.some(s=>/^(?:tests?|__tests__|packages)$/.test(s))),
  examples:/\b(?:examples?|demo|storybook|screenshots?|preview)\b/i.test(readme)&&/(?:!\[[^\]]*\]\(|https:\/\/)/.test(readme),
  activeSource:Boolean(repo&&!repo.archived&&!repo.disabled),
  suitablePost:post.length>0&&(ui.test(post)||name.length>=4&&post.toLowerCase().includes(name.toLowerCase()))&&!/(?:#ad\b|\bsponsored\b|\baffiliate\b|\bgiveaway\b|\bsorteo\b|\bairdrop\b)/i.test(post)
 };
 const eligible=proof.status==="checked"&&LOCAL_CHECKS.every(k=>checks[k]);
 const reasons=LOCAL_CHECKS.filter(k=>!checks[k]).map(k=>`Needs verification: ${k}`);if(proof.reason)reasons.unshift(proof.reason);
 if(eligible)reasons.push("Local UI resource policy passed: reusable output, documented usage, automated checks, examples and open-source access. Aesthetic quality is not certified.");
 const relatedResources=[...new Set([proof.url,repo?.url,repo?.homepage].filter((url):url is string=>typeof url==="string"&&/^https?:\/\//.test(url)))];
 return {policy:UI_POLICY,fingerprint,eligible,postSuitable:eligible&&checks.suitablePost,checks,reasons,evidence:proof.evidence.slice(0,12),relatedResources,checkedAt:new Date(now).toISOString(),expiresAt:new Date(now+(eligible?86400000:(proof.retryAfterSeconds??3600)*1000)).toISOString()};
}
