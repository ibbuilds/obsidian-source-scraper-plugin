import {
  FileSystemAdapter,ItemView,Modal,Notice,Plugin,PluginSettingTab,
  Setting,TFile,setIcon
} from "obsidian";
import {parseExport,type EntityExport,type EntityRecord} from "./contracts.ts";
import {selectedPlans} from "./vault-writer.ts";
import {CliBridge,type XLocalSession} from "./cli-bridge.ts";
import {SourceScraperProvider,writeWorkspaceProject,type RegisteredProject} from "./mcp-provider.ts";
import {buildXFeedProject,xFeedReadiness,validateLocalSession} from "./x-feed.ts";
import {ScraperPopover} from "./status-popover.ts";
import {panelState,type PanelSnapshot,type PanelProject} from "./panel-model.ts";
import {createHash,randomUUID} from "node:crypto";
import {homedir} from "node:os";
import {join} from "node:path";
import {existsSync,readFileSync,statSync} from "node:fs";
import {GENERIC_TEMPLATE,parseProjectManifest} from "./project-manifest.ts";
import {DEFAULT_NOTE_MAPPING_JSON,parseNoteMapping} from "./note-mapping.ts";

const VIEW_TYPE="source-scraper-view";
interface Preferences {
  xProviderEnabled:string;
  xPythonPath:string;
  mcpEnabled:string;
  mcpProjectsJson:string;
  mcpCliHash:string;
  mcpWorkspacePath:string;
  outputFolder:string;
  cliPath:string;
  configPath:string;
  nodeExecutable:string;
  projectFolder:string;
  noteMappingJson:string;
}
const defaults:Preferences={xProviderEnabled:"false",xPythonPath:"",mcpEnabled:"false",mcpProjectsJson:"[]",mcpCliHash:"",mcpWorkspacePath:"",outputFolder:"",cliPath:"",configPath:"",nodeExecutable:"node",
  projectFolder:"",noteMappingJson:DEFAULT_NOTE_MAPPING_JSON};
function errorMessage(error:unknown):string {
  const message=error instanceof Error?error.message:String(error);
  return message.replace(/https?:\/\/[^\s"'<>()]+/gi,"[redacted-url]")
    .replace(/(?:token|password|secret|cookie|session|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,"[redacted]")
    .slice(0,350);
}
function notify(error:unknown):void{new Notice(errorMessage(error),7000);}
function paragraph(root:HTMLElement,text:string):void{root.createEl("p",{text});}

class ImportModal extends Modal {
  private selectedFile="";
  private pasted="";
  constructor(app:Plugin["app"],private plugin:ScraperPlugin){super(app);}
  onOpen():void{
    const root=this.contentEl;
    root.empty();root.addClass("source-scraper-modal");
    root.createEl("h3",{text:"Import Source Scraper JSON"});
    paragraph(root,"Read an existing JSON/NDJSON export; no source, command or vault file is modified.");
    const files=this.app.vault.getFiles().filter(file=>/\.(json|ndjson)$/i.test(file.path));
    new Setting(root).setName("JSON file in this vault")
      .setDesc("Optional. Leave blank to paste JSON instead.")
      .addDropdown(d=>{
        d.addOption("","Paste text below");
        for(const file of files.slice(0,200))d.addOption(file.path,file.path);
        d.setValue("").onChange(value=>{this.selectedFile=value;});
      });
    const input=root.createEl("textarea",{attr:{rows:"11",placeholder:"Paste a versioned entities JSON/NDJSON export, or select a file above"}});
    input.addEventListener("input",()=>{this.pasted=input.value;});
    new Setting(root).addButton(b=>b.setButtonText("Import without writing notes")
      .setCta().onClick(async()=>{
        try{
          let text=this.pasted;
          if(!text.trim()&&this.selectedFile){
            const file=this.app.vault.getAbstractFileByPath(this.selectedFile);
            if(!(file instanceof TFile))throw new Error("Selected export is no longer available");
            if(file.stat.size>8_000_000)throw new Error("Import exceeds 8 MB");
            text=await this.app.vault.read(file);
          }
          this.plugin.setImported(parseExport(text));
          this.close();
          new Notice("Imported data into preview only. No files were written.");
        }catch(error){notify(error);}
      }));
  }
  onClose():void{this.contentEl.empty();}
}
/** Project configuration is data, never executable code in the plugin. */
class ProjectModal extends Modal {
  private body=GENERIC_TEMPLATE;
  private selectedPath="";
  constructor(app:Plugin["app"],private plugin:ScraperPlugin){
    super(app);
  }
  onOpen():void{
    const root=this.contentEl;root.empty();root.addClass("source-scraper-modal");
    root.createEl("h3",{text:"General project configuration"});
    paragraph(root,"Define any project with the public Source Scraper JSON manifest format. No topic rules are imposed, and editing this form never executes a source or writes a note.");
    const candidates=this.app.vault.getFiles()
      .filter(f=>f.extension==="json"&&f.stat.size<=200000);
    new Setting(root).setName("Existing project in this vault (optional)")
      .setDesc("Inspect or use a project JSON without overwriting it.")
      .addDropdown(d=>{
        d.addOption("","Start from the neutral local JSON template");
        for(const file of candidates.slice(0,200))d.addOption(file.path,file.path);
        d.onChange(async path=>{
          this.selectedPath=path;
          if(!path)return;
          try{
            const file=this.app.vault.getAbstractFileByPath(path);
            if(!(file instanceof TFile))throw Error("Project JSON is unavailable");
            const input=await this.app.vault.read(file);
            const manifest=parseProjectManifest(input);
            this.body=JSON.stringify(manifest,null,2);
            area.value=this.body;
            status.setText("Loaded project "+manifest.id+". No file was changed.");
          }catch(error){notify(error);}
        });
      });
    const area=root.createEl("textarea",{
      attr:{rows:"14",placeholder:"Public Source Scraper project JSON"}
    });
    area.value=this.body;
    area.addEventListener("input",()=>{
      this.body=area.value;
      // Once edited, do not claim that the selected existing file is identical.
      this.selectedPath="";
    });
    const status=root.createEl("pre",{cls:"ss-preview"});
    status.setText("Validate or copy project JSON. Project files are created outside the vault through registered MCP workspaces.");
    new Setting(root).addButton(b=>b.setButtonText("Validate project JSON")
      .onClick(()=>{
        try{
          const manifest=parseProjectManifest(this.body);
          status.setText("Valid basic project structure\n"+
            "ID: "+manifest.id+"\nSources: "+manifest.sources.length+
            "\nPipeline: "+manifest.pipeline.join(", ")+
            "\nOutputs: "+manifest.outputs.length+
            "\nThe engine performs adapter-specific validation when run. No sources executed.");
        }catch(error){status.setText(errorMessage(error));}
      }));
    new Setting(root).addButton(b=>b.setButtonText("Use selected existing project (no writes)")
      .onClick(async()=>{
        try{
          if(!this.selectedPath)throw Error("Choose an existing project JSON above");
          const file=this.app.vault.getAbstractFileByPath(this.selectedPath);
          const adapter=this.app.vault.adapter;
          if(!(file instanceof TFile)||!(adapter instanceof FileSystemAdapter))
            throw Error("A local desktop vault project file is required");
          parseProjectManifest(await this.app.vault.read(file));
          this.plugin.settings.configPath=join(adapter.getBasePath(),file.path);
          await this.plugin.savePrefs();
          this.close();
          new Notice("Selected existing project for optional CLI use. No source has run.");
        }catch(error){notify(error);}
      }));
  }
  onClose():void{this.contentEl.empty();}
}
class NoteMappingModal extends Modal {
  private text:string;
  constructor(app:Plugin["app"],private plugin:ScraperPlugin){
    super(app);this.text=plugin.settings.noteMappingJson;
  }
  onOpen():void{
    const root=this.contentEl;root.empty();root.addClass("source-scraper-modal");
    root.createEl("h3",{text:"Portable note mapping JSON"});
    paragraph(root,"Choose additional YAML properties, a note-title field and which generic data sections to include. This configuration changes previews and future new notes only; existing notes are never edited.");
    const area=root.createEl("textarea",{attr:{rows:"12",placeholder:"Source-independent note mapping JSON"}});
    area.value=this.text;
    area.addEventListener("input",()=>{this.text=area.value;});
    const result=root.createEl("pre",{cls:"ss-preview"});
    const validate=():void=>{
      const mapping=parseNoteMapping(this.text);
      const selected=this.plugin.getSelected();
      if(selected.length){
        const folder=this.plugin.settings.outputFolder||"Source Scraper/Imported";
        const plans=selectedPlans(folder,selected.slice(0,1),mapping);
        result.setText(plans[0].content.slice(0,4500));
      }else result.setText("Valid portable mapping (version 1). Import and select a record to see its preview.");
    };
    new Setting(root).addButton(b=>b.setButtonText("Validate and preview mapping")
      .onClick(()=>{try{validate();}catch(error){result.setText(errorMessage(error));}}));
    new Setting(root).addButton(b=>b.setButtonText("Save mapping (no note writes)")
      .setCta().onClick(async()=>{
        try{
          const mapping=parseNoteMapping(this.text);
          this.plugin.settings.noteMappingJson=JSON.stringify(mapping,null,2);
          await this.plugin.savePrefs();
          this.close();
          new Notice("Saved portable JSON mapping. Existing notes were untouched.");
        }catch(error){notify(error);}
      }));
    new Setting(root).addButton(b=>b.setButtonText("Restore generic default in editor")
      .onClick(()=>{
        this.text=DEFAULT_NOTE_MAPPING_JSON;
        area.value=this.text;
        result.setText("Default loaded into the editor. Press Save to apply.");
      }));
  }
  onClose():void{this.contentEl.empty();}
}
class DetailModal extends Modal {
  private decision:"approved"|"rejected"|"pending";
  private reason="";
  private busy=false;
  constructor(app:Plugin["app"],private plugin:ScraperPlugin,private entity:EntityRecord){
    super(app);
    this.decision=entity.review;
  }
  onOpen():void{
    const root=this.contentEl;root.empty();
    root.createEl("h3",{text:this.entity.title});
    paragraph(root,"Machine assessment and source claims are not independent verification.");
    const pre=root.createEl("pre");
    pre.addClass("ss-preview");
    pre.setText(JSON.stringify({
      projectId:this.entity.projectId,key:this.entity.key,type:this.entity.type,
      url:this.entity.url??null,attributes:this.entity.attributes,
      score:this.entity.score,confidence:this.entity.confidence,
      review:this.entity.review,reasons:this.entity.reasons,
      provenance:this.entity.provenance??"Not included in export"
    },null,2));
    void this.plugin.showAgentAssessments(this.entity,root);
    if(!this.plugin.settings.cliPath||!this.plugin.settings.configPath){
      paragraph(root,"Connect the trusted CLI and project in Settings to save a human review to the engine.");
      return;
    }
    paragraph(root,"A review is saved only when you explicitly confirm it with a reason.");
    new Setting(root).setName("Human decision").addDropdown(d=>d.addOptions({
      pending:"Pending",approved:"Approved",rejected:"Rejected"
    }).setValue(this.decision).onChange(value=>{
      this.decision=value as "pending"|"approved"|"rejected";
    }));
    new Setting(root).setName("Required reason").addTextArea(t=>
      t.setPlaceholder("How was this decision verified?")
        .onChange(value=>{this.reason=value;}));
    new Setting(root).addButton(b=>b.setButtonText("Save human review to engine")
      .onClick(async()=>{
        if(this.busy)return;
        this.busy=true;
        try{
          const s=this.plugin.settings;
          await this.plugin.cli.review({
            cliPath:s.cliPath,configPath:s.configPath,nodeExecutable:s.nodeExecutable
          },this.entity.projectId,this.entity.key,this.decision,this.reason);
          this.entity.review=this.decision;
          this.plugin.refresh();
          this.close();
          new Notice("Human review saved to the matching Source Scraper project.");
        }catch(error){notify(error);}
        finally{this.busy=false;}
      }));
  }
  onClose():void{this.contentEl.empty();}
}
class ExportModal extends Modal {
  private folder:string;
  constructor(app:Plugin["app"],private plugin:ScraperPlugin,
    private records:EntityRecord[]){
    super(app);this.folder=plugin.settings.outputFolder;
  }
  onOpen():void{
    const root=this.contentEl;root.empty();root.addClass("source-scraper-modal");
    root.createEl("h3",{text:"Preview Markdown drafts"});
    paragraph(root,"These are drafts for ChatGPT to consume. This project never creates or changes vault notes.");
    const preview=root.createEl("pre",{cls:"ss-preview"});
    const refresh=()=>{
      try{
        const mapping=parseNoteMapping(this.plugin.settings.noteMappingJson);
        const plans=selectedPlans(this.folder,this.records,mapping);
        preview.setText(plans.map(x=>x.path).join("\n")+
          (plans.length?"\n\nFirst note preview:\n\n"+plans[0].content.slice(0,3500):""));
      }catch(error){preview.setText(errorMessage(error));}
    };
    new Setting(root).setName("Vault-relative destination folder")
      .setDesc("Choose a folder explicitly. Do not use an existing references file.")
      .addText(t=>t.setPlaceholder("Source Scraper/Imported")
        .setValue(this.folder).onChange(value=>{this.folder=value;refresh();}));
    refresh();
    paragraph(root,"Drafts only. Ask ChatGPT to write selected content through your existing Obsidian connector; this plugin cannot create or change notes.");
  }
  onClose():void{this.contentEl.empty();}
}
class RunModal extends Modal {
  private busy=false;
  constructor(app:Plugin["app"],private plugin:ScraperPlugin){super(app);}
  onOpen():void{
    const root=this.contentEl;root.empty();
    root.createEl("h3",{text:"Run an explicitly configured local project"});
    paragraph(root,"This may access sources or trusted MCP executables configured in your project. It does not automatically export notes, invoke webhook outputs or modify existing vault files.");
    paragraph(root,"CLI: "+(this.plugin.settings.cliPath||"Not configured"));
    paragraph(root,"Project: "+(this.plugin.settings.configPath||"Not configured"));
    new Setting(root).addButton(b=>b.setButtonText("Run source collection and preview JSON")
      .setCta().onClick(async()=>{
        if(this.busy)return;
        this.busy=true;
        try{
          const s=this.plugin.settings;
          if(!s.cliPath||!s.configPath)throw new Error("Select the CLI and a project in plugin settings first");
          const imported=await this.plugin.cli.runAndImport({
            cliPath:s.cliPath,configPath:s.configPath,nodeExecutable:s.nodeExecutable,allowXProvider:s.xProviderEnabled==="true",xPythonPath:s.xPythonPath,xSession:this.plugin.localSession()
          });
          this.plugin.setImported(imported);
          this.close();
          new Notice("Collection completed. Preview imported without writing notes.");
        }catch(error){notify(error);}
        finally{this.busy=false;}
      }));
    new Setting(root).addButton(b=>b.setButtonText("Cancel running process")
      .onClick(()=>{this.plugin.cli.cancel();this.close();}));
  }
}
class XFeedSetupModal extends Modal {
  private clearSecrets?:()=>void;
  constructor(app:Plugin["app"],private plugin:ScraperPlugin){super(app);}
  onOpen():void{
    const root=this.contentEl;root.empty();root.addClass("source-scraper-modal","ss-x-setup");root.createEl("h3",{text:"Connect X locally"});
    paragraph(root,"No commercial API key, subscription or paid fallback. The free local collector uses your X session directly with X. Live For You access still needs a test collection.");
    paragraph(root,"Enter session values only in these masked local fields, never in ChatGPT. They stay in memory until you disconnect or close Obsidian; they are not saved in settings or notes. This plugin does not extract browser cookies or automate login.");
    const readiness=xFeedReadiness(this.plugin.localSession());
    paragraph(root,"Local grant: "+(this.plugin.settings.xProviderEnabled==="true"?"enabled":"disabled")+
      ". Local CSRF value: "+(readiness.csrfConfigured?"configured":"missing")+". Account session: "+(readiness.accountSessionConfigured?"configured":"missing")+".");
    paragraph(root,"Creating the project does not contact X. Enable local read-only X access in settings when the session is ready. This unofficial client stops on authentication errors or rate limits; it does not automate login or solve challenges.");
    let accountId="",include="react, frontend, css, gsap, motion, typography, design system, open source",exclude="sponsored, giveaway",minimum=50,pages=1;
    let accountSession="",csrf="",busy=false;
    const secretInputs:HTMLInputElement[]=[];
    this.clearSecrets=()=>{accountSession="";csrf="";for(const input of secretInputs)input.value="";};
    try{
      const existing=this.plugin.registeredProjects().find(p=>p.id==="x-for-you-resources");
      if(existing){const manifest=parseProjectManifest(readFileSync(existing.configPath,"utf8"));
        accountId=String(manifest.sources[0].config.accountId||"");include=manifest.policy.includeKeywords.join(", ");exclude=manifest.policy.excludeKeywords.join(", ");minimum=manifest.policy.minimumScore;pages=Number(manifest.sources[0].config.pagesPerRun)||1;}
    }catch{/* The normal validation path reports stale or unavailable registered files. */}
    new Setting(root).setName("Numeric X account ID").addText(t=>t.setValue(accountId).setPlaceholder("Connected account's numeric ID").onChange(v=>{accountId=v.trim();}));
    for(const [label,key] of [["Account session (auth_token)","session"],["CSRF value (ct0)","csrf"]] as const){
      new Setting(root).setName(label).setDesc("Used locally with X; kept in memory only.").addText(t=>{
        t.inputEl.type="password";t.inputEl.autocomplete="off";t.inputEl.spellcheck=false;t.inputEl.setAttribute("aria-label",label);secretInputs.push(t.inputEl);
        t.onChange(value=>{if(key==="session")accountSession=value;else csrf=value;});
      });
    }
    new Setting(root).setName("Include terms (editable suggestions)").addTextArea(t=>t.setValue(include).onChange(v=>{include=v;}));
    new Setting(root).setName("Exclude terms").addTextArea(t=>t.setValue(exclude).onChange(v=>{exclude=v;}));
    new Setting(root).setName("Suggested minimum relevance score (0–100)").addText(t=>t.setValue(String(minimum)).onChange(v=>{minimum=Number(v);}));
    new Setting(root).setName("X pages per explicit run (1–10)").addText(t=>t.setValue(String(pages)).onChange(v=>{pages=Number(v);}));
    const status=root.createEl("p");
    const prepare=async():Promise<void>=>{
      if(!(this.app.vault.adapter instanceof FileSystemAdapter))throw Error("A desktop filesystem vault is required");
      const s=this.plugin.settings,manifest=buildXFeedProject(accountId,include,exclude,minimum,pages);
      const projects=JSON.parse(s.mcpProjectsJson) as RegisteredProject[];
      if(!Array.isArray(projects))throw Error("Invalid local project registry");
      let project=projects.find(p=>p.id===manifest.id);
      if(project){
        const raw=readFileSync(project.configPath,"utf8");
        if(createHash("sha256").update(raw).digest("hex")!==project.manifestHash)throw Error("Existing project changed; verify its registered digest first");
        if(JSON.stringify(parseProjectManifest(raw))!==JSON.stringify(manifest))throw Error("Existing project retained. Reconnect with its current filters; edit and reverify project JSON separately.");
      }else{
        if(projects.length>=100)throw Error("Project registry is full");
        project=writeWorkspaceProject(s.mcpWorkspacePath,this.app.vault.adapter.getBasePath(),manifest);
        s.mcpProjectsJson=JSON.stringify([...projects,project]);
      }
      s.configPath=project.configPath;await this.plugin.savePrefs();
    };
    new Setting(root).addButton(b=>b.setButtonText("Use local session (no collection)").setCta().onClick(async()=>{
      if(busy)return;busy=true;b.setDisabled(true);
      try{
        if(this.plugin.isCollecting())throw Error("Wait for the current collection or stop it first");
        const session=validateLocalSession(accountSession,csrf);
        if(!this.plugin.settings.xPythonPath||!existsSync(this.plugin.settings.xPythonPath))throw Error("Configure the isolated Python interpreter in Source Scraper settings first");
        await prepare();await this.plugin.useLocalSession(session);this.clearSecrets?.();
        status.setText("Local session loaded for this Obsidian session. No X request was made. Open the status indicator to collect a test sample.");
      }catch(error){status.setText(errorMessage(error));}
      finally{busy=false;b.setDisabled(false);}
    }));
    new Setting(root).addButton(b=>b.setButtonText("Prepare project outside vault (no collection)").onClick(async()=>{
      if(busy)return;busy=true;b.setDisabled(true);
      try{
        if(this.plugin.isCollecting())throw Error("Stop the current collection before changing projects");
        await prepare();status.setText("Project prepared outside the vault. No request or note write occurred.");
      }catch(error){status.setText(errorMessage(error));}
      finally{busy=false;b.setDisabled(false);}
    }));
  }
  onClose():void{this.clearSecrets?.();this.clearSecrets=undefined;this.contentEl.empty();}
}
/** Compatibility only: saved legacy leaves are detached on layout readiness. */
class LegacyScraperView extends ItemView {
  getViewType():string{return VIEW_TYPE;}
  getDisplayText():string{return "Source Scraper";}
}
class ScraperReview {
  private page=0;
  private search="";
  constructor(private root:HTMLElement|undefined,private plugin:ScraperPlugin){}
  private get app():Plugin["app"]{return this.plugin.app;}
  mount(root:HTMLElement):void{this.root=root;this.render();}
  unmount():void{this.root=undefined;}
  render():void{
    const root=this.root;if(!root||!root.isConnected)return;
    root.empty();root.addClass("source-scraper-view");
    const imported=this.plugin.imported;
    if(!imported){paragraph(root,"No sources to review yet. Import findings or collect a sample first.");return;}
    const summary=root.createDiv({cls:"ss-review-summary"});
    summary.createEl("p",{cls:"ss-count",text:imported.records.length+" sources · Selected: "+this.plugin.selected.size});
    summary.createEl("p",{cls:"ss-review-project",text:imported.projectId.replace(/[-_]/g," ")});
    const searchBox=root.createDiv({cls:"ss-search"});setIcon(searchBox.createSpan({cls:"ss-search-icon"}),"search");
    const input=searchBox.createEl("input",{type:"search",attr:{placeholder:"Search sources",'aria-label':"Search sources"}});input.value=this.search;
    input.addEventListener("input",()=>{
      const cursor=input.selectionStart??input.value.length;this.search=input.value;this.page=0;this.render();
      const restored=root.querySelector<HTMLInputElement>('input[placeholder="Search sources"]');
      if(restored){restored.focus();const position=Math.min(cursor,this.search.length);restored.setSelectionRange(position,position);}
    });
    const query=this.search.toLowerCase();
    const filtered=imported.records.filter(e=>[e.title,e.key,e.type,e.category].some(value=>value.toLowerCase().includes(query)));
    const pageSize=40,pageCount=Math.max(1,Math.ceil(filtered.length/pageSize));this.page=Math.min(this.page,pageCount-1);
    const list=root.createDiv({cls:"ss-candidate-list"});list.setAttribute("aria-label","Sources to review");
    const visible=filtered.slice(this.page*pageSize,(this.page+1)*pageSize);
    if(!visible.length){const empty=list.createDiv({cls:"ss-empty-results"});empty.createEl("strong",{text:"No matching sources"});paragraph(empty,"Try a different title, type or keyword.");}
    for(const entity of visible){
      const item=list.createEl("article",{cls:"ss-record"});
      const head=item.createDiv({cls:"ss-record-head"});head.createEl("h4",{cls:"ss-record-title",text:entity.title});
      const checkbox=head.createEl("input",{type:"checkbox",cls:"ss-select-control",attr:{'aria-label':"Select "+entity.title}});
      checkbox.checked=this.plugin.selected.has(entity.key);checkbox.dataset.key=entity.key;
      checkbox.addEventListener("change",()=>{
        if(checkbox.checked)this.plugin.selected.add(entity.key);else this.plugin.selected.delete(entity.key);
        this.render();Array.from(root.querySelectorAll<HTMLInputElement>(".ss-select-control")).find(node=>node.dataset.key===entity.key)?.focus();
      });
      const source=item.createDiv({cls:"ss-record-source"});
      source.createSpan({text:entity.type.replace(/[-_]/g," ")});
      if(entity.url){
        source.createSpan({cls:"ss-source-separator",text:"·"});
        const link=source.createEl("a",{href:entity.url,text:new URL(entity.url).hostname.replace(/^www\./,""),attr:{target:"_blank",rel:"noopener noreferrer"}});
        link.setAttribute("aria-label","Open source: "+entity.title);
      }
      const description=typeof entity.attributes.description==="string"?entity.attributes.description:entity.reasons[0];
      if(description)item.createEl("p",{cls:"ss-record-description",text:description.slice(0,180)});
      const meta=item.createDiv({cls:"ss-record-meta"});
      const score=meta.createSpan({cls:"ss-tag",text:"Relevance "+entity.score});score.title="Heuristic score, not independent verification.";
      const decision=meta.createSpan({cls:"ss-tag ss-review-tag",text:entity.review==="pending"?"Not reviewed":entity.review==="approved"?"Approved":"Rejected"});decision.dataset.review=entity.review;
      const bottom=item.createDiv({cls:"ss-record-bottom"});
      const mentions=entity.provenance?.mentions.length;
      bottom.createSpan({cls:"ss-evidence-count",text:mentions===undefined?"Evidence not exported":mentions+" source mention"+(mentions===1?"":"s")});
      const inspect=bottom.createEl("button",{text:"View evidence",cls:"ss-evidence-action"});inspect.setAttribute("aria-label","View evidence: "+entity.title);
      inspect.onclick=()=>{this.plugin.closePopover();new DetailModal(this.app,this.plugin,entity).open();};
    }
    const pagination=root.createDiv({cls:"ss-pagination"});pagination.hidden=pageCount===1;
    const previous=pagination.createEl("button",{text:"Previous"});previous.disabled=this.page===0;previous.onclick=()=>{this.page--;this.render();};
    pagination.createSpan({text:"Page "+(this.page+1)+" of "+pageCount});
    const next=pagination.createEl("button",{text:"Next"});next.disabled=this.page>=pageCount-1;next.onclick=()=>{this.page++;this.render();};
    const selected=this.plugin.getSelected();
    const draftArea=root.createDiv({cls:"ss-review-footer"});
    const preview=draftArea.createEl("button",{text:"Preview selected drafts",cls:"ss-preview-action"});preview.disabled=selected.length===0;
    preview.onclick=()=>{
      try{
        if(!selected.length)throw Error("Select sources before previewing drafts");
        if(selected.length>200)throw Error("Select no more than 200 sources per export");
        this.plugin.closePopover();new ExportModal(this.app,this.plugin,selected).open();
      }catch(error){notify(error);}
    };
    const tools=root.createEl("details",{cls:"ss-review-tools"});tools.createEl("summary",{text:"Import and project tools"});
    const controls=tools.createDiv({cls:"ss-controls"});
    const action=(text:string,click:()=>void)=>{const button=controls.createEl("button",{text});button.addEventListener("click",()=>{this.plugin.closePopover();click();});};
    action("Import JSON / NDJSON",()=>new ImportModal(this.app,this.plugin).open());
    action("Project JSON editor",()=>new ProjectModal(this.app,this.plugin).open());
    action("Note mapping",()=>new NoteMappingModal(this.app,this.plugin).open());
    action("Run local CLI (optional)",()=>new RunModal(this.app,this.plugin).open());
    action("X feed setup",()=>new XFeedSetupModal(this.app,this.plugin).open());
    action("Diagnostics",()=>new Notice("Engine CLI: "+(this.plugin.settings.cliPath?"configured":"not connected")+"; "+imported.records.length+" sources; no automatic writes."));
  }
}
class ScraperSettings extends PluginSettingTab {
  constructor(app:Plugin["app"],private plugin:ScraperPlugin){super(app,plugin);}
  display():void{
    const root=this.containerEl;root.empty();
    root.createEl("h2",{text:"Source Scraper"});
    paragraph(root,"MCP: "+this.plugin.mcpStatus);
    new Setting(root).setName("Allow local read-only X feed access")
      .setDesc("Off by default. Uses the locally supplied session directly with X through Twifork. No paid API or third-party session service. This does not start collection.")
      .addToggle(t=>t.setValue(this.plugin.settings.xProviderEnabled==="true").onChange(async v=>{
        if(!v)await this.plugin.forgetLocalSession();else{this.plugin.settings.xProviderEnabled="true";await this.plugin.savePrefs();}
      }));
    new Setting(root).setName("Isolated Python for Twifork")
      .setDesc("Absolute interpreter path for the project-local Twifork 2.4.0 environment; not accepted through remote tool arguments.")
      .addText(t=>t.setValue(this.plugin.settings.xPythonPath).onChange(async v=>{this.plugin.settings.xPythonPath=v.trim();await this.plugin.savePrefs();}));
    new Setting(root).setName("Expose tools through Vault as MCP")
      .setDesc("Requires the locally enabled provider API. Collection never creates final notes.")
      .addToggle(t=>t.setValue(this.plugin.settings.mcpEnabled==="true").onChange(async v=>{
        this.plugin.settings.mcpEnabled=String(v);await this.plugin.savePrefs();
      }));
    for(const [key,label] of [["mcpProjectsJson","Trusted project registry JSON"],["mcpWorkspacePath","MCP project workspace"],["mcpCliHash","Trusted CLI SHA-256"]] as const){
      new Setting(root).setName(label).addTextArea(t=>t.setValue(this.plugin.settings[key]).onChange(async v=>{
        this.plugin.settings[key]=v;await this.plugin.savePrefs();
      }));
    }
    paragraph(root,"JSON import works without Node. The CLI is optional, executes only when you explicitly click Run, and may contact your configured sources.");
    new Setting(root).setName("Default destination folder")
      .setDesc("Optional suggested folder for Markdown drafts. This plugin never creates notes.")
      .addText(t=>t.setPlaceholder("Source Scraper/Imported")
        .setValue(this.plugin.settings.outputFolder).onChange(async value=>{
          this.plugin.settings.outputFolder=value;await this.plugin.savePrefs();
        }));
    new Setting(root).setName("Portable note mapping")
      .setDesc("Configure extra frontmatter properties, optional note sections and a title field. This never changes existing notes.")
      .addButton(b=>b.setButtonText("Edit mapping JSON")
        .onClick(()=>new NoteMappingModal(this.app,this.plugin).open()));
    new Setting(root).setName("Trusted standalone Source Scraper CLI")
      .setDesc("Absolute path to a locally installed source-scraper.mjs; never auto-downloaded.")
      .addText(t=>t.setValue(this.plugin.settings.cliPath).onChange(async value=>{
        this.plugin.settings.cliPath=value.trim();await this.plugin.savePrefs();
      }));
    new Setting(root).setName("Explicit project JSON manifest")
      .setDesc("Local manifest to run only when you press Run. Use Project JSON editor to create a new config without overwriting existing files.")
      .addText(t=>t.setValue(this.plugin.settings.configPath).onChange(async value=>{
        this.plugin.settings.configPath=value.trim();await this.plugin.savePrefs();
      }));
    new Setting(root).setName("Node executable")
      .setDesc("Node.js 22.16+ required only for optional CLI execution.")
      .addText(t=>t.setValue(this.plugin.settings.nodeExecutable).onChange(async value=>{
        this.plugin.settings.nodeExecutable=value.trim();await this.plugin.savePrefs();
      }));
  }
}
export default class ScraperPlugin extends Plugin {
  settings:Preferences={...defaults};
  imported:EntityExport|null=null;
  selected=new Set<string>();
  readonly cli=new CliBridge();
  mcpStatus="disabled";
  private statusItem?:HTMLElement;
  private popover?:ScraperPopover;
  private review?:ScraperReview;
  private memorySession?:XLocalSession;
  private unloaded=false;
  private uiJobId?:string;
  private uiPolling=false;
  private uiStarting=false;
  private uiError="";
  private uiMessage="";
  private projectCache?:{key:string;projects:PanelProject[]};
  private provider?:SourceScraperProvider;
  private providerHost?:unknown;
  private providerSignature="";
  private disposeProvider?:()=>void;
  async onload():Promise<void>{
    const stored=await this.loadData() as Partial<Preferences>|null;
    if(stored&&typeof stored==="object"){
      for(const key of Object.keys(defaults) as (keyof Preferences)[]){
        if(typeof stored[key]==="string")this.settings[key]=stored[key];
      }
    }
    this.registerView(VIEW_TYPE,leaf=>new LegacyScraperView(leaf));
    this.statusItem=this.addStatusBarItem();this.statusItem.addClass("mod-clickable","ss-status");
    this.statusItem.setAttribute("role","button");this.statusItem.setAttribute("aria-haspopup","dialog");this.statusItem.setAttribute("aria-expanded","false");this.statusItem.tabIndex=0;
    this.statusItem.createSpan({text:"Source Scraper"});
    this.registerDomEvent(this.statusItem,"click",()=>{if(this.popover?.isOpen)this.closePopover(true);else void this.openView();});
    this.registerDomEvent(this.statusItem,"keydown",event=>{
      if((event.key==="Enter"||event.key===" ")&&!event.repeat){event.preventDefault();if(this.popover?.isOpen)this.closePopover(true);else void this.openView();}
    });
    this.addCommand({id:"open-panel",name:"Open Source Scraper",callback:()=>{void this.openView();}});
    this.addSettingTab(new ScraperSettings(this.app,this));
    this.app.workspace.onLayoutReady(()=>{
      if(this.unloaded)return;
      this.app.workspace.detachLeavesOfType(VIEW_TYPE);this.placeStatus();this.connectMcp();this.updateStatus();
      const parent=this.statusItem?.parentElement,Observer=this.statusItem?.ownerDocument.defaultView?.MutationObserver;
      if(parent&&Observer){const observer=new Observer(()=>this.placeStatus());observer.observe(parent,{childList:true});this.register(()=>observer.disconnect());}
    });
    this.registerInterval(window.setInterval(()=>this.connectMcp(),3000));
    this.registerInterval(window.setInterval(()=>{this.updateStatus();void this.pollUiJob();},1000));
    this.updateStatus();
  }
  onunload():void{this.unloaded=true;this.closePopover();this.memorySession=undefined;this.disposeProvider?.();this.provider?.dispose();this.cli.cancel();}
  async savePrefs():Promise<void>{await this.saveData(this.settings);this.projectCache=undefined;this.connectMcp();this.updateStatus();}
  localSession():XLocalSession|undefined{return this.memorySession;}
  async forgetLocalSession():Promise<void>{this.memorySession=undefined;this.settings.xProviderEnabled="false";this.uiMessage="Local X session disconnected.";await this.savePrefs();}
  async useLocalSession(session:XLocalSession):Promise<void>{
    const previous=this.memorySession,allowed=this.settings.xProviderEnabled;
    this.memorySession={...session};this.settings.xProviderEnabled="true";
    try{await this.savePrefs();this.uiError="";this.uiMessage="Local X session loaded. Collect a small sample to verify the feed.";}
    catch(error){this.memorySession=previous;this.settings.xProviderEnabled=allowed;throw error;}
    this.updateStatus();
  }
  registeredProjects():RegisteredProject[]{
    if(this.provider)return this.provider.localProjects();
    try{const list=JSON.parse(this.settings.mcpProjectsJson);return Array.isArray(list)?list.filter(p=>p&&typeof p.id==="string"&&typeof p.configPath==="string"):[];}catch{return [];}
  }
  private projectsForPanel():PanelProject[]{
    const list=this.registeredProjects(),key=JSON.stringify(list);
    if(this.projectCache?.key===key)return this.projectCache.projects;
    const projects=list.map(p=>{
      try{
        if(statSync(p.configPath).size>200000)throw Error("Manifest limit");
        const manifest=parseProjectManifest(readFileSync(p.configPath,"utf8"));
        return {id:p.id,name:manifest.name,isX:manifest.sources.some(s=>s.adapter==="x-for-you-local"),minimumScore:manifest.policy.minimumScore};
      }catch{return {id:p.id,name:p.id.replace(/[-_]/g," "),isX:false,minimumScore:0};}
    });
    this.projectCache={key,projects};return projects;
  }
  isCollecting():boolean{return this.uiStarting||this.cli.running||Boolean(this.provider?.activity().running);}
  private panelSnapshot():PanelSnapshot{
    const list=this.registeredProjects(),projects=this.projectsForPanel(),readiness=xFeedReadiness(this.memorySession);
    const activity=this.provider?.activity();
    return {engine:Boolean(this.settings.cliPath&&existsSync(this.settings.cliPath)),mcp:Boolean(this.provider),python:Boolean(this.settings.xPythonPath&&existsSync(this.settings.xPythonPath)),
      session:readiness.accountSessionConfigured&&readiness.csrfConfigured,xAllowed:this.settings.xProviderEnabled==="true",
      projects,projectId:list.find(p=>p.configPath===this.settings.configPath)?.id||"",findings:this.imported?.records.length??0,
      findingProject:projects.find(p=>p.id===this.imported?.projectId)?.name||this.imported?.projectId||"",
      running:this.isCollecting(),error:this.uiError||(activity?.lastState==="failed"?activity.error:undefined),message:this.uiMessage};
  }
  private placeStatus():void{
    const item=this.statusItem,parent=item?.parentElement;if(!item||!parent)return;
    const chat=parent.querySelector<HTMLElement>(".cmt-status");
    if(chat?.parentElement===parent&&chat.nextElementSibling!==item)chat.after(item);
  }
  private updateStatus(dataChanged=false):void{
    if(this.unloaded||!this.statusItem)return;
    const state=panelState(this.panelSnapshot()),label="Source Scraper. "+state.title+". Open Source Scraper.";
    if(this.statusItem.dataset.state!==state.state)this.statusItem.dataset.state=state.state;
    if(this.statusItem.title!==label)this.statusItem.title=label;
    if(this.statusItem.getAttribute("aria-label")!==label)this.statusItem.setAttribute("aria-label",label);
    this.popover?.update(dataChanged);
  }
  closePopover(restoreFocus=false):void{this.popover?.close(restoreFocus);}
  private async collectSelected():Promise<void>{
    if(this.isCollecting()||this.unloaded)return;
    const provider=this.provider,id=this.panelSnapshot().projectId;if(!provider||!id)return;
    this.uiStarting=true;this.uiError="";this.uiMessage="Starting explicit collection…";this.updateStatus();
    try{
      const job=await provider.execute("source_scraper_run_project",{projectId:id,requestId:"obsidian-ui-"+randomUUID(),pageSize:100,maxPages:10}) as {id:string};
      if(!this.unloaded)this.uiJobId=job.id;
    }catch(error){this.uiError=errorMessage(error);this.uiMessage="";}
    finally{this.uiStarting=false;this.updateStatus();}
  }
  private async pollUiJob():Promise<void>{
    if(this.unloaded||!this.uiJobId||!this.provider||this.uiPolling)return;
    this.uiPolling=true;const provider=this.provider,jobId=this.uiJobId;
    try{
      const job=await provider.execute("source_scraper_get_run_status",{jobId}) as {state:string;projectId:string;error?:string};
      if(this.unloaded||provider!==this.provider||jobId!==this.uiJobId)return;
      if(["running","queued","cancelling"].includes(job.state))return;
      this.uiJobId=undefined;
      if(job.state!=="succeeded"){this.uiError=job.error||"Collection "+job.state;this.uiMessage="";return;}
      this.uiStarting=true;
      const minimum=this.projectsForPanel().find(p=>p.id===job.projectId)?.minimumScore??0;
      const data=await provider.execute("source_scraper_list_findings",{projectId:job.projectId,minScore:minimum,limit:100}) as {records:EntityRecord[]};
      if(this.unloaded||provider!==this.provider)return;
      const keys:string[]=[];for(const entity of data.records){if(Buffer.byteLength(JSON.stringify([...keys,entity.key]),"utf8")>12000)break;keys.push(entity.key);}
      if(keys.length)await provider.execute("source_scraper_stage_findings",{projectId:job.projectId,keys});
      else this.setImported({schemaVersion:1,dataset:"entities",projectId:job.projectId,records:[]});
      if(!this.unloaded){this.uiMessage=keys.length+" candidates meet the project relevance filter. Open review to inspect quality.";this.uiError="";}
    }catch(error){if(!this.unloaded&&provider===this.provider){this.uiError=errorMessage(error);this.uiJobId=undefined;}}
    finally{this.uiStarting=false;this.uiPolling=false;this.updateStatus();}
  }
  private connectMcp():void{
    const host=(this.app as unknown as {plugins:{getPlugin(id:string):any}}).plugins.getPlugin("vault-as-mcp");
    const signature=JSON.stringify(this.settings);
    if(host===this.providerHost&&signature===this.providerSignature&&this.provider)return;
    this.disposeProvider?.();this.provider?.dispose();this.provider=undefined;this.disposeProvider=undefined;
    this.providerHost=host;this.providerSignature=signature;
    if(this.settings.mcpEnabled!=="true"){this.mcpStatus="disabled";return;}
    if(host?.toolProviderApiVersion!==1){this.mcpStatus="compatible Vault as MCP provider API required";return;}
    try{
      if(!(this.app.vault.adapter instanceof FileSystemAdapter))throw Error("Desktop filesystem vault required");
      const projects=JSON.parse(this.settings.mcpProjectsJson) as RegisteredProject[];
      if(!Array.isArray(projects)||projects.length>100||projects.some(p=>!p||typeof p.id!=="string"||typeof p.configPath!=="string"||!/^[a-f0-9]{64}$/.test(p.manifestHash)))throw Error("Invalid local project registry");
      if(new Set(projects.map(p=>p.id)).size!==projects.length)throw Error("Duplicate registered projects");
      const vaultPath=this.app.vault.adapter.getBasePath();
      const vaultId=createHash("sha256").update(vaultPath).digest("hex").slice(0,24);
      const provider=new SourceScraperProvider({cliPath:this.settings.cliPath,cliHash:this.settings.mcpCliHash,
        allowXProvider:this.settings.xProviderEnabled==="true",
        xPythonPath:this.settings.xPythonPath,
        getXSession:()=>this.memorySession,
        nodeExecutable:this.settings.nodeExecutable,projects,workspacePath:this.settings.mcpWorkspacePath,
        statePath:join(process.env.LOCALAPPDATA||join(homedir(),".local","share"),"SourceScraper",vaultId,"state.json"),
        vaultPath,pathExists:path=>Boolean(this.app.vault.getAbstractFileByPath(path)),mapping:()=>this.settings.noteMappingJson,
        checkRead:path=>host.checkToolReadAccess(path),
        stage:value=>{this.setImported(value);},
        readReference:async path=>{const file=this.app.vault.getAbstractFileByPath(path);if(!(file instanceof TFile))throw Error("Reference note missing");return this.app.vault.read(file);}
      });
      this.disposeProvider=host.registerToolProvider(provider);this.provider=provider;this.mcpStatus="connected; 15 tools registered; vault notes read-only";
      void provider.restoreQueue().catch(()=>{this.mcpStatus="connected; prior queue needs explicit reload (missing or changed project)";});
    }catch(error){this.mcpStatus=errorMessage(error);}
  }
  async showAgentAssessments(entity:EntityRecord,root:HTMLElement):Promise<void>{
    if(!this.provider)return;
    try{
      const result=await this.provider.execute("source_scraper_list_assessments",{projectId:entity.projectId,key:entity.key,limit:10});
      if(!root.isConnected)return;
      root.createEl("h4",{text:"Agent recommendations — separate from human reviews"});
      const pre=root.createEl("pre",{cls:"ss-preview"});pre.setText(JSON.stringify(result,null,2));
    }catch{paragraph(root,"Agent recommendations unavailable for this project; no human review was changed.");}
  }
  setImported(data:EntityExport):void{this.imported=data;this.selected.clear();this.refresh();}
  getSelected():EntityRecord[]{
    return (this.imported?.records??[]).filter(x=>this.selected.has(x.key));
  }
  refresh():void{
    this.updateStatus(true);
  }
  async openView():Promise<void>{
    if(this.unloaded||!this.statusItem)return;
    if(!this.popover)this.popover=new ScraperPopover(this.statusItem,{
      snapshot:()=>this.panelSnapshot(),icon:(root,name)=>setIcon(root,name),
      settings:()=>{(this.app as unknown as {setting:{open():void;openTabById(id:string):void}}).setting.open();(this.app as unknown as {setting:{openTabById(id:string):void}}).setting.openTabById(this.manifest.id);},
      setup:()=>new XFeedSetupModal(this.app,this).open(),
      importFindings:()=>new ImportModal(this.app,this).open(),
      disconnect:()=>{void this.forgetLocalSession().catch(notify);},
      collect:()=>{void this.collectSelected();},
      cancel:()=>{const jobId=this.uiJobId||this.provider?.activity().jobId;if(jobId&&this.provider)void this.provider.execute("source_scraper_cancel_run",{jobId}).catch(notify);else this.cli.cancel();},
      selectProject:id=>{
        if(this.isCollecting())return;
        const p=this.registeredProjects().find(p=>p.id===id);if(p){this.settings.configPath=p.configPath;this.uiError="";this.uiMessage="";void this.savePrefs().catch(notify);}
      },
      renderReview:root=>{this.review??=new ScraperReview(undefined,this);this.review.mount(root);},unmountReview:()=>this.review?.unmount()
    });
    this.popover.open();
  }
}
