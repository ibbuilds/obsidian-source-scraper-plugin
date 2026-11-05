import {browser,expect} from "@wdio/globals";
import {mkdirSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
const fixture={schemaVersion:1,dataset:"entities",projectId:"desktop-generic",records:[
  {projectId:"desktop-generic",key:"record:one",type:"lab-sample",title:"Independent research sample",attributes:{measurement:2},category:"unassessed",score:50,confidence:0.4,reasons:["No user rules configured"],review:"pending",updatedAt:"2026-10-24T00:00:00Z",observationCount:1,provenance:{mentions:[{connectionId:"local-fixture",itemId:"one",evidence:[]}],reviews:[],assessmentHistory:[],mentionsTruncated:false}},
  {projectId:"desktop-generic",key:"record:two",type:"catalog-entry",title:"Public catalog sample",url:"https://example.org/catalog",attributes:{description:"General data"},category:"candidate",score:65,confidence:0.6,reasons:["Independent fixture"],review:"approved",updatedAt:"2026-10-24T00:00:00Z",observationCount:1}
]};
const click=async(name:string)=>{const button=browser.$("//button[normalize-space()='"+name+"']");await button.waitForClickable({timeout:25000});await button.click();};
const snapshot=()=>browser.executeObsidian(async({app})=>{const contents:Record<string,string>={};for(const file of app.vault.getFiles().sort((a,b)=>a.path.localeCompare(b.path)))contents[file.path]=await app.vault.read(file);return contents;});
const overview=async()=>{if(await browser.$(".ss-popover").isExisting())await browser.keys("Escape");await browser.$(".ss-status").click();await browser.$(".ss-popover[data-screen=home]").waitForDisplayed();};
const review=async()=>{await overview();await browser.$(".ss-results-link").click();await browser.$(".ss-record").waitForDisplayed();};
const more=async()=>{await overview();await browser.$("button[aria-label='Options']").click();};
const setup=async()=>{await more();await click("Change session");await browser.$(".ss-x-setup").waitForDisplayed();};
const importFixture=async(value:unknown=fixture)=>{await more();await click("Import results");const input=browser.$(".modal-container textarea");await input.waitForDisplayed();await input.setValue(JSON.stringify(value));await click("Import");};
const screenshots=fileURLToPath(new URL("../artifacts",import.meta.url));let original:Record<string,string>;
describe("Source Scraper simple discovery journey in isolated Obsidian",()=>{
  it("starts with the readable status label and nothing opens or collects automatically",async()=>{
    original=await snapshot();await browser.$(".ss-status").waitForDisplayed();expect(await browser.$(".ss-popover").isExisting()).toBe(false);
    expect(await browser.executeObsidian(({app})=>app.workspace.getLeavesOfType("source-scraper-view").length)).toBe(0);
    await expect(browser.$(".ss-status")).toHaveText("Source Scraper");expect(await snapshot()).toEqual(original);
  });
  it("follows ChatGPT when its high-order status item loads later",async()=>{
    await browser.execute(()=>{const parent=document.querySelector(".ss-status")!.parentElement!,chat=document.createElement("div");chat.className="status-bar-item cmt-status";chat.textContent="ChatGPT: Ready";chat.style.order="1000";parent.appendChild(chat);});
    await browser.waitUntil(()=>browser.execute(()=>{const chat=document.querySelector(".cmt-status")!,source=document.querySelector(".ss-status")!;return chat.nextElementSibling===source&&chat.getBoundingClientRect().right<=source.getBoundingClientRect().left+1;}));
  });
  it("toggles, navigates with native controls, closes outside/on Escape and restores focus",async()=>{
    await overview();await expect(browser.$(".ss-status")).toHaveAttribute("aria-expanded","true");
    await browser.$(".ss-results-link").click();await expect(browser.$(".ss-popover")).toHaveAttribute("data-screen","review");
    expect(await browser.$(".ss-popover-body").getText()).toContain("No results yet");
    await browser.$("button[aria-label='Back to collection']").click();await expect(browser.$(".ss-popover")).toHaveAttribute("data-screen","home");
    await browser.execute(()=>{(document.querySelector("button[aria-label='Options']") as HTMLElement).focus();});await browser.keys("Enter");
    await expect(browser.$(".ss-popover")).toHaveAttribute("data-screen","options");await browser.$("button[aria-label=Back]").click();
    await browser.keys("Escape");expect(await browser.execute(()=>document.activeElement===document.querySelector(".ss-status"))).toBe(true);
    await browser.keys("Enter");await browser.$(".ss-popover").waitForDisplayed();await browser.$(".ss-status").click();expect(await browser.$(".ss-popover").isExisting()).toBe(false);
    await browser.executeObsidianCommand("source-scraper:open-panel");await browser.$(".workspace-tab-header-container").click();expect(await browser.$(".ss-popover").isExisting()).toBe(false);
  });
  it("keeps technical options hidden and avoids idle DOM rewrites",async()=>{
    await overview();expect(await browser.$(".ss-review-tools").isExisting()).toBe(false);expect(await browser.$(".ss-project-select").isExisting()).toBe(false);
    expect(await browser.$(".ss-panel-footer").isExisting()).toBe(false);
    const mutations=await browser.executeAsync(done=>{let count=0;const observer=new MutationObserver(records=>{count+=records.length;});observer.observe(document.querySelector(".ss-popover")!,{subtree:true,attributes:true,childList:true,characterData:true});setTimeout(()=>{observer.disconnect();done(count);},2200);});
    expect(mutations).toBe(0);await browser.keys("Escape");
  });
  it("takes an explicit import straight to results and exposes no note-writing action",async()=>{
    await importFixture();await browser.$(".ss-record").waitForDisplayed();await expect(browser.$(".ss-popover")).toHaveAttribute("data-screen","review");
    expect((await browser.$$(".ss-record")).length).toBe(2);await expect(browser.$(".ss-status")).toHaveText("Source Scraper");
    expect(await browser.$("//button[normalize-space()='Create new notes only']").isExisting()).toBe(false);expect(await snapshot()).toEqual(original);
  });
  it("keeps the status label fixed as the result count grows inside the panel",async()=>{
    const width=await browser.execute(()=>document.querySelector(".ss-status")!.getBoundingClientRect().width);
    await browser.executeObsidian(({plugins},data)=>{(plugins as any).sourceScraper.setImported({...data,records:Array.from({length:256},(_,i)=>({...data.records[0],key:"compact-"+i}))});},fixture);
    await expect(browser.$(".ss-count")).toHaveText("256 resources");await expect(browser.$(".ss-status")).toHaveText("Source Scraper");
    expect(await browser.execute(()=>document.querySelector(".ss-status")!.getBoundingClientRect().width)).toBe(width);
    await browser.executeObsidian(({plugins},data)=>{(plugins as any).sourceScraper.setImported(data);},fixture);
  });
  it("measures bounded review interactions on 4,000 records",async()=>{
    await review();
    const measured=await browser.executeObsidian(({plugins},data)=>{
      const p=(plugins as any).sourceScraper;
      p.setImported({...data,records:Array.from({length:4000},(_,i)=>({...data.records[0],key:"perf-"+i,title:"Resource "+i}))});
      const root=document.querySelector(".ss-popover-body")!;
      const originalInput=root.querySelector("input[placeholder='Filter resources']");
      const observer=new MutationObserver(()=>{});observer.observe(root,{subtree:true,childList:true});
      const searchTimes:number[]=[],selectionTimes:number[]=[];
      for(const query of ["Resource 1","Resource 2","Resource 3","Resource 4",""]){
        const input=root.querySelector<HTMLInputElement>("input[placeholder='Filter resources']")!;
        const start=performance.now();input.value=query;input.dispatchEvent(new Event("input",{bubbles:true}));searchTimes.push(performance.now()-start);
      }
      const firstCheckbox=root.querySelector(".ss-select-control");
      for(let i=0;i<20;i++){const box=root.querySelector<HTMLInputElement>(".ss-select-control")!;const start=performance.now();box.click();selectionTimes.push(performance.now()-start);}
      const changes=observer.takeRecords().length;observer.disconnect();
      const result={searchTimes,selectionTimes,childListMutations:changes,checkboxPreserved:firstCheckbox===root.querySelector(".ss-select-control"),inputPreserved:originalInput===root.querySelector("input[placeholder='Filter resources']"),visible:root.querySelectorAll(".ss-record").length};
      p.setImported(data);return result;
    },fixture);
    console.log("REVIEW_PERFORMANCE "+JSON.stringify(measured));expect(measured.visible).toBe(40);expect(measured.inputPreserved).toBe(true);expect(measured.checkboxPreserved).toBe(true);
    expect(await snapshot()).toEqual(original);
  });
  it("selects with a native checkbox, retains focus and previews drafts without saving",async()=>{
    await browser.executeObsidian(({plugins})=>{(plugins as any).sourceScraper.settings.outputFolder="";});
    await review();await browser.$(".ss-record input[type=checkbox]").click();expect(await browser.$(".ss-record input[type=checkbox]").isFocused()).toBe(true);
    await click("Preview drafts");const folder=browser.$(".modal-container input[type=text]");await folder.waitForDisplayed();
    await expect(folder).toHaveValue("Source Scraper/Imported");
    await expect(browser.$(".modal-container .ss-preview")).toHaveText(expect.stringContaining("Source Scraper/Imported/desktop-generic/"));
    expect(await snapshot()).toEqual(original);
    await folder.setValue("Draft Only");
    await expect(browser.$(".modal-container .ss-preview")).toHaveText(expect.stringContaining("desktop-generic"));expect(await browser.$(".modal-container").getText()).toContain("This panel does not write notes");expect(await snapshot()).toEqual(original);await browser.keys("Escape");
  });
  it("shows readable evidence first, with raw JSON behind a disclosure",async()=>{
    await importFixture();await browser.$(".ss-record-title").click();expect(await browser.$(".modal-container").getText()).toContain("No user rules configured");
    expect(await browser.$(".modal-container pre").isDisplayed()).toBe(false);expect(await snapshot()).toEqual(original);await browser.keys("Escape");
  });
  it("preserves advanced project tools away from the normal journey",async()=>{
    await more();await browser.$(".ss-review-tools summary").click();await click("Edit project");await click("Validate project");expect(await browser.$(".modal-container").getText()).toContain("Project valid");expect(await snapshot()).toEqual(original);await browser.keys("Escape");
  });
  it("provides local cookie instructions, masks values and clears fields on dismissal",async()=>{
    await setup();expect(await browser.$(".modal-container").getText()).toContain("No paid API is required");
    mkdirSync(screenshots,{recursive:true});await browser.$(".ss-x-setup").saveScreenshot(resolve(screenshots,"conectar-x.png"));
    const secrets=await browser.$$(".ss-x-setup input[type=password]");expect(secrets.length).toBe(2);await secrets[0].setValue("synthetic-not-real");
    await browser.$(".ss-session-help summary").click();expect(await browser.$(".ss-session-help").getText()).toContain("Application → Cookies");
    await browser.keys("Escape");await setup();expect(await browser.$(".ss-x-setup input[type=password]").getValue()).toBe("");await browser.keys("Escape");expect(await snapshot()).toEqual(original);
  });
  it("connects locally without collection, keeps secrets out of preferences and retains old filter profiles",async()=>{
    await browser.executeObsidian(({plugins,require})=>{const p=(plugins as any).sourceScraper;p.__sessionBefore={settings:p.settings,memory:p.memorySession};p.settings={...p.settings,mcpWorkspacePath:require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(),"ss-ui-local-")),mcpProjectsJson:"[]",xPythonPath:require("node:process").execPath};});
    try{
      await setup();await browser.$(".ss-x-setup input[placeholder='u=123456789']").setValue("u%3D123456");
      await browser.$("input[aria-label=auth_token]").setValue("synthetic-ui-auth");await browser.$("input[aria-label=ct0]").setValue("synthetic-ui-csrf");await click("Connect");
      await browser.$(".ss-popover[data-screen=home]").waitForDisplayed();
      const first=await browser.executeObsidian(async({plugins,require})=>{const p=(plugins as any).sourceScraper;const raw=JSON.stringify(await p.loadData());const projects=JSON.parse(p.settings.mcpProjectsJson);p.__firstManifest={path:projects[0].configPath,raw:require("node:fs").readFileSync(projects[0].configPath,"utf8")};return {raw,count:projects.length,session:!!p.localSession(),manifest:p.__firstManifest.raw};});
      expect(first.count).toBe(1);expect(first.session).toBe(true);expect(first.raw).not.toContain("synthetic-ui");expect(first.manifest).not.toContain("synthetic-ui");
      await overview();await click("Search filters");await browser.$(".ss-dialog").saveScreenshot(resolve(screenshots,"filters-dark.png"));await browser.$(".ss-filter-form textarea").setValue("rust, open source");await click("Save filters");await browser.$(".ss-popover[data-screen=home]").waitForDisplayed();
      const second=await browser.executeObsidian(({plugins,require})=>{const p=(plugins as any).sourceScraper;return {count:JSON.parse(p.settings.mcpProjectsJson).length,preserved:require("node:fs").readFileSync(p.__firstManifest.path,"utf8")===p.__firstManifest.raw};});
      expect(second.count).toBe(2);expect(second.preserved).toBe(true);
      const current=await browser.executeObsidian(({plugins,require})=>{const p=(plugins as any).sourceScraper;return {path:p.settings.configPath,raw:require("node:fs").readFileSync(p.settings.configPath,"utf8")};});
      await setup();await click("Connect");await browser.$(".ss-popover[data-screen=home]").waitForDisplayed();
      const reconnected=await browser.executeObsidian(({plugins,require})=>{const p=(plugins as any).sourceScraper;return {path:p.settings.configPath,raw:require("node:fs").readFileSync(p.settings.configPath,"utf8"),count:JSON.parse(p.settings.mcpProjectsJson).length};});
      expect(reconnected).toEqual({...current,count:2});
    }finally{await browser.executeObsidian(async({plugins})=>{const p=(plugins as any).sourceScraper;await p.sessionStore?.forgetAndCommit(async()=>{});p.memorySession=p.__sessionBefore.memory;p.settings=p.__sessionBefore.settings;await p.savePrefs();delete p.__sessionBefore;delete p.__firstManifest;});}
    await browser.keys("Escape");expect(await snapshot()).toEqual(original);
  });
  it("restores the encrypted Windows session after a genuine plugin reload",async function(){
    if(await browser.executeObsidian(({require})=>require("node:process").platform)!=="win32"){this.skip();return;}
    try{
      const result=await browser.executeObsidian(async({app,plugins})=>{
        const p=(plugins as any).sourceScraper;(globalThis as any).__ssRestartBefore={settings:{...p.settings},imported:p.imported,selected:[...p.selected]};
        await p.useLocalSession({accountSession:"synthetic-reload-auth",csrf:"synthetic-reload-csrf"});
        const manager=(app as any).plugins;await manager.disablePlugin("source-scraper");await manager.enablePlugin("source-scraper");
        const fresh=manager.plugins["source-scraper"];
        return {newInstance:fresh!==p,restored:fresh.localSession()?.accountSession==="synthetic-reload-auth",preferencesClean:!JSON.stringify(await fresh.loadData()).includes("synthetic-reload")};
      });
      expect(result).toEqual({newInstance:true,restored:true,preferencesClean:true});
    }finally{
      await browser.executeObsidian(async({app})=>{
        const p=(app as any).plugins.plugins["source-scraper"],before=(globalThis as any).__ssRestartBefore;
        if(before){await p.forgetLocalSession();p.settings=before.settings;if(before.imported)p.setImported(before.imported);p.selected=new Set(before.selected);await p.savePrefs();delete (globalThis as any).__ssRestartBefore;}
      });
    }
    expect(await snapshot()).toEqual(original);
  });
  it("rejects an incompatible import without losing previous results",async()=>{
    await importFixture({...fixture,schemaVersion:2});await browser.keys("Escape");await review();expect((await browser.$$(".ss-record")).length).toBe(2);expect(await snapshot()).toEqual(original);
  });
  it("filters and clears with the keyboard while retaining focus",async()=>{
    await review();await browser.$("input[placeholder='Filter resources']").setValue("Independent");await browser.waitUntil(async()=>(await browser.$$(".ss-record")).length===1);
    expect(await browser.$("input[placeholder='Filter resources']").isFocused()).toBe(true);await browser.keys(["Control","a"]);await browser.keys("Backspace");await browser.waitUntil(async()=>(await browser.$$(".ss-record")).length===2);
    await browser.$("input[placeholder='Filter resources']").setValue("Independent");await browser.$(".ss-search .search-input-clear-button").click();await browser.waitUntil(async()=>(await browser.$$(".ss-record")).length===2);await browser.keys("Escape");
  });
  it("starts bounded background cycles explicitly, stops and prevents duplicate submissions (simulated provider)",async()=>{
    await browser.executeObsidian(({plugins,require},data)=>{const p=(plugins as any).sourceScraper,old={provider:p.provider,connect:p.connectMcp,projects:p.projectsForPanel,settings:p.settings,memory:p.memorySession};let state="stopped",runs=0;
      p.settings={...p.settings,cliPath:require("node:process").execPath,xPythonPath:require("node:process").execPath,xProviderEnabled:"true",configPath:"isolated-ui-project"};p.memorySession={accountSession:"synthetic-auth",csrf:"synthetic-csrf"};p.projectsForPanel=()=>[{id:"desktop-generic",name:"Fixture X feed",isX:true,minimumScore:0}];p.connectMcp=()=>{};
      const snapshot=()=>({projectId:"desktop-generic",state,active:state==="running",pages:0,observations:0,reason:"Fixture bounded cycle"});
      p.provider={localProjects:()=>[],cycle:{snapshot,stop:()=>{state="stopped";}},activity:()=>({running:state==="running"}),execute:async(name:string,args:any)=>{if(name==="source_scraper_control_cycle"){if(args.action==="start"){runs++;state="running";}else state="stopped";return snapshot();}throw Error("Unexpected simulated request");}};
      p.__run={finish:()=>{state="stopped";p.setImported(data);},finishEmpty:()=>{state="stopped";p.setImported({...data,records:[]});},count:()=>runs,restore:()=>{p.provider=old.provider;p.connectMcp=old.connect;p.projectsForPanel=old.projects;p.settings=old.settings;p.memorySession=old.memory;p.uiError="";p.uiMessage="";p.updateStatus();}};p.updateStatus();},fixture);
    try{
      await overview();await click("Find resources");await browser.executeObsidian(async({plugins})=>{await (plugins as any).sourceScraper.collectSelected();});expect(await browser.executeObsidian(({plugins})=>(plugins as any).sourceScraper.__run.count())).toBe(1);
      await click("Stop cycle");await browser.waitUntil(async()=>(await browser.$(".ss-source-status").getText())==="Session loaded");
      await click("Find resources");await browser.keys("Escape");await browser.executeObsidian(({plugins})=>{(plugins as any).sourceScraper.__run.finish();});await browser.waitUntil(()=>browser.executeObsidian(({plugins})=>!(plugins as any).sourceScraper.isCollecting()));expect(await browser.$(".ss-popover").isExisting()).toBe(false);expect(await browser.executeObsidian(({plugins})=>(plugins as any).sourceScraper.__run.count())).toBe(2);
      await overview();await click("Find resources");await browser.executeObsidian(({plugins})=>{(plugins as any).sourceScraper.__run.finishEmpty();});await browser.waitUntil(()=>browser.executeObsidian(({plugins})=>!(plugins as any).sourceScraper.isCollecting()));await browser.$(".ss-results-link").click();expect(await browser.$(".ss-popover-body").getText()).toContain("No results yet");await browser.keys("Escape");
    }finally{await browser.executeObsidian(({plugins})=>{(plugins as any).sourceScraper.__run.restore();});}
    expect(await snapshot()).toEqual(original);
  });
  it("reproduces configured example results without pretending X is connected; captures compact native UI",async()=>{
    mkdirSync(screenshots,{recursive:true});await browser.waitUntil(async()=>!(await browser.$(".notice").isExisting()),{timeout:15000});
    await browser.executeObsidian(({plugins},data)=>{const p=(plugins as any).sourceScraper;p.__snapshotBefore=p.panelSnapshot;const demo={...data,projectId:"starter-project",records:Array.from({length:4},(_,i)=>({...data.records[i%2],projectId:"starter-project",key:"demo-"+i,title:["Motion","GSAP","Lucide","Radix UI"][i],url:["https://motion.dev","https://gsap.com","https://lucide.dev","https://www.radix-ui.com"][i],attributes:{description:["Animation for web interfaces","Web animation tools","SVG icon library","Accessible interface components"][i]},review:"pending"}))};p.setImported(demo);p.panelSnapshot=()=>({...p.__snapshotBefore(),engine:true,mcp:true,python:true,session:false,xAllowed:false,projects:[{id:"starter-project",name:"Source Scraper offline starter",isX:false,minimumScore:0},{id:"npm-react-ui-discovery",name:"Public tools",isX:false,minimumScore:50}],projectId:"starter-project",findings:4,findingProject:"Source Scraper offline starter",exampleFindings:true});p.updateStatus();},fixture);
    try{
      await browser.sendCommand("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:2,mobile:false});await overview();await browser.execute(()=>{document.body.classList.remove("theme-light");document.body.classList.add("theme-dark");});
      await expect(browser.$(".ss-primary")).toHaveText("Connect X");expect(await browser.$(".ss-source-status").getText()).toBe("Not connected");expect(await browser.$(".ss-project-select").isExisting()).toBe(false);
      expect(await browser.execute(()=>document.querySelector(".ss-popover")!.getBoundingClientRect().height)).toBe(500);await browser.$(".ss-popover").saveScreenshot(resolve(screenshots,"buscar-dark.png"));await browser.saveScreenshot(resolve(screenshots,"contexto-dark.png"));
      await browser.$(".ss-results-link").click();expect(await browser.$(".ss-example-note").getText()).toContain("this is not your X feed");await browser.$(".ss-record input[type=checkbox]").click();await expect(browser.$(".ss-selection-count")).toHaveText("1 selected");await browser.$(".ss-popover").saveScreenshot(resolve(screenshots,"resultados-dark.png"));
      await browser.sendCommand("Emulation.setDeviceMetricsOverride",{width:768,height:900,deviceScaleFactor:1,mobile:false});await browser.$(".ss-popover").saveScreenshot(resolve(screenshots,"resultados-tablet.png"));await browser.$("button[aria-label='Back to collection']").click();await browser.execute(()=>{document.body.classList.remove("theme-dark");document.body.classList.add("theme-light");});await browser.$(".ss-popover").saveScreenshot(resolve(screenshots,"buscar-light.png"));
      await browser.sendCommand("Emulation.setDeviceMetricsOverride",{width:390,height:600,deviceScaleFactor:1,mobile:false});await browser.$(".ss-results-link").click();
      await browser.executeAsync(done=>{requestAnimationFrame(()=>requestAnimationFrame(()=>done(null)));});
      const b=await browser.execute(()=>{const root=document.querySelector(".ss-popover")!,r=root.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:root.scrollWidth>root.clientWidth};});expect(b.left).toBeGreaterThanOrEqual(11);expect(b.top).toBeGreaterThanOrEqual(11);expect(b.right).toBeLessThanOrEqual(b.width-11);expect(b.bottom).toBeLessThanOrEqual(b.height-11);expect(b.overflow).toBe(false);await browser.$(".ss-popover").saveScreenshot(resolve(screenshots,"resultados-narrow.png"));
      await browser.executeObsidian(({plugins})=>{const p=(plugins as any).sourceScraper;p.imported.records[0].title="Resource with a very long name ".repeat(20);p.refresh();});expect(await browser.execute(()=>{const root=document.querySelector(".ss-popover-body")!;return root.scrollWidth<=root.clientWidth;})).toBe(true);
    }finally{await browser.executeObsidian(({plugins},data)=>{const p=(plugins as any).sourceScraper;p.panelSnapshot=p.__snapshotBefore;delete p.__snapshotBefore;p.setImported(data);},fixture);await browser.keys("Escape");await browser.sendCommand("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});}
    expect(await snapshot()).toEqual(original);
  });
  it("keeps dialog actions visible and fields labelled in compact, short and wide viewports",async()=>{
    mkdirSync(screenshots,{recursive:true});
    const bounds=()=>browser.execute(()=>{
      const modal=document.querySelector<HTMLElement>(".ss-dialog")!,body=modal.querySelector<HTMLElement>(".ss-dialog-body")!,footer=modal.querySelector<HTMLElement>(".ss-dialog-footer")!;
      const r=modal.getBoundingClientRect(),f=footer.getBoundingClientRect();
      const controls=Array.from(body.querySelectorAll<HTMLInputElement>("input,textarea,select"));
      return {width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight,footerInside:f.bottom<=r.bottom&&f.top>=r.top,overflow:body.scrollWidth>body.clientWidth,unnamed:controls.filter(input=>!input.getAttribute("aria-label")&&!input.getAttribute("aria-labelledby")).length,scrollable:body.scrollHeight>body.clientHeight};
    });
    for(const [width,height] of [[1440,900],[768,700],[390,480]]){
      await browser.sendCommand("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:false});
      await setup();await browser.$(".ss-session-help summary").click();
      await browser.executeAsync(done=>{requestAnimationFrame(()=>requestAnimationFrame(()=>done(null)));});
      const b=await bounds();expect(b.left).toBeGreaterThanOrEqual(11);expect(b.right).toBeLessThanOrEqual(width-11);expect(b.top).toBeGreaterThanOrEqual(11);expect(b.bottom).toBeLessThanOrEqual(height-11);expect(b.footerInside).toBe(true);expect(b.overflow).toBe(false);expect(b.unnamed).toBe(0);
      if(height===480)expect(b.scrollable).toBe(true);
      await browser.$(".ss-dialog").saveScreenshot(resolve(screenshots,"session-"+width+".png"));await browser.keys("Escape");
      await more();await click("Import results");await browser.$(".ss-dialog").waitForDisplayed();const imported=await bounds();expect(imported.footerInside).toBe(true);expect(imported.overflow).toBe(false);expect(imported.unnamed).toBe(0);await browser.$(".ss-dialog").saveScreenshot(resolve(screenshots,"import-"+width+".png"));await browser.keys("Escape");
    }
    await browser.sendCommand("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await review();await browser.$(".ss-record-title").click();await browser.$(".ss-dialog").saveScreenshot(resolve(screenshots,"detail-dark.png"));await browser.keys("Escape");
    await more();await browser.$(".ss-review-tools summary").click();await click("Draft format");await browser.$(".ss-dialog").saveScreenshot(resolve(screenshots,"mapping-dark.png"));await browser.keys("Escape");
    const mainWindow=await browser.getWindowHandle(),beforeWindows=await browser.getWindowHandles();
    await browser.executeObsidian(({app})=>{(app as any).setting.open();(app as any).setting.openTabById("source-scraper");});
    await browser.waitUntil(async()=>(await browser.$(".ss-settings").isDisplayed())||(await browser.getWindowHandles()).length>beforeWindows.length);
    const settingsWindow=(await browser.getWindowHandles()).find(id=>!beforeWindows.includes(id));
    if(settingsWindow)await browser.switchToWindow(settingsWindow);
    try{
      await browser.$(".ss-settings").waitForDisplayed();await browser.$(".ss-settings").saveScreenshot(resolve(screenshots,"settings.png"));
      for(const [width,height] of [[865,736],[768,700],[390,480]]){
        await browser.sendCommand("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:false});
        await browser.executeAsync(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done(null))));
        const geometry=await browser.execute(()=>{
          const root=document.querySelector<HTMLElement>(".ss-settings")!,r=root.getBoundingClientRect();
          const save=root.querySelector<HTMLElement>(".ss-settings-footer button")!.getBoundingClientRect();
          const body=root.querySelector<HTMLElement>(".ss-settings-body")!;
          return {inside:r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,footer:save.left>=r.left&&save.right<=r.right+1&&save.top>=r.top&&save.bottom<=r.bottom+1,overflow:root.scrollWidth>root.clientWidth+1||body.scrollWidth>body.clientWidth+1};
        });
        expect(geometry).toEqual({inside:true,footer:true,overflow:false});
        await browser.$(".ss-settings").saveScreenshot(resolve(screenshots,"settings-"+width+".png"));
      }
      await browser.sendCommand("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
      const beforeValue=await browser.$("input[placeholder='Source Scraper/Imported']").getValue();
      await browser.$("input[placeholder='Source Scraper/Imported']").setValue("Test draft folder");
      if(settingsWindow)await browser.switchToWindow(mainWindow);
      const staged=await browser.executeObsidian(({plugins})=>{
        const p=(plugins as any).sourceScraper;(globalThis as any).__settingsBefore={...p.settings};
        const before=p.settings.outputFolder;p.settings.projectFolder="changed-while-settings-open";return before;
      });expect(staged).toBe(beforeValue);
      if(settingsWindow)await browser.switchToWindow(settingsWindow);
      await click("Save settings");await browser.waitUntil(async()=>(await browser.$(".ss-settings .ss-form-status").getText())==="Settings saved.");
      if(settingsWindow)await browser.switchToWindow(mainWindow);
      const saved=await browser.executeObsidian(async({plugins})=>{
        const p=(plugins as any).sourceScraper,stored=await p.loadData();const result={folder:stored.outputFolder,other:stored.projectFolder};
        p.settings=(globalThis as any).__settingsBefore;delete (globalThis as any).__settingsBefore;await p.savePrefs();return result;
      });expect(saved).toEqual({folder:"Test draft folder",other:"changed-while-settings-open"});
      if(settingsWindow)await browser.switchToWindow(settingsWindow);
    }
    finally{if(settingsWindow){await browser.closeWindow();await browser.switchToWindow(mainWindow);}else await browser.executeObsidian(({app})=>{(app as any).setting.close();});}
    expect(await snapshot()).toEqual(original);
  });
  it("stages MCP results passively and releases all UI on unload",async()=>{
    await browser.executeObsidian(({plugins},data)=>{(plugins as any).sourceScraper.setImported(data);},fixture);expect(await browser.$(".ss-popover").isExisting()).toBe(false);await overview();await browser.executeObsidian(async({app})=>{await (app as any).plugins.disablePlugin("source-scraper");});expect(await browser.$(".ss-popover").isExisting()).toBe(false);expect(await browser.$(".ss-status").isExisting()).toBe(false);expect(await snapshot()).toEqual(original);
  });
});
