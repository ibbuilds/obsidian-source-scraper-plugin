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
  await button.waitForClickable({timeout:25000});
  await button.click();
};
describe("Independent Source Scraper in real Obsidian Desktop",()=>{
  it("loads without modifying References.md or user notes",async()=>{
    await browser.executeObsidianCommand("source-scraper:open-panel");
    const panel=browser.$(".source-scraper-view");
    await panel.waitForDisplayed({timeout:25000});
    const text=await panel.getText();
    expect(text).toContain("Import JSON / NDJSON");
    expect(text).toContain("No data imported.");
    const initial=await browser.executeObsidian(async({app,obsidian})=>{
      const reference=app.vault.getAbstractFileByPath("References.md");
      const owned=app.vault.getAbstractFileByPath("Projects/Important.md");
      if(!(reference instanceof obsidian.TFile)||!(owned instanceof obsidian.TFile)){
        throw Error("Existing user files missing");
      }
      return {
        reference:await app.vault.read(reference),
        important:await app.vault.read(owned),
        created:app.vault.getAbstractFileByPath("Source Scraper/Imported")
      };
    });
    expect(initial.reference).toContain("Unmodified original");
    expect(initial.important).toContain("Do not overwrite");
    expect(initial.created).toBe(null);
  });
  it("imports two non-domain-specific entities, previews and creates one note",async()=>{
    await click("Import JSON / NDJSON");
    const input=browser.$(".modal-container textarea");
    await input.waitForDisplayed({timeout:20000});
    await input.setValue(JSON.stringify(fixture));
    await click("Import without writing notes");
    const panel=browser.$(".source-scraper-view");
    await browser.waitUntil(async()=>(
      await panel.getText()).includes("Independent research sample"),{
      timeout:25000,timeoutMsg:"Generic JSON entity not rendered"
    });
    const rows=await browser.$$(".ss-record");
    expect(rows.length).toBe(2);
    await rows[0].$(".checkbox-container").click();
    await click("Preview and create selected notes");
    const folder=browser.$(".modal-container input[type=text]");
    await folder.waitForDisplayed({timeout:15000});
    await folder.setValue("Source Scraper/Imported");
    const preview=browser.$(".modal-container .ss-preview");
    await expect(preview).toHaveText(expect.stringContaining("desktop-generic"));
    await click("Create new notes only");
    await browser.waitUntil(async()=>browser.executeObsidian(async({app})=>
      app.vault.getMarkdownFiles().some(f=>f.path.startsWith("Source Scraper/Imported/desktop-generic/"))),{
      timeout:25000,timeoutMsg:"Create-only output not found in vault"
    });
    const result=await browser.executeObsidian(async({app,obsidian})=>{
      const notes=app.vault.getMarkdownFiles();
      const one=notes.find(f=>f.path.startsWith("Source Scraper/Imported/desktop-generic/"));
      const reference=app.vault.getAbstractFileByPath("References.md");
      const important=app.vault.getAbstractFileByPath("Projects/Important.md");
      if(!one||!(reference instanceof obsidian.TFile)||!(important instanceof obsidian.TFile)){
        throw Error("Required notes missing");
      }
      return {createdPath:one.path,created:await app.vault.read(one),
        reference:await app.vault.read(reference),important:await app.vault.read(important)};
    });
    expect(result.created).toContain("Independent research sample");
    expect(result.created).toContain("source-scraper-entity");
    expect(result.created).toContain("local-fixture");
    expect(result.reference).toContain("Unmodified original");
    expect(result.important).toContain("Do not overwrite");
  });
  it("reimport and explicit duplicate export preserve manually edited Markdown",async()=>{
    const previous=await browser.executeObsidian(async({app})=>{
      const note=app.vault.getMarkdownFiles().find(f=>f.path.startsWith("Source Scraper/Imported/desktop-generic/"));
      if(!note)throw Error("Missing created note");
      await app.vault.append(note,"\nUser-authored change must survive.\n");
      return note.path;
    });
    await click("Preview and create selected notes");
    const preview=browser.$(".modal-container .ss-preview");
    await preview.waitForDisplayed({timeout:15000});
    await click("Create new notes only");
    const after=await browser.executeObsidian(async({app,obsidian})=>{
      const file=app.vault.getAbstractFileByPath("References.md");
      const existing=app.vault.getAbstractFileByPath("Projects/Important.md");
      if(!(file instanceof obsidian.TFile)||!(existing instanceof obsidian.TFile)){
        throw Error("User files not found");
      }
      const created=app.vault.getMarkdownFiles().filter(f=>
        f.path.startsWith("Source Scraper/Imported/desktop-generic/"));
      return {references:await app.vault.read(file),important:await app.vault.read(existing),
        created:await Promise.all(created.map(f=>app.vault.read(f))),
        paths:created.map(f=>f.path)};
    });
    expect(after.paths).toEqual([previous]);
    expect(after.created[0]).toContain("User-authored change must survive.");
    expect(after.references).toContain("Unmodified original");
    expect(after.important).toContain("Do not overwrite");
  });
});
