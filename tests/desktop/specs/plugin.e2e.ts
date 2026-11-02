import {browser,expect} from "@wdio/globals";
import {mkdirSync} from "node:fs";
import {resolve} from "node:path";
const fixture={schemaVersion:1,dataset:"entities",projectId:"desktop-generic",records:[
  {projectId:"desktop-generic",key:"record:one",type:"lab-sample",title:"Independent research sample",attributes:{measurement:2},category:"unassessed",score:50,confidence:0.4,reasons:["No user rules configured"],review:"pending",updatedAt:"2026-10-24T00:00:00Z",observationCount:1,provenance:{mentions:[{connectionId:"local-fixture",itemId:"one",evidence:[]}],reviews:[],assessmentHistory:[],mentionsTruncated:false}},
  {projectId:"desktop-generic",key:"record:two",type:"catalog-entry",title:"Public catalog sample",url:"https://example.org/catalog",attributes:{description:"General data"},category:"candidate",score:65,confidence:0.6,reasons:["Independent fixture"],review:"approved",updatedAt:"2026-10-24T00:00:00Z",observationCount:1}
]};
const click=async(name:string)=>{const button=browser.$("//button[normalize-space()='"+name+"']");await button.waitForClickable({timeout:25000});await button.click();};
const snapshot=()=>browser.executeObsidian(async({app})=>{const contents:Record<string,string>={};for(const file of app.vault.getFiles().sort((a,b)=>a.path.localeCompare(b.path)))contents[file.path]=await app.vault.read(file);return contents;});
const overview=async()=>{if(await browser.$(".ss-popover").isExisting())await browser.keys("Escape");await browser.$(".ss-status").click();await browser.$(".ss-popover .ss-title").waitForDisplayed();};
const review=async()=>{await overview();await click("Review candidates");await browser.$(".ss-record").waitForDisplayed();};
const tools=async()=>{await review();await browser.$(".ss-review-tools summary").click();};
const importFixture=async(value:unknown=fixture)=>{await overview();await click("Import findings");const input=browser.$(".modal-container textarea");await input.waitForDisplayed();await input.setValue(JSON.stringify(value));await click("Import without writing notes");};
const screenshots=resolve("tests/desktop/artifacts");let original:Record<string,string>;
describe("Source Scraper status popover in isolated Obsidian",()=>{
  it("starts with an accessible status indicator and no automatic pane or collection",async()=>{
    original=await snapshot();await browser.$(".ss-status").waitForDisplayed();expect(await browser.$(".ss-popover").isExisting()).toBe(false);
    expect(await browser.executeObsidian(({app})=>app.workspace.getLeavesOfType("source-scraper-view").length)).toBe(0);
    await expect(browser.$(".ss-status")).toHaveAttribute("role","button");await expect(browser.$(".ss-status")).toHaveText("Source Scraper");
    await expect(browser.$(".ss-status")).toHaveAttribute("aria-label",expect.stringContaining("Source Scraper"));expect(await snapshot()).toEqual(original);
  });
  it("follows ChatGPT when its high-order status item loads later",async()=>{
    await browser.execute(()=>{const parent=document.querySelector(".ss-status")!.parentElement!,chat=document.createElement("div");chat.className="status-bar-item cmt-status";chat.textContent="ChatGPT: Ready";chat.style.order="1000";parent.appendChild(chat);});
    await browser.waitUntil(()=>browser.execute(()=>{const chat=document.querySelector(".cmt-status")!,source=document.querySelector(".ss-status")!;return chat.nextElementSibling===source&&chat.getBoundingClientRect().right<=source.getBoundingClientRect().left+1;}));
  });
  it("toggles, closes on Escape/outside click and restores keyboard focus",async()=>{
    await overview();await expect(browser.$(".ss-status")).toHaveAttribute("aria-expanded","true");expect(await browser.$(".ss-popover").getText()).toContain("Nothing runs automatically");
    await browser.keys("Escape");expect(await browser.$(".ss-popover").isExisting()).toBe(false);expect(await browser.execute(()=>document.activeElement===document.querySelector(".ss-status"))).toBe(true);
    await browser.keys("Enter");await browser.$(".ss-popover").waitForDisplayed();await browser.$(".ss-status").click();expect(await browser.$(".ss-popover").isExisting()).toBe(false);
    await browser.executeObsidianCommand("source-scraper:open-panel");await browser.$(".ss-popover").waitForDisplayed();await browser.$(".workspace-tab-header-container").click();expect(await browser.$(".ss-popover").isExisting()).toBe(false);expect(await snapshot()).toEqual(original);
  });
  it("does not rewrite the idle panel on each heartbeat",async()=>{
    await overview();
    const mutations=await browser.executeAsync((done)=>{
      const root=document.querySelector(".ss-popover")!;let count=0;
      const observer=new MutationObserver(records=>{count+=records.length;});
      observer.observe(root,{subtree:true,attributes:true,childList:true,characterData:true});
      setTimeout(()=>{observer.disconnect();done(count);},2200);
    });
    expect(mutations).toBe(0);await browser.keys("Escape");
  });
  it("imports without reopening the panel or offering note writes",async()=>{
    await importFixture();await browser.waitUntil(async()=>!(await browser.$(".modal-container").isExisting()));expect(await browser.$(".ss-popover").isExisting()).toBe(false);
    await expect(browser.$(".ss-status")).toHaveText("Source Scraper");await review();expect((await browser.$$(".ss-record")).length).toBe(2);
    expect(await browser.$(".ss-panel-footer").getText()).toContain("Only ChatGPT writes notes");expect(await browser.$("//button[normalize-space()='Create new notes only']").isExisting()).toBe(false);expect(await snapshot()).toEqual(original);
  });
  it("keeps technical checks folded while source review leads the overview",async()=>{
    await overview();expect(await browser.$(".ss-connection").getAttribute("open")).toBeNull();
    expect(await browser.$(".ss-checks").isDisplayed()).toBe(false);
    await expect(browser.$(".ss-title")).toHaveText("2 candidates to review");
    expect(await browser.$(".ss-panel-footer").getText()).toContain("Only ChatGPT writes notes");
    await browser.$(".ss-connection summary").click();await expect(browser.$(".ss-checks")).toBeDisplayed();
    expect(await browser.$(".ss-checks").getText()).toContain("Local engine");await browser.keys("Escape");await review();
  });
  it("keeps Source Scraper at the same fixed width as the queue grows, with counts inside the panel",async()=>{
    await browser.keys("Escape");const width=await browser.execute(()=>document.querySelector(".ss-status")!.getBoundingClientRect().width);
    await browser.executeObsidian(({plugins},data)=>{(plugins as any).sourceScraper.setImported({...data,records:Array.from({length:256},(_,i)=>({...data.records[0],key:"compact-test-"+i}))});},fixture);
    await expect(browser.$(".ss-status")).toHaveText("Source Scraper");
    expect(await browser.execute(()=>document.querySelector(".ss-status")!.getBoundingClientRect().width)).toBe(width);expect(width).toBeLessThanOrEqual(120);
    await overview();await expect(browser.$(".ss-title")).toHaveText("256 candidates to review");
    await browser.executeObsidian(({plugins},data)=>{(plugins as any).sourceScraper.setImported(data);},fixture);
    await expect(browser.$(".ss-title")).toHaveText("2 candidates to review");
    await click("Review candidates");expect(await snapshot()).toEqual(original);
  });
  it("previews selected Markdown without saving or creating files",async()=>{
    await browser.$(".ss-record input[type=checkbox]").click();expect(await browser.$(".ss-record input[type=checkbox]").isFocused()).toBe(true);await click("Preview selected drafts");const folder=browser.$(".modal-container input[type=text]");await folder.waitForDisplayed();await folder.setValue("Draft Only");
    await expect(browser.$(".modal-container .ss-preview")).toHaveText(expect.stringContaining("desktop-generic"));expect(await browser.$(".modal-container").getText()).toContain("this plugin cannot create or change notes");expect(await snapshot()).toEqual(original);await browser.keys("Escape");
  });
  it("reimports and inspects evidence without touching notes",async()=>{
    await importFixture();await review();expect(await browser.$(".ss-count").getText()).toContain("Selected: 0");await click("View evidence");expect(await browser.$(".modal-container").getText()).toContain("No user rules configured");expect(await snapshot()).toEqual(original);await browser.keys("Escape");
  });
  it("keeps advanced project configuration behind a disclosure",async()=>{
    await tools();await click("Project JSON editor");await click("Validate project JSON");expect(await browser.$(".modal-container").getText()).toContain("Valid basic project structure");expect(await browser.$("//button[normalize-space()='Create new project file']").isExisting()).toBe(false);expect(await snapshot()).toEqual(original);await browser.keys("Escape");
  });
  it("masks local session fields and clears them on close without contacting X",async()=>{
    await overview();await browser.$(".ss-connection summary").click();await click("Connect X locally");const modal=browser.$(".modal-container");await modal.waitForDisplayed();expect(await modal.getText()).toContain("Local grant: disabled");expect(await modal.getText()).toContain("No commercial API key");expect(await modal.getText()).toContain("not saved in settings or notes");
    const passwords=await browser.$$(".ss-x-setup input[type=password]");expect(passwords.length).toBe(2);await passwords[0].setValue("synthetic-not-real-session");await browser.keys("Escape");await overview();await browser.$(".ss-connection summary").click();await click("Connect X locally");expect(await browser.$(".ss-x-setup input[type=password]").getValue()).toBe("");expect(await snapshot()).toEqual(original);await browser.keys("Escape");
  });
  it("never persists an in-memory session into preferences",async()=>{
    const result=await browser.executeObsidian(async({plugins})=>{const plugin=(plugins as any).sourceScraper;await plugin.useLocalSession({accountSession:"fixture-memory-auth",csrf:"fixture-memory-csrf"});const data=JSON.stringify(await plugin.loadData()),loaded=plugin.localSession()?.accountSession==="fixture-memory-auth";await plugin.forgetLocalSession();return {data,loaded,cleared:plugin.localSession()===undefined};});
    expect(result.loaded&&result.cleared).toBe(true);expect(result.data).not.toContain("fixture-memory");expect(await snapshot()).toEqual(original);
  });
  it("rejects incompatible imports and retains the old candidate queue",async()=>{
    await importFixture({...fixture,schemaVersion:2});expect(await snapshot()).toEqual(original);await browser.keys("Escape");await expect(browser.$(".ss-status")).toHaveText("Source Scraper");
  });
  it("retains keyboard focus when filtering multiple characters",async()=>{
    await review();await browser.$("input[placeholder='Search sources']").setValue("Independent");await browser.waitUntil(async()=>(await browser.$$(".ss-record")).length===1);expect(await browser.$(".ss-record").getText()).toContain("Independent research sample");expect(await browser.$("input[placeholder='Search sources']").isFocused()).toBe(true);await browser.keys(["Control","a"]);await browser.keys("Backspace");await browser.waitUntil(async()=>(await browser.$$(".ss-record")).length===2);expect(await snapshot()).toEqual(original);await browser.keys("Escape");
  });
  it("runs and cancels explicitly, prevents duplicate submission and stages completed results while closed (simulated provider)",async()=>{
    await browser.executeObsidian(({plugins,require},data)=>{
      const p=(plugins as any).sourceScraper;
      const previous={provider:p.provider,connect:p.connectMcp,projects:p.projectsForPanel,settings:p.settings};
      let state="cancelled",runs=0;
      p.settings={...p.settings,cliPath:require("node:process").execPath,configPath:"isolated-ui-project"};
      p.projectsForPanel=()=>[{id:"desktop-generic",name:"Desktop test project",isX:false,minimumScore:0}];
      p.connectMcp=()=>{};
      p.provider={localProjects:()=>[{id:"desktop-generic",configPath:"isolated-ui-project"}],activity:()=>({running:state==="running",jobId:"ui-job"}),execute:async(name:string)=>{
        if(name==="source_scraper_run_project"){runs++;state="running";return {id:"ui-job"};}
        if(name==="source_scraper_get_run_status")return {state,projectId:"desktop-generic"};
        if(name==="source_scraper_cancel_run"){state="cancelled";return {};}
        if(name==="source_scraper_list_findings")return data;
        if(name==="source_scraper_stage_findings"){p.setImported(data);return {};}
        throw Error("Unexpected simulated request");
      }};
      p.__desktopRun={finish:()=>{state="succeeded";},count:()=>runs,restore:()=>{p.provider=previous.provider;p.connectMcp=previous.connect;p.projectsForPanel=previous.projects;p.settings=previous.settings;p.uiError="";p.uiMessage="";p.updateStatus();}};
      p.updateStatus();
    },fixture);
    try{
      await overview();await click("Collect sources");
      await browser.executeObsidian(async({plugins})=>{await (plugins as any).sourceScraper.collectSelected();});
      expect(await browser.executeObsidian(({plugins})=>(plugins as any).sourceScraper.__desktopRun.count())).toBe(1);
      await click("Stop collection");await browser.waitUntil(async()=>(await browser.$(".ss-title").getText()).includes("needs attention"));
      await click("Collect sources");await browser.keys("Escape");
      await browser.executeObsidian(({plugins})=>{(plugins as any).sourceScraper.__desktopRun.finish();});
      await browser.waitUntil(()=>browser.executeObsidian(({plugins})=>{const p=(plugins as any).sourceScraper;return !p.uiJobId&&!p.isCollecting();}));
      expect(await browser.$(".ss-popover").isExisting()).toBe(false);
      expect(await browser.executeObsidian(({plugins})=>(plugins as any).sourceScraper.__desktopRun.count())).toBe(2);
    }finally{await browser.executeObsidian(({plugins})=>{const p=(plugins as any).sourceScraper;p.__desktopRun.restore();delete p.__desktopRun;});}
    expect(await snapshot()).toEqual(original);
  });
  it("captures native light/dark views and bounds a narrow review inside the viewport",async()=>{
    mkdirSync(screenshots,{recursive:true});await browser.waitUntil(async()=>!(await browser.$(".notice").isExisting()),{timeout:15000});await browser.sendCommand("Emulation.setDeviceMetricsOverride",{width:1100,height:900,deviceScaleFactor:1,mobile:false});await overview();await browser.execute(()=>{document.body.classList.remove("theme-light");document.body.classList.add("theme-dark");});
    expect(await browser.execute(()=>document.querySelector(".ss-popover")!.getBoundingClientRect().height)).toBeLessThan(600);
    await browser.saveScreenshot(resolve(screenshots,"overview-dark.png"));
    await review();expect((await browser.$$(".ss-record")).length).toBe(2);await browser.execute(()=>{(document.querySelector(".ss-popover") as HTMLElement).focus();});await browser.saveScreenshot(resolve(screenshots,"review-dark.png"));await overview();
    await browser.execute(()=>{document.body.classList.remove("theme-dark");document.body.classList.add("theme-light");});await browser.saveScreenshot(resolve(screenshots,"overview-light.png"));await browser.sendCommand("Emulation.setDeviceMetricsOverride",{width:540,height:640,deviceScaleFactor:1,mobile:false});await review();
    const b=await browser.execute(()=>{const root=document.querySelector(".ss-popover")!,r=root.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:root.scrollWidth>root.clientWidth};});expect(b.left).toBeGreaterThanOrEqual(11);expect(b.top).toBeGreaterThanOrEqual(11);expect(b.right).toBeLessThanOrEqual(b.width-11);expect(b.bottom).toBeLessThanOrEqual(b.height-11);expect(b.overflow).toBe(false);await browser.saveScreenshot(resolve(screenshots,"review-narrow.png"));
    await browser.executeObsidian(({plugins})=>{const p=(plugins as any).sourceScraper;p.imported.records[0].title="Independent source with an extremely long resource title ".repeat(12);p.refresh();});
    expect(await browser.execute(()=>{const body=document.querySelector(".ss-popover-body")!;return body.scrollWidth<=body.clientWidth;})).toBe(true);
    await browser.keys("Escape");await browser.sendCommand("Emulation.setDeviceMetricsOverride",{width:1100,height:900,deviceScaleFactor:1,mobile:false});expect(await snapshot()).toEqual(original);
  });
  it("stages findings passively and cleans up the popover and status item on unload",async()=>{
    await browser.executeObsidian(({plugins},data)=>{(plugins as any).sourceScraper.setImported(data);},fixture);expect(await browser.$(".ss-popover").isExisting()).toBe(false);await overview();await browser.executeObsidian(async({app})=>{await (app as any).plugins.disablePlugin("source-scraper");});expect(await browser.$(".ss-popover").isExisting()).toBe(false);expect(await browser.$(".ss-status").isExisting()).toBe(false);expect(await snapshot()).toEqual(original);
  });
});
