import {ResourceInbox} from "./resource-inbox.ts";
import {dialog,action,formStatus,labelFields} from "./form-ui.ts";
import {feedFilterForm,applyFeedFilterForm} from "./filter-form.ts";
import {ReviewIndex} from "./review-index.ts";
import {BatchReviewModal} from "./batch-review-modal.ts";
import {MAX_REVIEW_SELECTION,selectReviewPage,runReviewBatch,type ReviewChange,type ReviewResult} from "./review-batch.ts";
import {XSessionStore} from "./x-session-store.ts";
import {
  FileSystemAdapter,ItemView,Modal,Notice,Plugin,PluginSettingTab,
  Setting,TFile,setIcon,ButtonComponent,SearchComponent
} from "obsidian";
import {parseExport,type EntityExport,type EntityRecord} from "./contracts.ts";
import {selectedPlans} from "./vault-writer.ts";
import {CliBridge,type XLocalSession} from "./cli-bridge.ts";
import {SourceScraperProvider,writeWorkspaceProject,type RegisteredProject} from "./mcp-provider.ts";
import {buildXFeedProject,xFeedReadiness,validateLocalSession,normalizeXAccountId,xFeedVariant} from "./x-feed.ts";
import {ScraperPopover} from "./status-popover.ts";
import {discoveryState,type PanelSnapshot,type PanelProject} from "./panel-model.ts";
import {createHash,randomUUID} from "node:crypto";
import {homedir} from "node:os";
import {join} from "node:path";
import {existsSync,readFileSync,statSync} from "node:fs";
import {GENERIC_TEMPLATE,parseProjectManifest} from "./project-manifest.ts";
import {DEFAULT_NOTE_MAPPING_JSON,parseNoteMapping} from "./note-mapping.ts";

const VIEW_TYPE="source-scraper-view";
interface Preferences {
  xProviderEnabled:string;
  xLikesEnabled:string;
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
const defaults:Preferences={xLikesEnabled:"false",xProviderEnabled:"false",xPythonPath:"",mcpEnabled:"false",mcpProjectsJson:"[]",mcpCliHash:"",mcpWorkspacePath:"",outputFolder:"",cliPath:"",configPath:"",nodeExecutable:"node",
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
    const {body:root,footer}=dialog(this,"Import results",false);
    action(footer,"Close",()=>this.close());
    paragraph(root,"Paste engine results or choose a file from your vault.");
    const files=this.app.vault.getFiles().filter(file=>/\.(json|ndjson)$/i.test(file.path));
    new Setting(root).setName("Vault JSON file")
      .setDesc("You can also paste results below.")
      .addDropdown(d=>{
        d.addOption("","Paste results");
        for(const file of files.slice(0,200))d.addOption(file.path,file.path);
        d.setValue("").onChange(value=>{this.selectedFile=value;input.disabled=Boolean(value);});
      });
    const input=root.createEl("textarea",{cls:"ss-code-input",attr:{rows:"8","aria-label":"JSON or NDJSON results",placeholder:"Paste engine results as JSON or NDJSON"}});
    input.addEventListener("input",()=>{this.pasted=input.value;});
    new Setting(footer).addButton(b=>b.setButtonText("Import")
      .setCta().onClick(async()=>{
        try{
          let text=this.selectedFile?"":this.pasted;
          if(!text.trim()&&this.selectedFile){
            const file=this.app.vault.getAbstractFileByPath(this.selectedFile);
            if(!(file instanceof TFile))throw new Error("The results file is no longer available.");
            if(file.stat.size>8_000_000)throw new Error("The file exceeds the 8 MB import limit.");
            text=await this.app.vault.read(file);
          }
          this.plugin.setImported(parseExport(text));
          this.close();
          await this.plugin.openView(true);
        }catch(error){notify(error);}
      }));
    labelFields(root);
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
    const {body:root,footer}=dialog(this,"Edit project",true);
    action(footer,"Close",()=>this.close());
    paragraph(root,"Edit a Source Scraper project. Validation does not collect sources or write notes.");
    const candidates=this.app.vault.getFiles()
      .filter(f=>f.extension==="json"&&f.stat.size<=200000);
    new Setting(root).setName("Existing project")
      .setDesc("Open an existing JSON file without changing it.")
      .addDropdown(d=>{
        d.addOption("","Use template");
        for(const file of candidates.slice(0,200))d.addOption(file.path,file.path);
        d.onChange(async path=>{
          this.selectedPath=path;
          if(!path)return;
          try{
            const file=this.app.vault.getAbstractFileByPath(path);
            if(!(file instanceof TFile))throw Error("The project file is no longer available.");
            const input=await this.app.vault.read(file);
            const manifest=parseProjectManifest(input);
            this.body=JSON.stringify(manifest,null,2);
            area.value=this.body;
            status.setText("Project loaded: "+manifest.id+". The file has not changed.");
          }catch(error){notify(error);}
        });
      });
    const area=root.createEl("textarea",{
      cls:"ss-code-input",attr:{rows:"12","aria-label":"Project configuration as JSON",placeholder:"Project configuration as JSON"}
    });
    area.value=this.body;
    area.addEventListener("input",()=>{
      this.body=area.value;
      // Once edited, do not claim that the selected existing file is identical.
      this.selectedPath="";
    });
    const status=root.createEl("pre",{cls:"ss-preview"});
    status.setText("Validate the JSON first. Create new projects in the external workspace through MCP.");
    new Setting(footer).addButton(b=>b.setButtonText("Validate project")
      .onClick(()=>{
        try{
          const manifest=parseProjectManifest(this.body);
          status.setText("Project valid\n"+
            "ID: "+manifest.id+"\nSources: "+manifest.sources.length+
            "\nProcessors: "+manifest.pipeline.join(", ")+
            "\nOutputs: "+manifest.outputs.length+
            "\nThe engine validates each source when run. No collection has started.");
        }catch(error){status.setText(errorMessage(error));}
      }));
    new Setting(footer).addButton(b=>b.setButtonText("Use project")
      .onClick(async()=>{
        try{
          if(!this.selectedPath)throw Error("Choose an existing project to use.");
          const file=this.app.vault.getAbstractFileByPath(this.selectedPath);
          const adapter=this.app.vault.adapter;
          if(!(file instanceof TFile)||!(adapter instanceof FileSystemAdapter))
            throw Error("A local desktop vault project file is required");
          parseProjectManifest(await this.app.vault.read(file));
          this.plugin.settings.configPath=join(adapter.getBasePath(),file.path);
          await this.plugin.savePrefs();
          this.close();
          new Notice("Project selected. Collection has not started.");
        }catch(error){notify(error);}
      }));
    labelFields(root);
  }
  onClose():void{this.contentEl.empty();}
}
class NoteMappingModal extends Modal {
  private text:string;
  constructor(app:Plugin["app"],private plugin:ScraperPlugin){
    super(app);this.text=plugin.settings.noteMappingJson;
  }
  onOpen():void{
    const {body:root,footer}=dialog(this,"Draft format",true);
    action(footer,"Close",()=>this.close());
    paragraph(root,"Choose draft properties, title and sections. Existing notes are never changed.");
    const area=root.createEl("textarea",{cls:"ss-code-input",attr:{rows:"12","aria-label":"Draft format as JSON",placeholder:"Draft format configuration as JSON"}});
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
      }else result.setText("Format valid. Select a resource to preview a sample.");
    };
    new Setting(footer).addButton(b=>b.setButtonText("Preview sample")
      .onClick(()=>{try{validate();}catch(error){result.setText(errorMessage(error));}}));
    new Setting(footer).addButton(b=>b.setButtonText("Save format")
      .setCta().onClick(async()=>{
        try{
          const mapping=parseNoteMapping(this.text);
          this.plugin.settings.noteMappingJson=JSON.stringify(mapping,null,2);
          await this.plugin.savePrefs();
          this.close();
          new Notice("Draft format saved.");
        }catch(error){notify(error);}
      }));
    new Setting(root).addButton(b=>b.setButtonText("Reset template")
      .onClick(()=>{
        this.text=DEFAULT_NOTE_MAPPING_JSON;
        area.value=this.text;
        result.setText("Template loaded. Select Save format to apply it.");
      }));
    labelFields(root);
  }
  onClose():void{this.contentEl.empty();}
}
class DetailModal extends Modal {
  private decision:"approved"|"rejected"|"pending";
  private reason="";
  private busy=false;
  private queueLike=false;
  constructor(app:Plugin["app"],private plugin:ScraperPlugin,private entity:EntityRecord){
    super(app);
    this.decision=entity.review;
  }
  onOpen():void{
    const {body:root,footer}=dialog(this,this.entity.title);action(footer,"Close",()=>this.close());
    const links=root.createDiv({cls:"ss-detail-links"});
    if(this.entity.url)links.createEl("a",{text:"Open resource ↗",href:this.entity.url,attr:{target:"_blank",rel:"noopener noreferrer"}});
    const post=this.entity.attributes.discoveryPost;
    if(typeof post==="string"&&/^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+$/.test(post))links.createEl("a",{text:"Open source post ↗",href:post,attr:{target:"_blank",rel:"noopener noreferrer"}});
    const description=this.entity.attributes.description;
    if(typeof description==="string")paragraph(root,description.slice(0,1500));
    root.createEl("h4",{text:"Why it appears"});
    const reasons=root.createEl("ul");for(const reason of this.entity.reasons)reasons.createEl("li",{text:reason});
    paragraph(root,"Relevance: "+this.entity.score+"/100 · "+(this.entity.provenance?.mentions.length??0)+" attached mentions. This score is a guide.");
    const technical=root.createEl("details");technical.createEl("summary",{text:"View full evidence"});
    const pre=technical.createEl("pre");
    pre.addClass("ss-preview");
    pre.setText(JSON.stringify({
      projectId:this.entity.projectId,key:this.entity.key,type:this.entity.type,
      url:this.entity.url??null,attributes:this.entity.attributes,
      score:this.entity.score,confidence:this.entity.confidence,
      review:this.entity.review,reasons:this.entity.reasons,
      provenance:this.entity.provenance??"Not included in this import"
    },null,2));
    void this.plugin.showAgentAssessments(this.entity,technical);
    if(!this.plugin.settings.cliPath||!this.plugin.settings.configPath){

      return;
    }
    const reviewControls=root.createDiv();reviewControls.createEl("h4",{text:"My review"});let likeSetting:Setting|undefined;
    new Setting(reviewControls).setName("Decision").addDropdown(d=>d.addOptions({
      pending:"Pending",approved:"Approved",rejected:"Rejected"
    }).setValue(this.decision).onChange(value=>{
      this.decision=value as "pending"|"approved"|"rejected";if(likeSetting)likeSetting.settingEl.hidden=this.decision!=="approved";
    }));
    new Setting(reviewControls).setName("Reason (optional)").addTextArea(t=>
      t.setPlaceholder("What did you verify?")
        .onChange(value=>{this.reason=value;}));
    if(this.entity.type==="web-resource"&&typeof post==="string"){
      likeSetting=new Setting(reviewControls).setName("Like the source post").setDesc("I checked usefulness, quality, usable free access and the whole source post. Queued likes require Automatic likes to be enabled in Collection and feedback.").addToggle(t=>t.setValue(false).onChange(v=>{this.queueLike=v;}));
      likeSetting.settingEl.hidden=this.decision!=="approved";
    }
    new Setting(footer).addButton(b=>b.setButtonText("Save review").setCta()
      .onClick(async()=>{
        if(this.busy)return;
        this.busy=true;
        try{
          await this.plugin.saveHumanReview(this.entity,this.decision,this.reason,this.decision==="approved"&&this.queueLike);
          this.entity.review=this.decision;
          this.plugin.refresh();
          this.close();
          new Notice("Review saved to the project.");
        }catch(error){notify(error);}
        finally{this.busy=false;}
      }));
    labelFields(root);
  }
  onClose():void{this.contentEl.empty();}
}
class ExportModal extends Modal {
  private folder:string;
  constructor(app:Plugin["app"],private plugin:ScraperPlugin,
    private records:EntityRecord[]){
    super(app);this.folder=plugin.settings.outputFolder.trim()||"Source Scraper/Imported";
  }
  onOpen():void{
    const {body:root,footer}=dialog(this,"Drafts",true);
    action(footer,"Close",()=>this.close());
    paragraph(root,"Preview the draft. This panel does not write notes.");
    const preview=root.createEl("pre",{cls:"ss-preview"});let previewIndex=0;
    const refresh=()=>{
      try{
        const mapping=parseNoteMapping(this.plugin.settings.noteMappingJson);
        const plans=selectedPlans(this.folder,this.records,mapping);
        const plan=plans[previewIndex];preview.setText(plan?plan.path+"\n\n"+plan.content:"No draft selected.");
      }catch(error){preview.setText(errorMessage(error));}
    };
    new Setting(root).setName("Destination folder")
      .setDesc("Suggested vault path for the drafts.")
      .addText(t=>t.setPlaceholder("Source Scraper/Imported")
        .setValue(this.folder).onChange(value=>{this.folder=value;refresh();}));
    if(this.records.length>1)new Setting(root).setName("Preview resource").addDropdown(d=>{this.records.forEach((r,i)=>d.addOption(String(i),r.title));d.onChange(v=>{previewIndex=Number(v);refresh();});});
    root.appendChild(preview);refresh();
    const plans=()=>selectedPlans(this.folder,this.records,parseNoteMapping(this.plugin.settings.noteMappingJson));
        const copy=async(all:boolean)=>{try{const drafts=plans();await navigator.clipboard.writeText(all?drafts.map(p=>p.content).join("\n\n---\n\n"):drafts[previewIndex]?.content||"");new Notice("Markdown copied. Paste it wherever you choose.");}catch(error){notify(error);}};
    if(this.records.length>1)action(footer,"Copy all drafts",()=>{void copy(true);});
    action(footer,"Copy Markdown",()=>{void copy(false);},true);
    paragraph(root,"Copy the Markdown to use it yourself, or ask an AI through your separate connector. This plugin never writes notes.");
    labelFields(root);
  }
  onClose():void{this.contentEl.empty();}
}
class RunModal extends Modal {
  private busy=false;
  constructor(app:Plugin["app"],private plugin:ScraperPlugin){super(app);}
  onOpen():void{
    const {body:root,footer}=dialog(this,"Run project");action(footer,"Close",()=>this.close());
    paragraph(root,"Collect from the configured project and view its results. No notes are written.");
    paragraph(root,"Engine: "+(this.plugin.settings.cliPath?"Ready":"Not configured"));
    paragraph(root,"Project: "+(this.plugin.registeredProjects().find(p=>p.configPath===this.plugin.settings.configPath)?.id||"Not selected"));
    new Setting(footer).addButton(b=>b.setButtonText("Find resources")
      .setCta().onClick(async()=>{
        if(this.busy)return;
        this.busy=true;b.setDisabled(true);stop.setDisabled(false);
        try{
          const s=this.plugin.settings;
          if(!s.cliPath||!s.configPath)throw new Error("Configure the engine and a source in plugin settings.");
          const imported=await this.plugin.cli.runAndImport({
            cliPath:s.cliPath,configPath:s.configPath,nodeExecutable:s.nodeExecutable,allowXProvider:s.xProviderEnabled==="true",xPythonPath:s.xPythonPath,xSession:this.plugin.localSession()
          });
          this.plugin.setImported(imported);
          this.close();
          new Notice("Collection complete. Resources are ready.");
        }catch(error){notify(error);}
        finally{this.busy=false;b.setDisabled(false);stop.setDisabled(true);}
      }));
    const stop=action(footer,"Stop",()=>{this.plugin.cli.cancel();this.close();});stop.setDisabled(true);
    labelFields(root);
  }
}
class XFeedSetupModal extends Modal {
  private clearSecrets?:()=>void;
  constructor(app:Plugin["app"],private plugin:ScraperPlugin){super(app);}
  onOpen():void{
    const {body:root,footer}=dialog(this,"Connect X");root.addClass("ss-x-setup");action(footer,"Cancel",()=>this.close());
    paragraph(root,"Use your X session to read your For You feed. No paid API is required.");
    const instructions=root.createEl("details",{cls:"ss-session-help"});instructions.createEl("summary",{text:"Where do I find these values?"});
    const steps=instructions.createEl("ol");
    for(const text of ["Open x.com and sign in using your browser.","Press F12. In Chrome or Edge, open Application → Cookies → https://x.com.","Copy twid, auth_token and ct0 into the fields below. Do not send them in chat."])steps.createEl("li",{text});
    instructions.createEl("a",{text:"Open X ↗",href:"https://x.com/home",attr:{target:"_blank",rel:"noopener noreferrer"}});
    let accountId="",include="react, frontend, css, gsap, motion, typography, design system, open source",exclude="sponsored, giveaway",minimum=50,pages=1,existingId="";
    let accountSession="",csrf="",busy=false;
    const existingSession=this.plugin.localSession();
    const secretInputs:HTMLInputElement[]=[];
    this.clearSecrets=()=>{accountSession="";csrf="";for(const input of secretInputs)input.value="";};
    try{
      const projects=this.plugin.registeredProjects();
      const existing=projects.find(p=>p.configPath===this.plugin.settings.configPath&&parseProjectManifest(readFileSync(p.configPath,"utf8")).sources.some(s=>s.adapter==="x-for-you-local"))||projects.find(p=>p.id.startsWith("x-for-you"));
      if(existing){const manifest=parseProjectManifest(readFileSync(existing.configPath,"utf8"));existingId=existing.id;
        accountId=String(manifest.sources[0].config.accountId||"");include=manifest.policy.includeKeywords.join(", ");exclude=manifest.policy.excludeKeywords.join(", ");minimum=manifest.policy.minimumScore;pages=Number(manifest.sources[0].config.pagesPerRun)||1;}
    }catch{/* Invalid local manifests are reported by preparation, without replacing them. */}
    new Setting(root).setName("Account ID · twid").setDesc("Paste the full twid value or your numeric account ID.").addText(t=>t.setValue(accountId).setPlaceholder("u=123456789").onChange(value=>{accountId=value;}));
    for(const [label,key] of [["auth_token","session"],["ct0","csrf"]] as const){
      new Setting(root).setName(label).setDesc(label==="auth_token"?"Your account access cookie.":"Your session validation cookie.").addText(t=>{t.setPlaceholder(existingSession?"Leave blank to keep the current session":"Paste the value of "+label);t.inputEl.type="password";t.inputEl.autocomplete="off";t.inputEl.spellcheck=false;t.inputEl.setAttribute("aria-label",label);secretInputs.push(t.inputEl);t.onChange(value=>{if(key==="session")accountSession=value;else csrf=value;});});
    }
    if(existingSession)paragraph(root,"A session is already loaded. Leave auth_token and ct0 blank to keep it.");
    paragraph(root,this.plugin.canRememberSession()?"Saved encrypted on this device and restored when Obsidian restarts.":"On this system the session stays in memory until Obsidian closes. It is never saved in settings or notes.");
    const status=formStatus(root);
    new Setting(footer).addButton(button=>button.setButtonText("Connect").setCta().onClick(async()=>{
      if(busy)return;busy=true;button.setDisabled(true);
      try{
        if(this.plugin.isCollecting())throw Error("Stop collection before changing the session.");
        const session=!accountSession&&!csrf&&this.plugin.localSession()?this.plugin.localSession()!:validateLocalSession(accountSession,csrf);
        if(!this.plugin.settings.xPythonPath||!existsSync(this.plugin.settings.xPythonPath))throw Error("Configure the X reader in Source Scraper settings first.");
        if(!(this.app.vault.adapter instanceof FileSystemAdapter))throw Error("Obsidian Desktop is required.");
        if(!Number.isInteger(minimum)||minimum<0||minimum>100)throw Error("Use a minimum relevance score from 0 to 100.");
        if(!Number.isInteger(pages)||pages<1||pages>10)throw Error("Use 1 to 10 pages per collection.");
        const settings=this.plugin.settings;let manifest=buildXFeedProject(normalizeXAccountId(accountId),include,exclude,minimum,pages);
        const projects=JSON.parse(settings.mcpProjectsJson) as RegisteredProject[];
        if(!Array.isArray(projects))throw Error("Check the local source configuration.");
        let project=projects.find(p=>p.id===(existingId||manifest.id));
        const verify=(entry:RegisteredProject)=>{const raw=readFileSync(entry.configPath,"utf8");if(createHash("sha256").update(raw).digest("hex")!==entry.manifestHash)throw Error("This source configuration changed. Review it in settings before continuing.");return parseProjectManifest(raw);};
        if(project){const prior=verify(project);const account=normalizeXAccountId(accountId);if(prior.sources.some(source=>source.adapter==="x-for-you-local"&&String(source.config.accountId)===account)){manifest=prior;}else{manifest=xFeedVariant(manifest);project=projects.find(p=>p.id===manifest.id);if(project)verify(project);}}
        if(!project){
          if(projects.length>=100)throw Error("The saved source limit has been reached.");
          project=writeWorkspaceProject(settings.mcpWorkspacePath,this.app.vault.adapter.getBasePath(),manifest);settings.mcpProjectsJson=JSON.stringify([...projects,project]);
        }
        settings.configPath=project.configPath;await this.plugin.savePrefs();await this.plugin.useLocalSession(session);
        this.clearSecrets?.();this.close();await this.plugin.openView();
      }catch(error){status.setText(error instanceof Error&&/Enter both/.test(error.message)?"Paste auth_token and ct0 without spaces.":errorMessage(error));}
      finally{busy=false;button.setDisabled(false);}
    }));
    labelFields(root);
  }
  onClose():void{this.clearSecrets?.();this.clearSecrets=undefined;this.contentEl.empty();}
}
class FeedFiltersModal extends Modal {
  constructor(app:Plugin["app"],private plugin:ScraperPlugin){super(app);}
  onOpen():void{
    const {body:root,footer}=dialog(this,"Search filters");root.addClass("ss-filter-form");
    action(footer,"Cancel",()=>this.close());
    try{
      const entries=this.plugin.registeredProjects();
      const ordered=[...entries].sort((a,b)=>Number(b.configPath===this.plugin.settings.configPath)-Number(a.configPath===this.plugin.settings.configPath));
      const entry=ordered.find(p=>{try{return parseProjectManifest(readFileSync(p.configPath,"utf8")).sources.some(source=>source.adapter==="x-for-you-local");}catch{return false;}});
      if(!entry)throw Error("Connect X before configuring its filters.");
      const raw=readFileSync(entry.configPath,"utf8");
      if(createHash("sha256").update(raw).digest("hex")!==entry.manifestHash)throw Error("The configuration changed. Review the project in settings.");
      const project=parseProjectManifest(raw);
      if(!project.sources.some(source=>source.adapter==="x-for-you-local"))throw Error("Select your X source to edit these filters.");
      const values=feedFilterForm(project);
      paragraph(root,"Only links that meet every condition pass. Empty fields add no restriction.");
      new Setting(root).setName("Include terms").setDesc("Separate terms with commas. Match them against the original post.").addTextArea(t=>t.setValue(values.include).setPlaceholder("e.g. design system, UI kit, typography").onChange(v=>{values.include=v;}));
      new Setting(root).setName("Match").addDropdown(d=>d.addOptions({any:"Any of these terms",all:"All of these terms"}).setValue(values.mode).onChange(v=>{values.mode=v as "any"|"all";}));
      new Setting(root).setName("Exclude terms").setDesc("Exclude posts containing any of these terms.").addTextArea(t=>t.setValue(values.exclude).setPlaceholder("e.g. giveaway, sponsored").onChange(v=>{values.exclude=v;}));
      const numeric=(parent:HTMLElement,name:string,key:"days"|"likes"|"reposts"|"pages"|"minimum",placeholder:string,min:number,max:number,description:string)=>{
        new Setting(parent).setName(name).setDesc(description).addText(t=>{t.setValue(values[key]).setPlaceholder(placeholder).onChange(v=>{values[key]=v;});t.inputEl.type="number";t.inputEl.min=String(min);t.inputEl.max=String(max);t.inputEl.step="1";t.inputEl.inputMode="numeric";});
      };
      numeric(root,"Maximum age · days","days","No limit",1,36500,"Use 30 for the past month, or 60 for the past two months.");
      const engagement=root.createDiv({cls:"ss-field-pair"});
      numeric(engagement,"Minimum likes","likes","No minimum",0,Number.MAX_SAFE_INTEGER,"");
      numeric(engagement,"Minimum reposts","reposts","No minimum",0,Number.MAX_SAFE_INTEGER,"");
      const advanced=root.createEl("details",{cls:"ss-disclosure"});advanced.createEl("summary",{text:"Profile limits and rules"});
      numeric(advanced,"Pages per collection","pages","1",1,10,"From 1 to 10. Each page reads a sample of your feed.");
      numeric(advanced,"Minimum match score","minimum","0",0,100,"Hide resources below this keyword score. It does not measure editorial quality.");
      if(project.filters){const pre=advanced.createEl("pre",{cls:"ss-preview"});pre.setText(JSON.stringify(project.filters,null,2));paragraph(advanced,"Existing date boundaries, domains and other rules are preserved.");}
      const status=formStatus(root);let busy=false;
      action(footer,"Save filters",()=>{void (async()=>{
        if(busy)return;busy=true;const before={...this.plugin.settings};
        try{
          if(this.plugin.isCollecting())throw Error("Wait for collection to finish before changing filters.");
          if(!(this.app.vault.adapter instanceof FileSystemAdapter))throw Error("Obsidian Desktop is required.");
          const updated=applyFeedFilterForm(project,values);
          let selected=entry;
          if(JSON.stringify(updated)!==JSON.stringify(project)){
            const variant=xFeedVariant({...updated,id:"x-for-you-resources"});
            const registered=entries.find(p=>p.id===variant.id);
            if(registered){if(createHash("sha256").update(readFileSync(registered.configPath,"utf8")).digest("hex")!==registered.manifestHash)throw Error("The saved profile changed. Review it in settings.");selected=registered;}
            else{if(entries.length>=100)throw Error("The saved profile limit has been reached.");selected=writeWorkspaceProject(this.plugin.settings.mcpWorkspacePath,this.app.vault.adapter.getBasePath(),variant);this.plugin.settings.mcpProjectsJson=JSON.stringify([...entries,selected]);}
          }
          this.plugin.settings.configPath=selected.configPath;await this.plugin.savePrefs();this.close();await this.plugin.openView();new Notice("Filters saved. They apply to the next collection.");
        }catch(error){this.plugin.settings=before;status.setText(errorMessage(error));}
        finally{busy=false;}
      })();},true);labelFields(root);
    }catch(error){paragraph(root,errorMessage(error));}
  }
  onClose():void{this.contentEl.empty();}
}
/** Compatibility only: saved legacy leaves are detached on layout readiness. */
class LegacyScraperView extends ItemView {
  getViewType():string{return VIEW_TYPE;}
  getDisplayText():string{return "Source Scraper";}
}
class ScraperReview {
  private inbox?:ResourceInbox;
  private page=0;
  private search="";
  private reviewFilter="all";
  constructor(private root:HTMLElement|undefined,private plugin:ScraperPlugin){}
  private get app():Plugin["app"]{return this.plugin.app;}
  mount(root:HTMLElement):void{this.root=root;this.render();}
  unmount():void{this.inbox?.unmount();this.root=undefined;}
  render():void{
    const root=this.root;if(!root||!root.isConnected)return;
    if(this.plugin.resourceInboxReady()){
      this.inbox?.unmount();this.inbox=new ResourceInbox({projectId:()=>this.plugin.resourceInboxProject(),query:args=>this.plugin.queryResourceInbox(args),review:args=>this.plugin.reviewResourceInbox(args),error:errorMessage,
        detail:e=>{this.plugin.closePopover();new DetailModal(this.app,this.plugin,e).open();},drafts:records=>{this.plugin.closePopover();new ExportModal(this.app,this.plugin,records).open();}});
      this.inbox.mount(root);return;
    }
    root.empty();root.addClass("source-scraper-view");
    const imported=this.plugin.imported;
    if(!imported){paragraph(root,"No results yet. Collect sources or import a results file.");return;}
    const summary=root.createDiv({cls:"ss-review-summary"});
    summary.createEl("p",{cls:"ss-count",text:imported.records.length+(imported.records.length===1?" resource":" resources")});
    if(this.plugin.reviewTruncated)paragraph(summary,"Showing the first 5,000 resources. Narrow the collection filters for a smaller set.");
    if(imported.projectId==="starter-project")summary.createEl("p",{cls:"ss-example-note",text:"Local example · this is not your X feed."});
    const searchBox=root.createDiv({cls:"ss-search"});
    const search=new SearchComponent(searchBox).setPlaceholder("Filter resources").setValue(this.search);
    const input=search.inputEl;input.setAttribute("aria-label","Filter resources");
    const filter=root.createEl("select",{cls:"ss-review-filter",attr:{"aria-label":"Review status"}});
    for(const [value,label] of [["all","All resources"],["pending","Needs review"],["approved","Approved by me"],["recommended","AI recommended"],["discarded","AI discarded"]])filter.createEl("option",{value,text:label});
    filter.value=this.reviewFilter;
    const index=new ReviewIndex(imported.records);
    const selectTools=root.createDiv({cls:"ss-selection-tools"});
    const selectLabel=selectTools.createEl("label");const selectPage=selectLabel.createEl("input",{type:"checkbox",attr:{"aria-label":"Select this page"}});selectLabel.createSpan({text:"Select page"});
    const clear=action(selectTools,"Clear selection",()=>{this.plugin.selected.clear();syncCheckboxes();updateSelection();}).buttonEl;
    let visible:EntityRecord[]=[];
    const syncCheckboxes=()=>{for(const box of Array.from(list.querySelectorAll<HTMLInputElement>(".ss-select-control")))box.checked=this.plugin.selected.has(box.dataset.key!);};
    const list=root.createDiv({cls:"ss-candidate-list",attr:{tabindex:"0"}});list.setAttribute("aria-label","Found resources");
    const pagination=root.createDiv({cls:"ss-pagination"});
    const draftArea=root.createDiv({cls:"ss-review-footer"});
    const primaryRow=draftArea.createDiv({cls:"ss-review-primary"});
    const selection=primaryRow.createSpan({cls:"ss-selection-count"});selection.setAttribute("role","status");
    const bulk=action(primaryRow,"Review selected",()=>{const records=this.plugin.getSelected();if(!records.length)return;this.plugin.closePopover();new BatchReviewModal(this.app,this.plugin,records).open();},true).buttonEl;
    const exportRow=draftArea.createDiv({cls:"ss-review-export"});
    const preview=new ButtonComponent(exportRow).setButtonText("Preview drafts").setTooltip("Preview and copy Markdown; no notes are written").onClick(()=>{
      try{
        const selected=this.plugin.getSelected();
        if(!selected.length)throw Error("Select resources before previewing drafts.");
        if(selected.length>200)throw Error("Select up to 200 resources.");
        this.plugin.closePopover();new ExportModal(this.app,this.plugin,selected).open();
      }catch(error){notify(error);}
    }).buttonEl;preview.classList.add("ss-preview-action");preview.type="button";
    const copyLinks=new ButtonComponent(exportRow).setButtonText("Copy links").onClick(async()=>{try{await navigator.clipboard.writeText(this.plugin.getSelected().map(e=>e.url).filter(Boolean).join("\n"));new Notice("Selected links copied.");}catch(error){notify(error);}}).buttonEl;
    const updateSelection=()=>{
      const count=this.plugin.selected.size;
      selection.textContent=count+" selected";preview.disabled=count===0;copyLinks.disabled=!this.plugin.getSelected().some(e=>e.url);bulk.disabled=!count;exportRow.hidden=!count;clear.disabled=!count;
      const checked=visible.filter(e=>this.plugin.selected.has(e.key)).length;selectPage.checked=visible.length>0&&checked===visible.length;selectPage.indeterminate=checked>0&&checked<visible.length;selectPage.disabled=!visible.length;
    };
    const renderResults=()=>{
      if(this.root!==root||!root.isConnected)return;
      list.empty();pagination.empty();
      const filtered=index.filter(this.search).filter(e=>this.reviewFilter==="all"||this.reviewFilter==="pending"&&e.review==="pending"||this.reviewFilter==="approved"&&e.review==="approved"||["recommended","discarded"].includes(this.reviewFilter)&&e.resourceAssessment?.decision===this.reviewFilter);
      const pageSize=40,pageCount=Math.max(1,Math.ceil(filtered.length/pageSize));this.page=Math.min(this.page,pageCount-1);
      visible=filtered.slice(this.page*pageSize,(this.page+1)*pageSize);
      if(!visible.length){const empty=list.createDiv({cls:"ss-empty-results"});empty.createEl("strong",{text:"No matches"});paragraph(empty,"Try another search term.");}
      for(const entity of visible){
        const item=list.createEl("article",{cls:"ss-record"});
        const head=item.createDiv({cls:"ss-record-head"});
        const checkbox=head.createEl("input",{type:"checkbox",cls:"ss-select-control",attr:{'aria-label':"Select "+entity.title}});
        checkbox.checked=this.plugin.selected.has(entity.key);checkbox.dataset.key=entity.key;
        checkbox.addEventListener("change",()=>{
          if(checkbox.checked){if(this.plugin.selected.size>=MAX_REVIEW_SELECTION){checkbox.checked=false;new Notice("Select up to 200 resources per batch.");return;}this.plugin.selected.add(entity.key);}else this.plugin.selected.delete(entity.key);
          updateSelection();
        });
        const inspect=new ButtonComponent(head).setButtonText(entity.title).onClick(()=>{this.plugin.closePopover();new DetailModal(this.app,this.plugin,entity).open();}).buttonEl;
        inspect.classList.add("ss-record-title");inspect.type="button";inspect.setAttribute("aria-label","View details: "+entity.title);
        const source=item.createDiv({cls:"ss-record-source"});
        if(entity.url){
          const link=source.createEl("a",{href:entity.url,text:new URL(entity.url).hostname.replace(/^www\./,""),attr:{target:"_blank",rel:"noopener noreferrer"}});
          link.setAttribute("aria-label","Open resource: "+entity.title);
        }else source.createSpan({text:entity.type.replace(/[-_]/g," ")});
        const description=typeof entity.attributes.description==="string"?entity.attributes.description:entity.reasons[0];
        if(description)item.createEl("p",{cls:"ss-record-description",text:description.slice(0,180)});
        const evaluation=entity.resourceAssessment?.decision??"pending";if(entity.review==="pending")item.createSpan({cls:"ss-review-decision",text:evaluation==="recommended"?"AI recommended":evaluation==="discarded"?"AI discarded":"Needs review"});
        if(entity.review!=="pending"){const decision=item.createSpan({cls:"ss-review-decision",text:entity.review==="approved"?"Approved":"Rejected"});decision.dataset.review=entity.review;}
      }
      pagination.hidden=pageCount===1;
      const previous=pagination.createEl("button",{text:"Previous"});previous.disabled=this.page===0;previous.onclick=()=>{this.page--;renderResults();};
      pagination.createSpan({text:filtered.length?((this.page*pageSize+1)+"–"+Math.min((this.page+1)*pageSize,filtered.length)+" of "+filtered.length):"0 resources"});
      const next=pagination.createEl("button",{text:"Next"});next.disabled=this.page>=pageCount-1;next.onclick=()=>{this.page++;renderResults();};
      updateSelection();
    };
    selectPage.onchange=()=>{if(selectPage.checked){if(selectReviewPage(this.plugin.selected,visible))new Notice("Selection is limited to 200 resources. Clear the selection to review another batch.");}else for(const e of visible)this.plugin.selected.delete(e.key);syncCheckboxes();updateSelection();};
    filter.onchange=()=>{this.reviewFilter=filter.value;this.page=0;renderResults();};
    search.onChange(()=>{this.search=input.value;this.page=0;renderResults();});
    renderResults();updateSelection();
  }

  renderTools(controls:HTMLElement):void{
    const action=(text:string,click:()=>void)=>{new ButtonComponent(controls).setButtonText(text).onClick(()=>{this.plugin.closePopover();click();});};
    action("Edit project",()=>new ProjectModal(this.app,this.plugin).open());
    action("Draft format",()=>new NoteMappingModal(this.app,this.plugin).open());
    action("Run project",()=>new RunModal(this.app,this.plugin).open());
    action("Diagnostics",()=>new Notice("Engine CLI: "+(this.plugin.settings.cliPath?"configured":"not connected")+"; "+(this.plugin.imported?.records.length??0)+" sources; no automatic writes."));
  }
}
class CycleControlsModal extends Modal {
  private timer?:number;
  constructor(app:Plugin["app"],private plugin:ScraperPlugin){super(app);}
  onOpen(){
    const {body,footer}=dialog(this,"Collection and feedback");action(footer,"Close",()=>this.close());
    paragraph(body,"Collection runs while Obsidian and this computer are open. Review resources directly in this plugin, or use an AI through MCP. AI is optional.");
    const status=body.createEl("p",{attr:{role:"status"}});let maxPages=100;
    new Setting(body).setName("Page budget").setDesc("Maximum pages for this collection cycle (1–1000). Progress is saved after each page.").addText(t=>t.setValue("100").onChange(v=>{maxPages=Number(v);}));
    const controls=body.createDiv({cls:"ss-controls"});
    const run=(kind:"start"|"pause"|"stop")=>{void this.plugin.controlCycle(kind,maxPages).catch(notify);};
    action(controls,"Start / resume",()=>run("start"),true);action(controls,"Pause",()=>run("pause"));action(controls,"Stop collection",()=>run("stop"));
    new Setting(body).setName("Automatic likes").setDesc("Separate permission to like evaluated, suitable posts. Up to 5 per hour, at least 60 seconds apart. Never follows, reposts, messages or unlikes.").addToggle(t=>t.setValue(this.plugin.settings.xLikesEnabled==="true").onChange(v=>{void this.plugin.setAutomaticLikes(v).catch(e=>{t.setValue(this.plugin.settings.xLikesEnabled==="true");notify(e);});}));
    const rejected=body.createEl("details");rejected.createEl("summary",{text:"Rejected resources"});const list=rejected.createDiv();
    rejected.addEventListener("toggle",()=>{if(!rejected.open)return;list.empty();for(const row of this.plugin.rejectedResources()){new Setting(list).setName(row.resource).setDesc(row.reason||"Explicitly rejected").addButton(b=>b.setButtonText("Restore").onClick(()=>{void this.plugin.restoreResource(row.resource).then(()=>{b.setDisabled(true);b.setButtonText("Restored");}).catch(notify);}));}if(!list.children.length)paragraph(list,"No rejected resources.");});
    const activity=body.createEl("details");activity.createEl("summary",{text:"Like activity and errors"});const log=activity.createEl("pre",{cls:"ss-code-input"});
    const update=()=>{const state=this.plugin.cycleStatus();status.textContent=state?`${state.projectId}: ${state.state} · ${state.pages} pages · ${state.observations} posts · ${state.duplicates} duplicates · ${state.reason}`:"MCP integration unavailable";log.textContent=this.plugin.likeActivity().slice(-30).map(a=>`${a.state} · ${a.postUrl}${a.error?" · "+a.error:""}`).join("\n")||"No like actions.";};
    update();this.timer=window.setInterval(update,1000);labelFields(body);
  }
  onClose(){if(this.timer)window.clearInterval(this.timer);this.contentEl.empty();}
}
class ScraperSettings extends PluginSettingTab {
  constructor(app:Plugin["app"],private plugin:ScraperPlugin){super(app,plugin);}
  display():void{
    const root=this.containerEl;root.empty();root.addClass("ss-settings");
    new Setting(root).setName("Source Scraper").setHeading();
    paragraph(root,"Local connection and preferences. Changes take effect when saved.");
    const body=root.createDiv({cls:"ss-settings-body"});
    const draft={...this.plugin.settings},dirty=new Set<keyof Preferences>();
    const change=(key:keyof Preferences,value:string)=>{draft[key]=value;dirty.add(key);};
    const section=(label:string)=>{const part=body.createDiv({cls:"ss-settings-section"});new Setting(part).setName(label).setHeading();return part;};
    const connection=section("Connection");
    new Setting(connection).setName("X session").setDesc("Connect X or renew an existing session.").addButton(b=>b.setButtonText(this.plugin.localSession()?"Change session":"Connect X").onClick(()=>new XFeedSetupModal(this.app,this.plugin).open()));
    new Setting(connection).setName("Read from X").setDesc("Allow reading your For You feed. Turning this off deletes the saved session.").addToggle(t=>t.setValue(draft.xProviderEnabled==="true").onChange(v=>{change("xProviderEnabled",String(v));}));
    new Setting(connection).setName("MCP access").setDesc("Optional AI connection through Vault as MCP. Manual controls work without it.").addToggle(t=>t.setValue(draft.mcpEnabled==="true").onChange(v=>{change("mcpEnabled",String(v));}));
    const notes=section("Drafts");
    new Setting(notes).setName("Suggested folder").setDesc("Drafts are previews. The plugin does not create notes.").addText(t=>t.setPlaceholder("Source Scraper/Imported").setValue(draft.outputFolder).onChange(v=>{change("outputFolder",v);}));
    new Setting(notes).setName("Properties and content").addButton(b=>b.setButtonText("Edit format").onClick(()=>new NoteMappingModal(this.app,this.plugin).open()));
    const technical=body.createEl("details",{cls:"ss-settings-section ss-disclosure"});technical.createEl("summary",{text:"Engine settings"});
    paragraph(technical,"Local paths and trusted projects. Usually configured only once.");
    for(const [key,label,placeholder] of [["cliPath","Engine executable","Absolute path to source-scraper.mjs"],["nodeExecutable","Node.js executable","Path to node.exe"],["xPythonPath","X reader Python","Path to the project Python runtime"],["configPath","Active project","Path to the project file"],["mcpWorkspacePath","Project workspace","A folder outside your vault"],["mcpCliHash","Engine fingerprint · SHA-256","64 hexadecimal characters"]] as const){
      new Setting(technical).setName(label).addText(t=>t.setValue(draft[key]).setPlaceholder(placeholder).onChange(v=>{change(key,v.trim());}));
    }
    new Setting(technical).setName("Trusted projects · JSON").setDesc("Local registry of verified paths and fingerprints.").addTextArea(t=>{t.setValue(draft.mcpProjectsJson).onChange(v=>{change("mcpProjectsJson",v);});t.inputEl.addClass("ss-code-input");});
    const footer=root.createDiv({cls:"ss-settings-footer"}),status=formStatus(footer);let busy=false;
    action(footer,"Save settings",()=>{void (async()=>{
      if(busy)return;busy=true;const prior=this.plugin.settings;
      try{
        if(this.plugin.isCollecting())throw Error("Wait for collection to finish before saving settings.");
        const merged={...prior};for(const key of dirty)merged[key]=draft[key];
        const registry=JSON.parse(merged.mcpProjectsJson);if(!Array.isArray(registry)||registry.length>100||registry.some(p=>!p||typeof p.id!=="string"||typeof p.configPath!=="string"||!/^[a-f0-9]{64}$/.test(p.manifestHash)))throw Error("Check the trusted projects JSON.");
        this.plugin.settings=merged;
        if(prior.xProviderEnabled==="true"&&merged.xProviderEnabled!=="true")await this.plugin.forgetLocalSession();else await this.plugin.savePrefs();
        dirty.clear();status.setText("Settings saved.");status.addClass("ss-status-success");
      }catch(error){this.plugin.settings=prior;status.removeClass("ss-status-success");status.setText(errorMessage(error));}
      finally{busy=false;}
    })();},true);labelFields(root);
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
  private sessionStore?:XSessionStore;
  private sessionChange:Promise<void>=Promise.resolve();
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
    if(this.app.vault.adapter instanceof FileSystemAdapter){
      const vaultId=createHash("sha256").update(this.app.vault.adapter.getBasePath()).digest("hex").slice(0,24);
      this.sessionStore=new XSessionStore({vaultId});await this.restoreLocalSession();
    }
    this.registerView(VIEW_TYPE,leaf=>new LegacyScraperView(leaf));
    this.statusItem=this.addStatusBarItem();this.statusItem.addClass("mod-clickable","ss-status");
    this.statusItem.setAttribute("role","button");this.statusItem.setAttribute("aria-haspopup","dialog");this.statusItem.setAttribute("aria-expanded","false");this.statusItem.tabIndex=0;
    const statusIcon=this.statusItem.createSpan({cls:"ss-status-icon",attr:{"aria-hidden":"true"}});setIcon(statusIcon,"scan-search");
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
  canRememberSession():boolean{return this.sessionStore?.supported===true;}
  async restoreLocalSession():Promise<void>{
    if(this.settings.xProviderEnabled!=="true")return;
    try{const saved=await this.sessionStore?.load();if(!this.unloaded&&saved){this.memorySession=saved;this.uiMessage="X session restored. You can collect resources.";}}
    catch{this.uiError="Could not restore the encrypted X session. Select Connect X to renew it.";}
  }
  private changeSession(operation:()=>Promise<void>):Promise<void>{
    const pending=this.sessionChange.then(operation);this.sessionChange=pending.catch(()=>{});return pending;
  }
  async forgetLocalSession():Promise<void>{
    return this.changeSession(async()=>{
      const previous=this.memorySession,allowed=this.settings.xProviderEnabled;
      this.memorySession=undefined;this.settings.xProviderEnabled="false";
      try{if(this.sessionStore)await this.sessionStore.forgetAndCommit(()=>this.savePrefs());else await this.savePrefs();this.uiMessage="X disconnected. The saved session was removed from this device.";}
      catch(error){if(!this.unloaded)this.memorySession=previous;this.settings.xProviderEnabled=allowed;throw error;}
    });
  }
  async useLocalSession(value:XLocalSession):Promise<void>{
    const session=validateLocalSession(value.accountSession,value.csrf);
    return this.changeSession(async()=>{
      if(this.unloaded)throw Error("Source Scraper is already closed.");
      const previous=this.memorySession,allowed=this.settings.xProviderEnabled;
      this.memorySession={...session};this.settings.xProviderEnabled="true";
      try{
        if(this.sessionStore)await this.sessionStore.saveAndCommit(session,()=>this.savePrefs());else await this.savePrefs();
        this.uiError="";this.uiMessage=this.canRememberSession()?"X session saved and loaded. Collect resources to verify access.":"X session loaded. Collect resources to verify access.";
      }catch(error){if(!this.unloaded)this.memorySession=previous;this.settings.xProviderEnabled=allowed;throw error;}
      this.updateStatus();
    });
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
  isCollecting():boolean{return this.uiStarting||this.cli.running||Boolean(this.provider?.activity().running)||Boolean(["running","waiting"].includes(this.provider?.cycle?.snapshot().state??""));}
  private panelSnapshot():PanelSnapshot{
    const list=this.registeredProjects(),projects=this.projectsForPanel(),readiness=xFeedReadiness(this.memorySession);
    const activity=this.provider?.activity();
    return {engine:Boolean(this.settings.cliPath&&existsSync(this.settings.cliPath)),mcp:Boolean(this.provider),python:Boolean(this.settings.xPythonPath&&existsSync(this.settings.xPythonPath)),
      session:readiness.accountSessionConfigured&&readiness.csrfConfigured,xAllowed:this.settings.xProviderEnabled==="true",
      projects,projectId:list.find(p=>p.configPath===this.settings.configPath)?.id||"",findings:this.imported?.records.length??0,
      findingProject:projects.find(p=>p.id===this.imported?.projectId)?.name||this.imported?.projectId||"",
      exampleFindings:this.imported?.projectId==="starter-project",
      cycle:this.provider?.cycle?.snapshot().projectId?this.provider.cycle.snapshot():undefined,
      running:this.isCollecting(),error:this.uiError||(activity?.lastState==="failed"?activity.error:undefined),message:this.uiMessage};
  }
  private placeStatus():void{
    const item=this.statusItem,parent=item?.parentElement;if(!item||!parent)return;
    const chat=parent.querySelector<HTMLElement>(".cmt-status");
    if(chat?.parentElement===parent&&chat.nextElementSibling!==item)chat.after(item);
  }
  private updateStatus(dataChanged=false):void{
    if(this.unloaded||!this.statusItem)return;
    const state=discoveryState(this.panelSnapshot()),label="Source Scraper. "+state.status+". Open Source Scraper.";
    if(this.statusItem.dataset.state!==state.state)this.statusItem.dataset.state=state.state;
    if(this.statusItem.title!==label)this.statusItem.title=label;
    if(this.statusItem.getAttribute("aria-label")!==label)this.statusItem.setAttribute("aria-label",label);
    this.popover?.update(dataChanged);
  }
  closePopover(restoreFocus=false):void{this.popover?.close(restoreFocus);}
  private async collectSelected(projectId?:string):Promise<void>{
    if(this.isCollecting()||this.unloaded)return;
    const provider=this.provider,id=projectId||this.panelSnapshot().projectId;if(!provider||!id)return;
    if(this.projectsForPanel().some(p=>p.id===id&&p.isX)){this.uiError="";this.uiMessage="";await provider.execute("source_scraper_control_cycle",{projectId:id,action:"start",maxPages:100});this.updateStatus();return;}
    this.uiStarting=true;this.uiError="";this.uiMessage="Collecting…";this.updateStatus();
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
      if(!this.unloaded){this.uiMessage="Collection complete.";this.uiError="";}
    }catch(error){if(!this.unloaded&&provider===this.provider){this.uiError=errorMessage(error);this.uiJobId=undefined;}}
    finally{this.uiStarting=false;this.uiPolling=false;this.updateStatus();}
  }
  private connectMcp():void{
    const host=(this.app as unknown as {plugins:{getPlugin(id:string):any}}).plugins.getPlugin("vault-as-mcp");
    const signature=JSON.stringify(this.settings);
    if(host===this.providerHost&&signature===this.providerSignature&&this.provider){
      if(this.settings.mcpEnabled==="true"&&host?.toolProviderApiVersion===1&&!this.disposeProvider){try{this.disposeProvider=host.registerToolProvider(this.provider);this.mcpStatus="Local tools ready; MCP access connected";}catch(error){this.mcpStatus="Local tools ready; MCP access: "+errorMessage(error);}}
      return;
    }
    this.disposeProvider?.();this.provider?.dispose();this.provider=undefined;this.disposeProvider=undefined;
    this.providerHost=host;this.providerSignature=signature;
    if(!this.settings.cliPath||!this.settings.mcpWorkspacePath){this.mcpStatus="Local engine setup required";return;}
    try{
      if(!(this.app.vault.adapter instanceof FileSystemAdapter))throw Error("Desktop filesystem vault required");
      const projects=JSON.parse(this.settings.mcpProjectsJson) as RegisteredProject[];
      if(!Array.isArray(projects)||projects.length>100||projects.some(p=>!p||typeof p.id!=="string"||typeof p.configPath!=="string"||!/^[a-f0-9]{64}$/.test(p.manifestHash)))throw Error("Invalid local project registry");
      if(new Set(projects.map(p=>p.id)).size!==projects.length)throw Error("Duplicate registered projects");
      const vaultPath=this.app.vault.adapter.getBasePath();
      const vaultId=createHash("sha256").update(vaultPath).digest("hex").slice(0,24);
      const provider=new SourceScraperProvider({cliPath:this.settings.cliPath,cliHash:this.settings.mcpCliHash,
        allowXProvider:this.settings.xProviderEnabled==="true",
        allowXLikes:()=>this.settings.xLikesEnabled==="true",
        xPythonPath:this.settings.xPythonPath,
        getXSession:()=>this.memorySession,
        nodeExecutable:this.settings.nodeExecutable,projects,workspacePath:this.settings.mcpWorkspacePath,
        statePath:join(process.env.LOCALAPPDATA||join(homedir(),".local","share"),"SourceScraper",vaultId,"state.json"),
        vaultPath,pathExists:path=>Boolean(this.app.vault.getAbstractFileByPath(path)),mapping:()=>this.settings.noteMappingJson,
        checkRead:path=>{if(this.settings.mcpEnabled!=="true"||host?.toolProviderApiVersion!==1)throw Error("MCP reference access is disabled");host.checkToolReadAccess(path);},
        stage:value=>{this.setImported(value);},
        stageAuto:value=>{const visible=new Set(value.records.map(e=>e.key));this.imported=value;for(const key of this.selected)if(!visible.has(key))this.selected.delete(key);this.refresh();},
        readReference:async path=>{const file=this.app.vault.getAbstractFileByPath(path);if(!(file instanceof TFile))throw Error("Reference note missing");return this.app.vault.read(file);}
      });
      this.provider=provider;
      if(this.settings.mcpEnabled==="true"&&host?.toolProviderApiVersion===1){try{this.disposeProvider=host.registerToolProvider(provider);this.mcpStatus="Local tools ready; "+provider.tools.length+" MCP tools connected";}catch(error){this.mcpStatus="Local tools ready; MCP access: "+errorMessage(error);}}
      else this.mcpStatus=this.settings.mcpEnabled==="true"?"Local tools ready; compatible Vault as MCP is needed only for AI access":"Local tools ready; MCP access disabled";
      void provider.restoreQueue().catch(()=>{this.mcpStatus+="; saved selection needs explicit refresh";});
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
  cycleStatus(){return this.provider?.cycle?.snapshot();}
  likeActivity(){return this.provider?.memory.actions()??[];}
  rejectedResources(){return this.provider?.memory.listRejected("user")??[];}
  async restoreResource(url:string){this.provider?.memory.restore("user",url);this.refresh();}
  async setAutomaticLikes(enabled:boolean){this.settings.xLikesEnabled=String(enabled);await this.savePrefs();await this.provider?.localFeedback(enabled);}
  async controlCycle(action:"start"|"pause"|"stop",maxPages=100){
    const snapshot=this.panelSnapshot();const projectId=(action!=="start"?this.provider?.cycle?.snapshot().projectId:undefined)||snapshot.projects.find(p=>p.isX&&p.id===snapshot.projectId)?.id||snapshot.projects.find(p=>p.isX)?.id;if(!this.provider||!projectId)throw Error("Connect X and register its project first.");
    const value=await this.provider.execute("source_scraper_control_cycle",{projectId,action,maxPages});this.updateStatus();return value;
  }
  openCycleControls(){this.closePopover();new CycleControlsModal(this.app,this).open();}
  async saveHumanReview(entity:EntityRecord,decision:"pending"|"approved"|"rejected",reason:string,queueLike=false){
    if(this.provider&&entity.type==="web-resource"&&entity.url){
      if(decision==="rejected")this.provider.memory.reject("user",entity.url,reason,"user-interface");
      await this.provider.saveHumanReview(entity.projectId,entity.key,decision,reason,queueLike);
      if(this.imported){this.imported.records=this.imported.records.filter(e=>!e.url||!this.provider!.memory.rejected("user",e.url));const visible=new Set(this.imported.records.map(e=>e.key));for(const key of this.selected)if(!visible.has(key))this.selected.delete(key);}
    }else{const s=this.settings;await this.cli.review({cliPath:s.cliPath,configPath:s.configPath,nodeExecutable:s.nodeExecutable},entity.projectId,entity.key,decision,reason.trim()||`User marked this resource ${decision}.`);}
  }
  resourceInboxReady(){const entries=this.registeredProjects();return Boolean(this.provider&&entries.length&&(!this.imported||entries.some(p=>p.id===this.imported!.projectId)));}
  resourceInboxProject(){const id=this.imported?.projectId;return this.registeredProjects().some(p=>p.id===id)?id!:this.panelSnapshot().projectId;}
  async queryResourceInbox(args:Record<string,unknown>){if(!this.provider)throw Error("Configure the local engine first.");return this.provider.getResources(args);}
  async reviewResourceInbox(args:Record<string,unknown>){if(!this.provider)throw Error("Configure the local engine first.");this.reviewRequest++;const result=await this.provider.reviewResources(args,"user-interface");if(this.imported){this.imported.records=this.imported.records.filter(e=>!e.url||!this.provider!.memory.rejected("user",e.url));for(const e of this.imported.records)if(e.url){const human=this.provider.memory.humanReview("user",e.url);if(human)e.review=human.decision;}}return result;}
  private batchSaving=false;
  async saveReviewBatch(changes:ReviewChange[],reason:string,stopped:()=>boolean,progress:(results:ReviewResult[])=>void){
    if(this.batchSaving)throw Error("A review batch is still saving. Try again when it finishes.");
    if(reason.length>1000)throw Error("Keep the review reason within 1,000 characters.");
    this.batchSaving=true;this.reviewRequest++;
    try{return await runReviewBatch(changes,async({entity,decision})=>{
      await this.saveHumanReview(entity,decision,reason,false);entity.review=decision;
      const current=this.imported?.records.find(e=>e.projectId===entity.projectId&&e.key===entity.key);if(current)current.review=decision;
    },{stopped,progress});}finally{this.batchSaving=false;this.refresh();}
  }
  private reviewRequest=0;
  reviewTruncated=false;
  async refreshResources(force=false){
    if(!this.provider||this.batchSaving)return;
    if(this.resourceInboxReady()){if(force)this.refresh();return;}
    const entries=this.registeredProjects(),id=entries.some(p=>p.id===this.imported?.projectId)?this.imported!.projectId:this.panelSnapshot().projectId;
    if(!id||this.imported&&!entries.some(p=>p.id===this.imported!.projectId))return;
    const request=++this.reviewRequest,records:EntityRecord[]=[];
    try{
      while(records.length<5000){const page=await this.provider.execute("source_scraper_list_findings",{projectId:id,limit:500,offset:records.length,evaluation:"all"}) as {records:EntityRecord[]};if(request!==this.reviewRequest||this.unloaded)return;records.push(...page.records);if(page.records.length<500)break;}
      if(request!==this.reviewRequest||this.unloaded)return;
      this.reviewTruncated=records.length===5000;this.imported={schemaVersion:1,dataset:"entities",projectId:id,records};const keys=new Set(records.map(e=>e.key));for(const key of this.selected)if(!keys.has(key))this.selected.delete(key);this.refresh();
    }catch(error){if(request===this.reviewRequest&&!this.unloaded)new Notice("Resources could not refresh: "+errorMessage(error));}
  }
  setImported(data:EntityExport):void{this.reviewRequest++;this.reviewTruncated=false;this.imported=data;this.selected.clear();this.refresh();}
  getSelected():EntityRecord[]{
    return (this.imported?.records??[]).filter(x=>this.selected.has(x.key));
  }
  refresh():void{
    this.updateStatus(true);
  }
  async openView(showResults=false):Promise<void>{
    if(this.unloaded||!this.statusItem)return;
    if(!this.popover)this.popover=new ScraperPopover(this.statusItem,{
      hasReviewInbox:()=>this.resourceInboxReady(),reviewInboxKey:()=>this.resourceInboxProject(),refreshResults:force=>this.refreshResources(force),
      snapshot:()=>this.panelSnapshot(),icon:(root,name)=>setIcon(root,name),
      settings:()=>{(this.app as unknown as {setting:{open():void;openTabById(id:string):void}}).setting.open();(this.app as unknown as {setting:{openTabById(id:string):void}}).setting.openTabById(this.manifest.id);},
      setup:()=>new XFeedSetupModal(this.app,this).open(),filters:()=>new FeedFiltersModal(this.app,this).open(),
      cycle:()=>this.openCycleControls(),
      importFindings:()=>new ImportModal(this.app,this).open(),
      disconnect:()=>{void this.forgetLocalSession().catch(notify);},
      collect:id=>{void this.collectSelected(id);},
      cancel:()=>{const jobId=this.uiJobId||this.provider?.activity().jobId;if(jobId&&this.provider)void this.provider.execute("source_scraper_cancel_run",{jobId}).catch(notify);else{this.provider?.cycle.stop();this.cli.cancel();}},
      selectProject:id=>{
        if(this.isCollecting())return;
        const p=this.registeredProjects().find(p=>p.id===id);if(p){this.settings.configPath=p.configPath;this.uiError="";this.uiMessage="";void this.savePrefs().catch(notify);}
      },
      renderReview:root=>{this.review??=new ScraperReview(undefined,this);this.review.mount(root);},unmountReview:()=>this.review?.unmount(),
      renderTools:root=>{this.review??=new ScraperReview(undefined,this);this.review.renderTools(root);}
    });
    if(showResults)this.popover.showReview();else this.popover.open();
  }
}
