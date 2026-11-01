import {
  FileSystemAdapter,ItemView,Modal,Notice,Plugin,PluginSettingTab,
  Setting,WorkspaceLeaf,TFile
} from "obsidian";
import {parseExport,type EntityExport,type EntityRecord} from "./contracts.ts";
import {selectedPlans} from "./vault-writer.ts";
import {CliBridge} from "./cli-bridge.ts";
import {SourceScraperProvider,writeWorkspaceProject,type RegisteredProject} from "./mcp-provider.ts";
import {buildXFeedProject,xFeedReadiness} from "./x-feed.ts";
import {createHash} from "node:crypto";
import {homedir} from "node:os";
import {join} from "node:path";
import {GENERIC_TEMPLATE,parseProjectManifest} from "./project-manifest.ts";
import {DEFAULT_NOTE_MAPPING_JSON,parseNoteMapping} from "./note-mapping.ts";

const VIEW_TYPE="source-scraper-view";
interface Preferences {
  xProviderEnabled:string;
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
const defaults:Preferences={xProviderEnabled:"false",mcpEnabled:"false",mcpProjectsJson:"[]",mcpCliHash:"",mcpWorkspacePath:"",outputFolder:"",cliPath:"",configPath:"",nodeExecutable:"node",
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
            cliPath:s.cliPath,configPath:s.configPath,nodeExecutable:s.nodeExecutable,allowXProvider:s.xProviderEnabled==="true"
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
  constructor(app:Plugin["app"],private plugin:ScraperPlugin){super(app);}
  onOpen():void{
    const root=this.contentEl;root.empty();root.createEl("h3",{text:"X For You source setup"});
    paragraph(root,"This optional source uses GetXAPI, an independent provider that receives your X account session and charges per request. Its documented price is $0.001 per request (approximately 20 posts). Live feed access has not been verified in this build.");
    paragraph(root,"Do not paste credentials here or into ChatGPT. Supply SOURCE_SCRAPER_GETXAPI_API_KEY and SOURCE_SCRAPER_X_ACCOUNT_SESSION through the local process environment before starting Obsidian. This plugin never extracts a browser session.");
    const readiness=xFeedReadiness();
    paragraph(root,"Local grant: "+(this.plugin.settings.xProviderEnabled==="true"?"enabled":"disabled")+
      ". Provider key: "+(readiness.apiKeyConfigured?"configured":"missing")+". Account session: "+(readiness.accountSessionConfigured?"configured":"missing")+".");
    paragraph(root,"Creating the project does not contact X or GetXAPI. Enable the separate local provider grant in settings only after approving the provider, account access and cost.");
    let accountId="",include="react, frontend, css, gsap, motion, typography, design system, open source",exclude="sponsored, giveaway",minimum=50,pages=1;
    new Setting(root).setName("Numeric X account ID").addText(t=>t.setPlaceholder("Connected account's numeric ID").onChange(v=>{accountId=v.trim();}));
    new Setting(root).setName("Include terms (editable suggestions)").addTextArea(t=>t.setValue(include).onChange(v=>{include=v;}));
    new Setting(root).setName("Exclude terms").addTextArea(t=>t.setValue(exclude).onChange(v=>{exclude=v;}));
    new Setting(root).setName("Suggested minimum relevance score (0–100)").addText(t=>t.setValue(String(minimum)).onChange(v=>{minimum=Number(v);}));
    new Setting(root).setName("Provider pages per explicit run (1–10)").addText(t=>t.setValue(String(pages)).onChange(v=>{pages=Number(v);}));
    const status=root.createEl("p");
    new Setting(root).addButton(b=>b.setButtonText("Prepare project outside vault (no collection)").setCta().onClick(async()=>{
      try{
        if(!(this.app.vault.adapter instanceof FileSystemAdapter))throw Error("A desktop filesystem vault is required");
        const s=this.plugin.settings,manifest=buildXFeedProject(accountId,include,exclude,minimum,pages);
        const projects=JSON.parse(s.mcpProjectsJson) as RegisteredProject[];
        if(!Array.isArray(projects)||projects.length>=100||projects.some(p=>p.id===manifest.id))throw Error("Project registry is full or this X project already exists");
        const project=writeWorkspaceProject(s.mcpWorkspacePath,this.app.vault.adapter.getBasePath(),manifest);
        s.mcpProjectsJson=JSON.stringify([...projects,project]);s.configPath=project.configPath;
        await this.plugin.savePrefs();status.setText("Prepared "+project.id+" outside the vault. No provider request or note write occurred.");
      }catch(error){status.setText(errorMessage(error));}
    }));
  }
  onClose():void{this.contentEl.empty();}
}
class ScraperView extends ItemView {
  private page=0;
  private search="";
  constructor(leaf:WorkspaceLeaf,private plugin:ScraperPlugin){super(leaf);}
  getViewType():string{return VIEW_TYPE;}
  getDisplayText():string{return "Source Scraper";}
  getIcon():string{return "database";}
  async onOpen():Promise<void>{this.render();}
  async onClose():Promise<void>{}
  render():void{
    const root=this.containerEl.children[1] as HTMLElement;
    root.empty();root.addClass("source-scraper-view");
    root.createEl("h2",{text:"Source Scraper"});
    paragraph(root,"Collect, inspect and preview candidates. Only ChatGPT writes notes through the separate Obsidian connector on your instruction.");
    const controls=root.createDiv({cls:"ss-controls"});
    const action=(text:string,click:()=>void)=>{
      const button=controls.createEl("button",{text});
      button.addEventListener("click",click);
      return button;
    };
    action("Import JSON / NDJSON",()=>new ImportModal(this.app,this.plugin).open());
    action("Project JSON editor",()=>new ProjectModal(this.app,this.plugin).open());
    action("Note mapping",()=>new NoteMappingModal(this.app,this.plugin).open());
    action("Run local CLI (optional)",()=>new RunModal(this.app,this.plugin).open());
    action("X feed setup",()=>new XFeedSetupModal(this.app,this.plugin).open());
    action("Diagnostics",()=>{
      new Notice("Engine CLI: "+(this.plugin.settings.cliPath?"configured":"not connected")+
        "; JSON: "+(this.plugin.imported?.records.length??0)+" records; no automatic writes.");
    });
    const imported=this.plugin.imported;
    if(!imported){
      paragraph(root,"No data imported. Nothing is collected or written automatically.");
      return;
    }
    root.createEl("p",{cls:"ss-count",text:
      "Project: "+imported.projectId+" · "+imported.records.length+
      " entities · Selected: "+this.plugin.selected.size});
    const filter=new Setting(root).setName("Search records");
    filter.addText(t=>t.setPlaceholder("Any title, key or type")
      .setValue(this.search).onChange(value=>{
        const cursor=t.inputEl.selectionStart??value.length;
        this.search=value;this.page=0;this.render();
        // Keep focus and caret when filtering: otherwise every keystroke
        // destroys the text input and makes multi-character searches unusable.
        const restored=root.querySelector<HTMLInputElement>(
          'input[placeholder="Any title, key or type"]');
        if(restored){
          restored.focus();
          const position=Math.min(cursor,value.length);
          restored.setSelectionRange(position,position);
        }
      }));
    const filtered=imported.records.filter(e=>
      [e.title,e.key,e.type,e.category].some(v=>v.toLowerCase().includes(this.search.toLowerCase())));
    const pageSize=40;
    const pageCount=Math.max(1,Math.ceil(filtered.length/pageSize));
    this.page=Math.min(this.page,pageCount-1);
    const visible=filtered.slice(this.page*pageSize,(this.page+1)*pageSize);
    const pageRow=root.createDiv({cls:"ss-controls"});
    const prev=pageRow.createEl("button",{text:"Previous"});
    prev.disabled=this.page===0;prev.onclick=()=>{this.page--;this.render();};
    paragraph(pageRow,"Page "+(this.page+1)+" / "+pageCount+" ("+filtered.length+" matches)");
    const next=pageRow.createEl("button",{text:"Next"});
    next.disabled=this.page>=pageCount-1;next.onclick=()=>{this.page++;this.render();};
    for(const entity of visible){
      const item=root.createDiv({cls:"ss-record"});
      new Setting(item).setName(entity.title).setDesc(entity.type+" · "+entity.key)
        .addToggle(toggle=>toggle.setValue(this.plugin.selected.has(entity.key))
          .onChange(checked=>{
            if(checked)this.plugin.selected.add(entity.key);
            else this.plugin.selected.delete(entity.key);
            this.render();
          }));
      item.createEl("div",{cls:"ss-record-meta",text:
        "Machine score: "+entity.score+" · Review: "+entity.review+
        " · Evidence mentions: "+(entity.provenance?.mentions.length??"not exported")});
      const inspect=item.createEl("button",{text:"Inspect data and evidence"});
      inspect.onclick=()=>new DetailModal(this.app,this.plugin,entity).open();
    }
    const selected=this.plugin.getSelected();
    const exportButton=action("Preview selected drafts",()=>{
      try{
        if(!selected.length)throw new Error("Select records before previewing notes");
        if(selected.length>200)throw new Error("Select no more than 200 records per export");
        new ExportModal(this.app,this.plugin,selected).open();
      }catch(error){notify(error);}
    });
    exportButton.disabled=selected.length===0;
    paragraph(root,"Source Scraper never creates or changes vault notes. Only ChatGPT may write through the separate Obsidian connector when you explicitly order it.");
  }
}
class ScraperSettings extends PluginSettingTab {
  constructor(app:Plugin["app"],private plugin:ScraperPlugin){super(app,plugin);}
  display():void{
    const root=this.containerEl;root.empty();
    root.createEl("h2",{text:"Source Scraper"});
    paragraph(root,"MCP: "+this.plugin.mcpStatus);
    new Setting(root).setName("Allow GetXAPI account access and paid X requests")
      .setDesc("Off by default. Enabling allows GetXAPI to receive the locally supplied X account session; documented price $0.001/request, at most 10 pages per source window. No credentials are extracted from your browser. This does not start collection.")
      .addToggle(t=>t.setValue(this.plugin.settings.xProviderEnabled==="true").onChange(async v=>{
        this.plugin.settings.xProviderEnabled=String(v);await this.plugin.savePrefs();
      }));
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
    this.registerView(VIEW_TYPE,leaf=>new ScraperView(leaf,this));
    this.addRibbonIcon("database","Source Scraper",()=>{void this.openView();});
    this.addCommand({id:"open-panel",name:"Open Source Scraper",callback:()=>{void this.openView();}});
    this.addSettingTab(new ScraperSettings(this.app,this));
    this.app.workspace.onLayoutReady(()=>this.connectMcp());
    this.registerInterval(window.setInterval(()=>this.connectMcp(),3000));
  }
  onunload():void{this.disposeProvider?.();this.provider?.dispose();this.cli.cancel();}
  async savePrefs():Promise<void>{await this.saveData(this.settings);this.connectMcp();}
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
        nodeExecutable:this.settings.nodeExecutable,projects,workspacePath:this.settings.mcpWorkspacePath,
        statePath:join(process.env.LOCALAPPDATA||join(homedir(),".local","share"),"SourceScraper",vaultId,"state.json"),
        vaultPath,pathExists:path=>Boolean(this.app.vault.getAbstractFileByPath(path)),mapping:()=>this.settings.noteMappingJson,
        checkRead:path=>host.checkToolReadAccess(path),
        stage:value=>{this.setImported(value);void this.openView();},
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
    for(const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)){
      const view=leaf.view;
      if(view instanceof ScraperView)view.render();
    }
  }
  async openView():Promise<void>{
    const leaf=this.app.workspace.getRightLeaf(false)??this.app.workspace.getLeaf(true);
    await leaf.setViewState({type:VIEW_TYPE,active:true});
    await this.app.workspace.revealLeaf(leaf);
  }
}
