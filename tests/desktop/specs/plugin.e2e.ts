import {browser,expect} from "@wdio/globals";

const fixture={
  schemaVersion:1,dataset:"entities",projectId:"desktop-generic",
  exportedAt:"2026-10-24T00:00:00Z",limit:10,offset:0,count:2,
  records:[
    {projectId:"desktop-generic",key:"record:one",type:"lab-sample",
      title:"Independent research sample",attributes:{measurement:2,unit:"sample"},
      category:"unassessed",score:50,confidence:0.4,reasons:["No user rules configured"],
      review:"pending",updatedAt:"2026-10-24T00:00:00Z",observationCount:1,
      provenance:{mentions:[{connectionId:"local-fixture",itemId:"one",evidence:[]}],
        reviews:[],assessmentHistory:[],mentionsTruncated:false}},
    {projectId:"desktop-generic",key:"record:two",type:"catalog-entry",
      title:"Public catalog sample",url:"https://example.org/catalog",
      attributes:{description:"General data"},category:"candidate",score:65,
      confidence:0.6,reasons:["Independent fixture"],
      review:"approved",updatedAt:"2026-10-24T00:00:00Z",observationCount:1}
  ]
};
const click=async(name:string)=>{
  const button=browser.$("//button[normalize-space()='"+name+"']");
  await button.waitForClickable({timeout:25000});await button.click();
};
const snapshot=()=>browser.executeObsidian(async({app})=>{
  const files=app.vault.getFiles().sort((a,b)=>a.path.localeCompare(b.path));
  const contents:Record<string,string>={};for(const file of files)contents[file.path]=await app.vault.read(file);return contents;
});
let original:Record<string,string>;
const importFixture=async(value:unknown=fixture)=>{
  await click("Import JSON / NDJSON");const input=browser.$(".modal-container textarea");
  await input.waitForDisplayed({timeout:20000});await input.setValue(JSON.stringify(value));
  await click("Import without writing notes");
};
describe("Source Scraper reviews without owning vault writes",()=>{
  it("loads with no automatic collection or note changes",async()=>{
    original=await snapshot();await browser.executeObsidianCommand("source-scraper:open-panel");
    const panel=browser.$(".source-scraper-view");await panel.waitForDisplayed({timeout:25000});
    expect(await panel.getText()).toContain("No data imported.");
    expect(await snapshot()).toEqual(original);
  });
  it("imports generic entities and exposes no create-notes action",async()=>{
    await importFixture();const panel=browser.$(".source-scraper-view");
    await browser.waitUntil(async()=>(await panel.getText()).includes("Independent research sample"),{timeout:25000});
    expect((await browser.$$(".ss-record")).length).toBe(2);
    expect(await panel.getText()).toContain("Only ChatGPT writes notes");
    expect(await browser.$("//button[normalize-space()='Create new notes only']").isExisting()).toBe(false);
    expect(await snapshot()).toEqual(original);
  });
  it("previews selected Markdown without creating files or save controls",async()=>{
    const rows=await browser.$$(".ss-record");await rows[0].$(".checkbox-container").click();
    await click("Preview selected drafts");const folder=browser.$(".modal-container input[type=text]");
    await folder.waitForDisplayed({timeout:15000});await folder.setValue("Draft Only");
    await expect(browser.$(".modal-container .ss-preview")).toHaveText(expect.stringContaining("desktop-generic"));
    expect(await browser.$(".modal-container").getText()).toContain("this plugin cannot create or change notes");
    expect(await browser.$("//button[normalize-space()='Create new notes only']").isExisting()).toBe(false);
    expect(await snapshot()).toEqual(original);await browser.keys("Escape");
  });
  it("reimport and evidence inspection preserve every original file",async()=>{
    await importFixture();const panel=browser.$(".source-scraper-view");
    await browser.waitUntil(async()=>(await panel.getText()).includes("Selected: 0"),{timeout:15000});
    await click("Inspect data and evidence");
    expect(await browser.$(".modal-container").getText()).toContain("No user rules configured");
    expect(await snapshot()).toEqual(original);await browser.keys("Escape");
  });
  it("validates project JSON without a vault-file creation action",async()=>{
    await click("Project JSON editor");await click("Validate project JSON");
    expect(await browser.$(".modal-container").getText()).toContain("Valid basic project structure");
    expect(await browser.$("//button[normalize-space()='Create new project file']").isExisting()).toBe(false);
    expect(await snapshot()).toEqual(original);await browser.keys("Escape");
  });
  it("shows disabled X account setup without collecting or modifying vault files",async()=>{
    await click("X feed setup");
    const modal=browser.$(".modal-container");await modal.waitForDisplayed({timeout:15000});
    expect(await modal.getText()).toContain("Local grant: disabled");
    expect(await modal.getText()).toContain("Creating the project does not contact X");
    expect(await modal.getText()).toContain("No commercial API key");
    expect(await modal.getText()).toContain("Do not paste credentials");
    expect(await snapshot()).toEqual(original);await browser.keys("Escape");
  });
  it("rejects an incompatible import without altering user files",async()=>{
    await importFixture({...fixture,schemaVersion:2});
    expect(await snapshot()).toEqual(original);await browser.keys("Escape");
  });
  it("filters through the existing keyboard-friendly input without writing notes",async()=>{
    const search=browser.$(".source-scraper-view input[placeholder='Any title, key or type']");
    await search.setValue("Independent");
    await browser.waitUntil(async()=>(await browser.$$(".ss-record")).length===1,{timeout:15000});
    expect(await browser.$(".ss-record").getText()).toContain("Independent research sample");
    expect(await snapshot()).toEqual(original);
  });
});
