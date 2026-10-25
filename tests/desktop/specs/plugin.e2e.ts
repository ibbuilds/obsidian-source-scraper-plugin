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
  it("inspects provenance and pending human reviews without creating notes",async()=>{
    const inspector=browser.$(".ss-record button");
    await inspector.waitForClickable({timeout:15000});
    await inspector.click();
    const modal=browser.$(".modal-container");
    await modal.waitForDisplayed({timeout:15000});
    const details=await modal.getText();
    expect(details).toContain("Independent research sample");
    expect(details).toContain("local-fixture");
    expect(details).toContain("pending");
    await browser.keys("Escape");
    await modal.waitForDisplayed({reverse:true,timeout:15000});
  });
  it("rejects incompatible JSON schema without modifying imported data or notes",async()=>{
    await click("Import JSON / NDJSON");
    const input=browser.$(".modal-container textarea");
    await input.waitForDisplayed({timeout:10000});
    await input.setValue(JSON.stringify({...fixture,schemaVersion:99}));
    await click("Import without writing notes");
    const modal=browser.$(".modal-container");
    await modal.waitForDisplayed({timeout:10000});
    expect(await browser.$(".source-scraper-view").getText()).toContain("Independent research sample");
    await browser.keys("Escape");
    await modal.waitForDisplayed({reverse:true,timeout:15000});
  });
  it("keeps existing user files byte-for-byte unchanged after navigation and rejected imports",async()=>{
    // The schema rejection shows a transient notice above the toolbar.
    await browser.waitUntil(async()=>!(await browser.$(".notice").isDisplayed().catch(()=>false)),{
      timeout:20000,interval:250,timeoutMsg:"Transient warning still blocks toolbar"
    });
    await click("Diagnostics");
    const data=await browser.executeObsidian(async({app,obsidian})=>{
      const ref=app.vault.getAbstractFileByPath("References.md");
      const prior=app.vault.getAbstractFileByPath("Projects/Important.md");
      if(!(ref instanceof obsidian.TFile)||!(prior instanceof obsidian.TFile)){
        throw Error("User files missing");
      }
      return {references:await app.vault.read(ref),important:await app.vault.read(prior),
        count:app.vault.getMarkdownFiles().filter(f=>
          f.path.startsWith("Source Scraper/Imported/desktop-generic/")).length};
    });
    expect(data.references).toBe("# Existing references\n\n- [Unmodified original](https://example.org/original)\n");
    expect(data.important).toBe("# Important user data\n\nDo not overwrite this document.\n");
    expect(data.count).toBe(1);
  });

  it("validates a neutral project manifest and saves only a new config file",async()=>{
    await click("Project JSON editor");
    const modal=browser.$(".modal-container");
    await modal.waitForDisplayed({timeout:10000});
    expect(await modal.getText()).toContain("General project configuration");
    await click("Validate project JSON");
    expect(await modal.getText()).toContain("Valid basic project structure");
    await click("Create new project file");
    await browser.waitUntil(async()=>browser.executeObsidian(async({app})=>
      app.vault.getFiles().some(f=>f.path==="Source Scraper/Projects/my-research.json")),{
      timeout:15000,timeoutMsg:"General project manifest was not created"
    });
    const details=await browser.executeObsidian(async({app,obsidian})=>{
      const manifest=app.vault.getAbstractFileByPath("Source Scraper/Projects/my-research.json");
      const refs=app.vault.getAbstractFileByPath("References.md");
      if(!(manifest instanceof obsidian.TFile)||!(refs instanceof obsidian.TFile))
        throw Error("Missing project or original references");
      return {manifest:JSON.parse(await app.vault.read(manifest)),
        references:await app.vault.read(refs)};
    });
    expect(details.manifest.policy.includeKeywords).toEqual([]);
    expect(details.manifest.policy.excludeKeywords).toEqual([]);
    expect(details.manifest.outputs).toEqual([]);
    expect(details.references).toBe("# Existing references\n\n- [Unmodified original](https://example.org/original)\n");
  });
  it("never overwrites a manually edited project manifest on repeated creation",async()=>{
    const edited=await browser.executeObsidian(async({app,obsidian})=>{
      const file=app.vault.getAbstractFileByPath("Source Scraper/Projects/my-research.json");
      if(!(file instanceof obsidian.TFile))throw Error("Project manifest missing");
      await app.vault.append(file,"\nManual owner annotation; never erase.\n");
      return await app.vault.read(file);
    });
    await click("Project JSON editor");
    const modal=browser.$(".modal-container");
    await modal.waitForDisplayed({timeout:12000});
    await click("Create new project file");
    expect(await modal.isDisplayed()).toBe(true);
    const original=await browser.executeObsidian(async({app,obsidian})=>{
      const f=app.vault.getAbstractFileByPath("Source Scraper/Projects/my-research.json");
      if(!(f instanceof obsidian.TFile))throw Error("Missing project");
      return app.vault.read(f);
    });
    expect(original).toBe(edited);
    await browser.keys("Escape");
    await modal.waitForDisplayed({reverse:true,timeout:10000});
  });

  it("imports and saves a portable note mapping without editing existing user notes",async()=>{
    await click("Note mapping");
    const modal=browser.$(".modal-container");
    await modal.waitForDisplayed({timeout:12000});
    const mapping=modal.$("textarea");
    await mapping.setValue(JSON.stringify({
      version:1,titleField:"title",
      properties:{source_measurement:"attributes.measurement"},
      sections:{assessment:true,attributes:false,provenance:true}
    }));
    await click("Validate and preview mapping");
    const preview=modal.$(".ss-preview");
    await expect(preview).toHaveText(expect.stringContaining("source_measurement: 2"));
    await click("Save mapping (no note writes)");
    await modal.waitForDisplayed({reverse:true,timeout:15000});
    const original=await browser.executeObsidian(async({app,obsidian})=>{
      const reference=app.vault.getAbstractFileByPath("References.md");
      const project=app.vault.getAbstractFileByPath("Projects/Important.md");
      if(!(reference instanceof obsidian.TFile)||!(project instanceof obsidian.TFile))
        throw Error("User notes disappeared");
      return {reference:await app.vault.read(reference),project:await app.vault.read(project),
        createdNotes:app.vault.getMarkdownFiles().filter(f=>
          f.path.startsWith("Source Scraper/Imported/desktop-generic/")).length};
    });
    expect(original.reference).toContain("Unmodified original");
    expect(original.project).toContain("Do not overwrite");
    expect(original.createdNotes).toBe(1);
  });

  it("keeps keyboard focus while filtering multiple characters",async()=>{
    const search=browser.$('input[placeholder="Any title, key or type"]');
    await search.waitForDisplayed({timeout:12000});
    await search.click();
    await browser.keys("Public");
    const value=await browser.execute(()=>{
      const el=document.activeElement;
      return el instanceof HTMLInputElement?el.value:"not-focused";
    });
    expect(value).toBe("Public");
    const content=await browser.$(".source-scraper-view").getText();
    expect(content).toContain("Public catalog sample");
    expect(content).not.toContain("Independent research sample");
  });

});
