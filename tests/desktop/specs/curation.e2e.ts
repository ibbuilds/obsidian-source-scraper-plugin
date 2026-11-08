import {browser,expect} from "@wdio/globals";import {resolve} from "node:path";import {mkdirSync} from "node:fs";
const click=async(label:string)=>{const e=browser.$('//button[normalize-space()="'+label+'"]');await e.waitForClickable();await e.click();};
describe("Category selection and batched evidence in native Obsidian",()=>{
 before(async()=>{mkdirSync(resolve("artifacts"),{recursive:true});await browser.executeObsidian(({plugins})=>{
  const p=(plugins as any).sourceScraper;p.closePopover();p.__qualityBefore={settings:p.settings,provider:p.provider,review:p.review,panel:p.panelSnapshot,ready:p.resourceInboxReady,query:p.queryResourceInbox,project:p.resourceInboxProject,profile:p.feedbackProfile,connect:p.connectMcp};
  const category={id:"ux-research",label:"UX research",referenceSections:["UX Research"],criteria:[{id:"method",label:"Credible research method and evidence with clear limitations"},{id:"actionable",label:"Actionable guidance for a real UX design decision"}]};
  const context={policy:{version:1,maxAgeDays:30,categories:[category]},profileHash:"b".repeat(64),baseline:{hash:"c".repeat(64),notes:[],links:[{url:"https://reference.example/one",label:"Research one",section:"UX Research"},{url:"https://reference.example/two",label:"Research two",section:"UX Research"}]}};
  const rows=["Research guidance","Frontend component library"].map((title,i)=>({projectId:"quality-fixture",key:"quality-"+i,type:"web-resource",title,url:"https://candidate.example/"+i,attributes:{description:"A useful design or frontend resource to inspect"},category:"resource",score:50,confidence:.5,reasons:[],review:"pending",updatedAt:"2026-11-07",observationCount:1,revision:"revision-"+i,resourceQuality:{state:"pending",category:"",reason:"Not evaluated"}}));
  p.__quality={rows,calls:[],context};p.review=undefined;p.feedbackProfile=()=>({version:1,includeTerms:[],reuseTerms:[],excludeTerms:[],blockedPostTerms:[],requiredChecks:[],curation:context.policy});p.resourceInboxReady=()=>true;p.resourceInboxProject=()=>"quality-fixture";p.connectMcp=()=>{};
  p.panelSnapshot=()=>({engine:true,mcp:true,python:false,session:false,xAllowed:false,running:false,projects:[{id:"quality-fixture",name:"Design + frontend",isX:false,minimumScore:0}],projectId:"quality-fixture",findings:rows.length,findingProject:"Design + frontend",exampleFindings:false});
  p.queryResourceInbox=async(args:any)=>{const records=args.quality==="qualified"?[]:rows;return {selectionId:"quality-selection",total:records.length,records};};
  p.provider={cycle:{snapshot:()=>({state:"stopped"})},activity:()=>({running:false}),memory:{actions:()=>[],listRejected:()=>[]},curationContext:async()=>context,inspectResources:async(_id:string,keys:string[])=>({records:keys.map(key=>({key,entity:rows.find(e=>e.key===key),fingerprint:"a".repeat(64)}))}),qualifyResources:async(args:any,origin:string)=>{p.__quality.calls.push({args,origin});return {saved:args.items.length};}};
 });});
 after(async()=>{await browser.executeObsidian(({plugins})=>{const p=(plugins as any).sourceScraper,b=p.__qualityBefore;p.closePopover();p.settings=b.settings;p.provider=b.provider;p.review=b.review;p.panelSnapshot=b.panel;p.resourceInboxReady=b.ready;p.queryResourceInbox=b.query;p.resourceInboxProject=b.project;p.feedbackProfile=b.profile;p.connectMcp=b.connect;});});
 it("opens an honest empty qualified view and keeps only admitted matches accessible",async()=>{
  await browser.executeObsidian(async({plugins})=>{await (plugins as any).sourceScraper.openView(true);});
  await browser.$(".ss-inbox").waitForDisplayed();await browser.waitUntil(async()=>(await browser.$(".ss-count").getText()).includes("0 qualified"));
  expect(await browser.$('select[aria-label="Resource view"]').getValue()).toBe("qualified");expect(await browser.$(".ss-empty-results").getText()).toContain("No qualified sources");
  await browser.$('select[aria-label="Resource view"]').selectByAttribute("value","all");await browser.waitUntil(async()=>(await browser.$$(".ss-record")).length===2);
  await browser.$('input[aria-label="Select visible resources"]').click();await click("Review quality");await browser.$(".ss-quality-review").waitForDisplayed();expect((await browser.$$(".ss-quality-card")).length).toBe(2);
 });
 it("records distinct choices in one batch without choosing for all resources or approving them",async()=>{
  const cards=await browser.$$(".ss-quality-card");
  for(let i=0;i<cards.length;i++){await cards[i].$("summary").click();const decision=cards[i].$('select:not(.is-measuring):has(option[value="unchanged"])');await decision.selectByAttribute("value",i?"excluded":"pending");await cards[i].$("textarea").setValue(i?"A metered core does not meet our free-use requirements.":"Access and research evidence still need to be inspected.");}
  expect(await browser.$(".ss-quality-review").getText()).not.toContain("Approve all");await click("Save reviews");await browser.$(".ss-inbox").waitForDisplayed();
  const calls=await browser.executeObsidian(({plugins})=>(plugins as any).sourceScraper.__quality.calls);expect(calls.length).toBe(1);expect(calls[0].origin).toBe("user-interface");expect(calls[0].args.items.map((i:any)=>i.review.decision)).toEqual(["pending","excluded"]);
 });
 it("keeps forms and actions inside the existing dialog at desktop and narrow widths",async()=>{
  const pageBox=browser.$('input[aria-label="Select visible resources"]');if(!await pageBox.isSelected())await pageBox.click();await click("Review quality");await browser.$(".ss-quality-review").waitForDisplayed();await browser.$(".ss-quality-card summary").click();
  for(const [width,height] of [[1440,900],[390,480]]){await browser.sendCommand("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:false});await browser.executeAsync(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done(null))));
   const geometry=await browser.execute(()=>{const root=document.querySelector<HTMLElement>(".ss-dialog")!,body=root.querySelector<HTMLElement>(".ss-dialog-body")!,footer=root.querySelector<HTMLElement>(".ss-dialog-footer")!,r=root.getBoundingClientRect(),f=footer.getBoundingClientRect();return {overflow:root.scrollWidth>root.clientWidth+1||body.scrollWidth>body.clientWidth+1,width:r.width,height:r.height,footerInside:f.bottom<=r.bottom+1};});
   expect(geometry.overflow).toBe(false);expect(geometry.footerInside).toBe(true);expect(geometry.width).toBeLessThanOrEqual(width-20);expect(geometry.height).toBeLessThanOrEqual(height-20);
   await browser.$(".ss-dialog").saveScreenshot(resolve("artifacts","quality-review-"+width+".png"));
  }
  await browser.sendCommand("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});await click("Close");
 });
});
