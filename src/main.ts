import {
  FileSystemAdapter,ItemView,Modal,Notice,Plugin,PluginSettingTab,
  Setting,WorkspaceLeaf,TFile
} from "obsidian";
import {parseExport,type EntityExport,type EntityRecord} from "./contracts.ts";
import {selectedPlans,createOnlyNotes} from "./vault-writer.ts";
import {CliBridge} from "./cli-bridge.ts";
import {folderPath} from "./render.ts";

const VIEW_TYPE="source-scraper-view";
interface Preferences {
  outputFolder:string;
  cliPath:string;
  configPath:string;
  nodeExecutable:string;
}
const defaults:Preferences={outputFolder:"",cliPath:"",configPath:"",nodeExecutable:"node"};
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
  private busy=false;
  constructor(app:Plugin["app"],private plugin:ScraperPlugin,
    private records:EntityRecord[]){
    super(app);this.folder=plugin.settings.outputFolder;
  }
  onOpen():void{
    const root=this.contentEl;root.empty();root.addClass("source-scraper-modal");
    root.createEl("h3",{text:"Preview create-only notes"});
    paragraph(root,"Only the selected records will be created. Existing files will NEVER be modified, replaced, renamed or deleted.");
    const preview=root.createEl("pre",{cls:"ss-preview"});
    const refresh=()=>{
      try{
        const plans=selectedPlans(this.folder,this.records);
        preview.setText(plans.map(x=>x.path).join("\n")+
          (plans.length?"\n\nFirst note preview:\n\n"+plans[0].content.slice(0,3500):""));
      }catch(error){preview.setText(errorMessage(error));}
    };
    new Setting(root).setName("Vault-relative destination folder")
      .setDesc("Choose a folder explicitly. Do not use an existing references file.")
      .addText(t=>t.setPlaceholder("Source Scraper/Imported")
        .setValue(this.folder).onChange(value=>{this.folder=value;refresh();}));
    refresh();
    new Setting(root).addButton(b=>b.setButtonText("Create new notes only")
      .setCta().onClick(async()=>{
        if(this.busy)return;
        this.busy=true;
        try{
          const folder=folderPath(this.folder);
          if(!this.records.length)throw new Error("Select at least one entity");
          const adapter=this.app.vault.adapter;
          const rootPath=adapter instanceof FileSystemAdapter?adapter.getBasePath():undefined;
          const result=await createOnlyNotes(this.app.vault,folder,this.records,rootPath);
          this.plugin.settings.outputFolder=folder;
          await this.plugin.savePrefs();
          this.close();
          this.plugin.refresh();
          new Notice("Created "+result.created+" new notes. Existing paths preserved: "+
            result.conflicts.length+".",7000);
        }catch(error){notify(error);}
        finally{this.busy=false;}
      }));
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
            cliPath:s.cliPath,configPath:s.configPath,nodeExecutable:s.nodeExecutable
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
    paragraph(root,"Import, examine, preview and safely create notes from any JSON v1 project.");
    const controls=root.createDiv({cls:"ss-controls"});
    const action=(text:string,click:()=>void)=>{
      const button=controls.createEl("button",{text});
      button.addEventListener("click",click);
      return button;
    };
    action("Import JSON / NDJSON",()=>new ImportModal(this.app,this.plugin).open());
    action("Run local CLI (optional)",()=>new RunModal(this.app,this.plugin).open());
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
      .setValue(this.search).onChange(value=>{this.search=value;this.page=0;this.render();}));
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
    const exportButton=action("Preview and create selected notes",()=>{
      try{
        if(!selected.length)throw new Error("Select records before previewing notes");
        if(selected.length>200)throw new Error("Select no more than 200 records per export");
        new ExportModal(this.app,this.plugin,selected).open();
      }catch(error){notify(error);}
    });
    exportButton.disabled=selected.length===0;
    paragraph(root,"No existing note or reference will be overwritten, even when importing the same data twice.");
  }
}
class ScraperSettings extends PluginSettingTab {
  constructor(app:Plugin["app"],private plugin:ScraperPlugin){super(app,plugin);}
  display():void{
    const root=this.containerEl;root.empty();
    root.createEl("h2",{text:"Source Scraper"});
    paragraph(root,"JSON import works without Node. The CLI is optional, executes only when you explicitly click Run, and may contact your configured sources.");
    new Setting(root).setName("Default destination folder")
      .setDesc("No destination is chosen until you set it. Creates new notes only.")
      .addText(t=>t.setPlaceholder("Source Scraper/Imported")
        .setValue(this.plugin.settings.outputFolder).onChange(async value=>{
          this.plugin.settings.outputFolder=value;await this.plugin.savePrefs();
        }));
    new Setting(root).setName("Trusted standalone Source Scraper CLI")
      .setDesc("Absolute path to a locally installed source-scraper.mjs; never auto-downloaded.")
      .addText(t=>t.setValue(this.plugin.settings.cliPath).onChange(async value=>{
        this.plugin.settings.cliPath=value.trim();await this.plugin.savePrefs();
      }));
    new Setting(root).setName("Explicit project JSON manifest")
      .setDesc("Local manifest to run when the user presses Run.")
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
  }
  onunload():void{this.cli.cancel();}
  async savePrefs():Promise<void>{await this.saveData(this.settings);}
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
