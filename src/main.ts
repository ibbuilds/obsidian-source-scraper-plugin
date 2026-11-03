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
    root.createEl("h3",{text:"Importar resultados"});
    paragraph(root,"Pega un archivo de resultados JSON o selecciona uno de tu bóveda.");
    const files=this.app.vault.getFiles().filter(file=>/\.(json|ndjson)$/i.test(file.path));
    new Setting(root).setName("Archivo JSON de la bóveda")
      .setDesc("Opcional: también puedes pegar los datos abajo.")
      .addDropdown(d=>{
        d.addOption("","Pegar datos");
        for(const file of files.slice(0,200))d.addOption(file.path,file.path);
        d.setValue("").onChange(value=>{this.selectedFile=value;});
      });
    const input=root.createEl("textarea",{attr:{rows:"11",placeholder:"Pega aquí los resultados JSON o NDJSON"}});
    input.addEventListener("input",()=>{this.pasted=input.value;});
    new Setting(root).addButton(b=>b.setButtonText("Importar")
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
          await this.plugin.openView(true);
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
    root.createEl("h3",{text:"Editar proyecto"});
    paragraph(root,"Edita un proyecto de Source Scraper. Validarlo no ejecuta una búsqueda ni guarda notas.");
    const candidates=this.app.vault.getFiles()
      .filter(f=>f.extension==="json"&&f.stat.size<=200000);
    new Setting(root).setName("Proyecto existente")
      .setDesc("Opcional. Puedes consultar un archivo JSON sin modificarlo.")
      .addDropdown(d=>{
        d.addOption("","Usar plantilla");
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
    status.setText("Valida o copia el JSON. Los proyectos nuevos se crean en el espacio de trabajo externo mediante MCP.");
    new Setting(root).addButton(b=>b.setButtonText("Validar proyecto")
      .onClick(()=>{
        try{
          const manifest=parseProjectManifest(this.body);
          status.setText("Proyecto válido\n"+
            "ID: "+manifest.id+"\nSources: "+manifest.sources.length+
            "\nPipeline: "+manifest.pipeline.join(", ")+
            "\nOutputs: "+manifest.outputs.length+
            "\nThe engine performs adapter-specific validation when run. No sources executed.");
        }catch(error){status.setText(errorMessage(error));}
      }));
    new Setting(root).addButton(b=>b.setButtonText("Usar proyecto")
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
          new Notice("Proyecto seleccionado. No se ha iniciado una búsqueda.");
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
    root.createEl("h3",{text:"Formato de borradores"});
    paragraph(root,"Elige las propiedades, el título y las secciones de los borradores. Esta configuración no cambia notas existentes.");
    const area=root.createEl("textarea",{attr:{rows:"12",placeholder:"Configuración JSON del borrador"}});
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
      }else result.setText("Formato válido. Selecciona un recurso para ver una muestra.");
    };
    new Setting(root).addButton(b=>b.setButtonText("Ver muestra")
      .onClick(()=>{try{validate();}catch(error){result.setText(errorMessage(error));}}));
    new Setting(root).addButton(b=>b.setButtonText("Guardar formato")
      .setCta().onClick(async()=>{
        try{
          const mapping=parseNoteMapping(this.text);
          this.plugin.settings.noteMappingJson=JSON.stringify(mapping,null,2);
          await this.plugin.savePrefs();
          this.close();
          new Notice("Formato guardado.");
        }catch(error){notify(error);}
      }));
    new Setting(root).addButton(b=>b.setButtonText("Restablecer plantilla")
      .onClick(()=>{
        this.text=DEFAULT_NOTE_MAPPING_JSON;
        area.value=this.text;
        result.setText("Plantilla cargada. Pulsa Guardar formato para aplicarla.");
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
    const root=this.contentEl;root.empty();root.addClass("source-scraper-modal");
    root.createEl("h3",{text:this.entity.title});
    if(this.entity.url)root.createEl("a",{text:"Abrir recurso ↗",href:this.entity.url,attr:{target:"_blank",rel:"noopener noreferrer"}});
    const description=this.entity.attributes.description;
    if(typeof description==="string")paragraph(root,description.slice(0,1500));
    root.createEl("h4",{text:"Por qué aparece"});
    const reasons=root.createEl("ul");for(const reason of this.entity.reasons)reasons.createEl("li",{text:reason});
    paragraph(root,"Relevancia: "+this.entity.score+"/100 · "+(this.entity.provenance?.mentions.length??0)+" menciones adjuntas. La puntuación es orientativa.");
    const technical=root.createEl("details");technical.createEl("summary",{text:"Ver evidencia completa"});
    const pre=technical.createEl("pre");
    pre.addClass("ss-preview");
    pre.setText(JSON.stringify({
      projectId:this.entity.projectId,key:this.entity.key,type:this.entity.type,
      url:this.entity.url??null,attributes:this.entity.attributes,
      score:this.entity.score,confidence:this.entity.confidence,
      review:this.entity.review,reasons:this.entity.reasons,
      provenance:this.entity.provenance??"Not included in export"
    },null,2));
    void this.plugin.showAgentAssessments(this.entity,technical);
    if(!this.plugin.settings.cliPath||!this.plugin.settings.configPath){

      return;
    }
    const reviewControls=root.createEl("details");reviewControls.createEl("summary",{text:"Mi revisión"});
    new Setting(reviewControls).setName("Decisión").addDropdown(d=>d.addOptions({
      pending:"Pendiente",approved:"Aprobado",rejected:"Descartado"
    }).setValue(this.decision).onChange(value=>{
      this.decision=value as "pending"|"approved"|"rejected";
    }));
    new Setting(reviewControls).setName("Motivo").addTextArea(t=>
      t.setPlaceholder("¿Qué comprobaste?")
        .onChange(value=>{this.reason=value;}));
    new Setting(reviewControls).addButton(b=>b.setButtonText("Guardar revisión")
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
          new Notice("Revisión guardada en el proyecto.");
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
    super(app);this.folder=plugin.settings.outputFolder.trim()||"Source Scraper/Imported";
  }
  onOpen():void{
    const root=this.contentEl;root.empty();root.addClass("source-scraper-modal");
    root.createEl("h3",{text:"Borradores"});
    paragraph(root,"Revisa el borrador. No se guarda ninguna nota desde este panel.");
    const preview=root.createEl("pre",{cls:"ss-preview"});
    const refresh=()=>{
      try{
        const mapping=parseNoteMapping(this.plugin.settings.noteMappingJson);
        const plans=selectedPlans(this.folder,this.records,mapping);
        preview.setText(plans.map(x=>x.path).join("\n")+
          (plans.length?"\n\nPrimer borrador:\n\n"+plans[0].content.slice(0,3500):""));
      }catch(error){preview.setText(errorMessage(error));}
    };
    new Setting(root).setName("Carpeta de destino")
      .setDesc("Ruta dentro de tu bóveda para los borradores.")
      .addText(t=>t.setPlaceholder("Source Scraper/Imported")
        .setValue(this.folder).onChange(value=>{this.folder=value;refresh();}));
    refresh();
    paragraph(root,"Para guardarlo, pídeselo a ChatGPT mediante tu conector de Obsidian.");
  }
  onClose():void{this.contentEl.empty();}
}
class RunModal extends Modal {
  private busy=false;
  constructor(app:Plugin["app"],private plugin:ScraperPlugin){super(app);}
  onOpen():void{
    const root=this.contentEl;root.empty();
    root.createEl("h3",{text:"Ejecutar proyecto"});
    paragraph(root,"Ejecuta las fuentes del proyecto configurado y muestra sus resultados. No guarda notas.");
    paragraph(root,"CLI: "+(this.plugin.settings.cliPath||"Not configured"));
    paragraph(root,"Project: "+(this.plugin.settings.configPath||"Not configured"));
    new Setting(root).addButton(b=>b.setButtonText("Buscar recursos")
      .setCta().onClick(async()=>{
        if(this.busy)return;
        this.busy=true;
        try{
          const s=this.plugin.settings;
          if(!s.cliPath||!s.configPath)throw new Error("Configura el motor y una fuente en los ajustes.");
          const imported=await this.plugin.cli.runAndImport({
            cliPath:s.cliPath,configPath:s.configPath,nodeExecutable:s.nodeExecutable,allowXProvider:s.xProviderEnabled==="true",xPythonPath:s.xPythonPath,xSession:this.plugin.localSession()
          });
          this.plugin.setImported(imported);
          this.close();
          new Notice("Búsqueda terminada. Recursos disponibles.");
        }catch(error){notify(error);}
        finally{this.busy=false;}
      }));
    new Setting(root).addButton(b=>b.setButtonText("Detener")
      .onClick(()=>{this.plugin.cli.cancel();this.close();}));
  }
}
class XFeedSetupModal extends Modal {
  private clearSecrets?:()=>void;
  constructor(app:Plugin["app"],private plugin:ScraperPlugin){super(app);}
  onOpen():void{
    const root=this.contentEl;root.empty();root.addClass("source-scraper-modal","ss-x-setup");root.createEl("h3",{text:"Conectar X"});
    paragraph(root,"Usa tu sesión de X para leer tu feed Para ti. No necesitas una API de pago.");
    const instructions=root.createEl("details",{cls:"ss-session-help"});instructions.createEl("summary",{text:"¿Dónde encuentro estos datos?"});
    const steps=instructions.createEl("ol");
    for(const text of ["Abre x.com e inicia sesión en tu navegador.","Pulsa F12. En Chrome o Edge, abre Application → Cookies → https://x.com.","Copia los valores de twid, auth_token y ct0 en los campos de abajo. No los envíes al chat."])steps.createEl("li",{text});
    instructions.createEl("a",{text:"Abrir X ↗",href:"https://x.com/home",attr:{target:"_blank",rel:"noopener noreferrer"}});
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
    new Setting(root).setName("Cuenta (twid)").setDesc("Puedes pegar twid completo o tu ID numérico.").addText(t=>t.setValue(accountId).setPlaceholder("u=123456789").onChange(value=>{accountId=value;}));
    for(const [label,key] of [["auth_token","session"],["ct0","csrf"]] as const){
      new Setting(root).setName(label).addText(t=>{t.inputEl.type="password";t.inputEl.autocomplete="off";t.inputEl.spellcheck=false;t.inputEl.setAttribute("aria-label",label);secretInputs.push(t.inputEl);t.onChange(value=>{if(key==="session")accountSession=value;else csrf=value;});});
    }
    if(existingSession)paragraph(root,"Ya hay una sesión cargada. Deja auth_token y ct0 vacíos para conservarla.");
    paragraph(root,this.plugin.canRememberSession()?"La sesión se guarda cifrada para tu usuario de Windows y se restaura al abrir Obsidian. Desconectar X borra la sesión guardada.":"En este sistema la sesión se mantiene en memoria hasta cerrar Obsidian. No se guarda en ajustes ni en notas.");
    const filters=root.createEl("details",{cls:"ss-session-filters"});filters.createEl("summary",{text:"Filtros de búsqueda"});
    new Setting(filters).setName("Incluir palabras").addTextArea(t=>t.setValue(include).onChange(value=>{include=value;}));
    new Setting(filters).setName("Excluir palabras").addTextArea(t=>t.setValue(exclude).onChange(value=>{exclude=value;}));
    new Setting(filters).setName("Relevancia mínima (0–100)").addText(t=>t.setValue(String(minimum)).onChange(value=>{minimum=Number(value);}));
    new Setting(filters).setName("Páginas por búsqueda (1–10)").addText(t=>t.setValue(String(pages)).onChange(value=>{pages=Number(value);}));
    const status=root.createEl("p",{cls:"ss-form-status"});status.setAttribute("role","status");
    new Setting(root).addButton(button=>button.setButtonText("Conectar").setCta().onClick(async()=>{
      if(busy)return;busy=true;button.setDisabled(true);
      try{
        if(this.plugin.isCollecting())throw Error("Detén la búsqueda antes de cambiar la sesión.");
        const session=!accountSession&&!csrf&&this.plugin.localSession()?this.plugin.localSession()!:validateLocalSession(accountSession,csrf);
        if(!this.plugin.settings.xPythonPath||!existsSync(this.plugin.settings.xPythonPath))throw Error("Falta preparar el lector de X en los ajustes de Source Scraper.");
        if(!(this.app.vault.adapter instanceof FileSystemAdapter))throw Error("Se necesita Obsidian de escritorio.");
        if(!Number.isInteger(minimum)||minimum<0||minimum>100)throw Error("Usa una relevancia mínima de 0 a 100.");
        if(!Number.isInteger(pages)||pages<1||pages>10)throw Error("Usa de 1 a 10 páginas por búsqueda.");
        const settings=this.plugin.settings;let manifest=buildXFeedProject(normalizeXAccountId(accountId),include,exclude,minimum,pages);
        const projects=JSON.parse(settings.mcpProjectsJson) as RegisteredProject[];
        if(!Array.isArray(projects))throw Error("Revisa la configuración local de fuentes.");
        let project=projects.find(p=>p.id===(existingId||manifest.id));
        const verify=(entry:RegisteredProject)=>{const raw=readFileSync(entry.configPath,"utf8");if(createHash("sha256").update(raw).digest("hex")!==entry.manifestHash)throw Error("La configuración de esta fuente cambió. Revísala en los ajustes antes de continuar.");return parseProjectManifest(raw);};
        if(project){const prior=verify(project);if(JSON.stringify({...prior,id:manifest.id,name:manifest.name})!==JSON.stringify(manifest)){manifest=xFeedVariant(manifest);project=projects.find(p=>p.id===manifest.id);if(project&&JSON.stringify(verify(project))!==JSON.stringify(manifest))throw Error("La configuración de filtros no coincide.");}}
        if(!project){
          if(projects.length>=100)throw Error("Se alcanzó el límite de fuentes guardadas.");
          project=writeWorkspaceProject(settings.mcpWorkspacePath,this.app.vault.adapter.getBasePath(),manifest);settings.mcpProjectsJson=JSON.stringify([...projects,project]);
        }
        settings.configPath=project.configPath;await this.plugin.savePrefs();await this.plugin.useLocalSession(session);
        this.clearSecrets?.();this.close();await this.plugin.openView();
      }catch(error){status.setText(error instanceof Error&&/Enter both/.test(error.message)?"Pega auth_token y ct0 sin espacios.":errorMessage(error));}
      finally{busy=false;button.setDisabled(false);}
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
    if(!imported){paragraph(root,"Todavía no hay resultados. Haz una búsqueda o importa un archivo.");return;}
    const summary=root.createDiv({cls:"ss-review-summary"});
    summary.createEl("p",{cls:"ss-count",text:imported.records.length+(imported.records.length===1?" recurso":" recursos")});
    if(imported.projectId==="starter-project")summary.createEl("p",{cls:"ss-example-note",text:"Ejemplo local · no es tu feed de X."});
    const searchBox=root.createDiv({cls:"ss-search"});
    const search=new SearchComponent(searchBox).setPlaceholder("Filtrar recursos").setValue(this.search);
    const input=search.inputEl;input.setAttribute("aria-label","Filtrar recursos");
    search.onChange(()=>{
      const cursor=input.selectionStart??input.value.length;this.search=input.value;this.page=0;this.render();
      const restored=root.querySelector<HTMLInputElement>('input[placeholder="Filtrar recursos"]');
      if(restored){restored.focus();const position=Math.min(cursor,this.search.length);restored.setSelectionRange(position,position);}
    });
    const query=this.search.toLowerCase();
    const filtered=imported.records.filter(e=>[e.title,e.key,e.type,e.category].some(value=>value.toLowerCase().includes(query)));
    const pageSize=40,pageCount=Math.max(1,Math.ceil(filtered.length/pageSize));this.page=Math.min(this.page,pageCount-1);
    const list=root.createDiv({cls:"ss-candidate-list"});list.setAttribute("aria-label","Recursos encontrados");
    const visible=filtered.slice(this.page*pageSize,(this.page+1)*pageSize);
    if(!visible.length){const empty=list.createDiv({cls:"ss-empty-results"});empty.createEl("strong",{text:"No hay coincidencias"});paragraph(empty,"Prueba otra palabra.");}
    for(const entity of visible){
      const item=list.createEl("article",{cls:"ss-record"});
      const head=item.createDiv({cls:"ss-record-head"});
      const checkbox=head.createEl("input",{type:"checkbox",cls:"ss-select-control",attr:{'aria-label':"Seleccionar "+entity.title}});
      checkbox.checked=this.plugin.selected.has(entity.key);checkbox.dataset.key=entity.key;
      checkbox.addEventListener("change",()=>{
        if(checkbox.checked)this.plugin.selected.add(entity.key);else this.plugin.selected.delete(entity.key);
        this.render();Array.from(root.querySelectorAll<HTMLInputElement>(".ss-select-control")).find(node=>node.dataset.key===entity.key)?.focus();
      });
      const inspect=new ButtonComponent(head).setButtonText(entity.title).onClick(()=>{this.plugin.closePopover();new DetailModal(this.app,this.plugin,entity).open();}).buttonEl;
      inspect.classList.add("ss-record-title");inspect.type="button";inspect.setAttribute("aria-label","Ver detalle: "+entity.title);
      const source=item.createDiv({cls:"ss-record-source"});
      if(entity.url){
        const link=source.createEl("a",{href:entity.url,text:new URL(entity.url).hostname.replace(/^www\./,""),attr:{target:"_blank",rel:"noopener noreferrer"}});
        link.setAttribute("aria-label","Abrir recurso: "+entity.title);
      }else source.createSpan({text:entity.type.replace(/[-_]/g," ")});
      const description=typeof entity.attributes.description==="string"?entity.attributes.description:entity.reasons[0];
      if(description)item.createEl("p",{cls:"ss-record-description",text:description.slice(0,180)});
      if(entity.review!=="pending"){const decision=item.createSpan({cls:"ss-review-decision",text:entity.review==="approved"?"Aprobado":"Descartado"});decision.dataset.review=entity.review;}
    }
    const pagination=root.createDiv({cls:"ss-pagination"});pagination.hidden=pageCount===1;
    const previous=pagination.createEl("button",{text:"Anterior"});previous.disabled=this.page===0;previous.onclick=()=>{this.page--;this.render();};
    pagination.createSpan({text:"Página "+(this.page+1)+" de "+pageCount});
    const next=pagination.createEl("button",{text:"Siguiente"});next.disabled=this.page>=pageCount-1;next.onclick=()=>{this.page++;this.render();};
    const selected=this.plugin.getSelected();
    const draftArea=root.createDiv({cls:"ss-review-footer"});
    const selection=draftArea.createSpan({cls:"ss-selection-count",text:selected.length+(selected.length===1?" seleccionado":" seleccionados")});selection.setAttribute("role","status");
    const preview=new ButtonComponent(draftArea).setButtonText("Ver borradores").setTooltip("Vista previa para ChatGPT; no guarda notas").setDisabled(selected.length===0).onClick(()=>{
      try{
        if(!selected.length)throw Error("Selecciona recursos antes de preparar notas.");
        if(selected.length>200)throw Error("Selecciona como máximo 200 recursos.");
        this.plugin.closePopover();new ExportModal(this.app,this.plugin,selected).open();
      }catch(error){notify(error);}
    }).buttonEl;preview.classList.add("ss-preview-action");preview.type="button";
  }
  renderTools(controls:HTMLElement):void{
    const action=(text:string,click:()=>void)=>{new ButtonComponent(controls).setButtonText(text).onClick(()=>{this.plugin.closePopover();click();});};
    action("Editar proyecto",()=>new ProjectModal(this.app,this.plugin).open());
    action("Formato de borradores",()=>new NoteMappingModal(this.app,this.plugin).open());
    action("Ejecutar proyecto",()=>new RunModal(this.app,this.plugin).open());
    action("Diagnóstico",()=>new Notice("Engine CLI: "+(this.plugin.settings.cliPath?"configured":"not connected")+"; "+(this.plugin.imported?.records.length??0)+" sources; no automatic writes."));
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
      .setDesc("Local manifest to run only when you press Run. Use Editar proyecto to create a new config without overwriting existing files.")
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
    try{const saved=await this.sessionStore?.load();if(!this.unloaded&&saved){this.memorySession=saved;this.uiMessage="Sesión de X restaurada. Puedes buscar recursos.";}}
    catch{this.uiError="No se pudo restaurar la sesión cifrada de X. Pulsa Conectar X para renovarla.";}
  }
  private changeSession(operation:()=>Promise<void>):Promise<void>{
    const pending=this.sessionChange.then(operation);this.sessionChange=pending.catch(()=>{});return pending;
  }
  async forgetLocalSession():Promise<void>{
    return this.changeSession(async()=>{
      const previous=this.memorySession,allowed=this.settings.xProviderEnabled;
      this.memorySession=undefined;this.settings.xProviderEnabled="false";
      try{if(this.sessionStore)await this.sessionStore.forgetAndCommit(()=>this.savePrefs());else await this.savePrefs();this.uiMessage="Sesión de X desconectada y borrada de este equipo.";}
      catch(error){if(!this.unloaded)this.memorySession=previous;this.settings.xProviderEnabled=allowed;throw error;}
    });
  }
  async useLocalSession(value:XLocalSession):Promise<void>{
    const session=validateLocalSession(value.accountSession,value.csrf);
    return this.changeSession(async()=>{
      if(this.unloaded)throw Error("Source Scraper ya está cerrado.");
      const previous=this.memorySession,allowed=this.settings.xProviderEnabled;
      this.memorySession={...session};this.settings.xProviderEnabled="true";
      try{
        if(this.sessionStore)await this.sessionStore.saveAndCommit(session,()=>this.savePrefs());else await this.savePrefs();
        this.uiError="";this.uiMessage=this.canRememberSession()?"Sesión de X guardada y cargada. Haz una búsqueda para verificar acceso.":"Sesión de X cargada. Haz una búsqueda para verificar acceso.";
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
  isCollecting():boolean{return this.uiStarting||this.cli.running||Boolean(this.provider?.activity().running);}
  private panelSnapshot():PanelSnapshot{
    const list=this.registeredProjects(),projects=this.projectsForPanel(),readiness=xFeedReadiness(this.memorySession);
    const activity=this.provider?.activity();
    return {engine:Boolean(this.settings.cliPath&&existsSync(this.settings.cliPath)),mcp:Boolean(this.provider),python:Boolean(this.settings.xPythonPath&&existsSync(this.settings.xPythonPath)),
      session:readiness.accountSessionConfigured&&readiness.csrfConfigured,xAllowed:this.settings.xProviderEnabled==="true",
      projects,projectId:list.find(p=>p.configPath===this.settings.configPath)?.id||"",findings:this.imported?.records.length??0,
      findingProject:projects.find(p=>p.id===this.imported?.projectId)?.name||this.imported?.projectId||"",
      exampleFindings:this.imported?.projectId==="starter-project",
      running:this.isCollecting(),error:this.uiError||(activity?.lastState==="failed"?activity.error:undefined),message:this.uiMessage};
  }
  private placeStatus():void{
    const item=this.statusItem,parent=item?.parentElement;if(!item||!parent)return;
    const chat=parent.querySelector<HTMLElement>(".cmt-status");
    if(chat?.parentElement===parent&&chat.nextElementSibling!==item)chat.after(item);
  }
  private updateStatus(dataChanged=false):void{
    if(this.unloaded||!this.statusItem)return;
    const state=discoveryState(this.panelSnapshot()),label="Source Scraper. "+state.status+". Abrir Source Scraper.";
    if(this.statusItem.dataset.state!==state.state)this.statusItem.dataset.state=state.state;
    if(this.statusItem.title!==label)this.statusItem.title=label;
    if(this.statusItem.getAttribute("aria-label")!==label)this.statusItem.setAttribute("aria-label",label);
    this.popover?.update(dataChanged);
  }
  closePopover(restoreFocus=false):void{this.popover?.close(restoreFocus);}
  private async collectSelected(projectId?:string):Promise<void>{
    if(this.isCollecting()||this.unloaded)return;
    const provider=this.provider,id=projectId||this.panelSnapshot().projectId;if(!provider||!id)return;
    this.uiStarting=true;this.uiError="";this.uiMessage="Buscando…";this.updateStatus();
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
      if(!this.unloaded){this.uiMessage="Búsqueda terminada.";this.uiError="";}
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
  async openView(showResults=false):Promise<void>{
    if(this.unloaded||!this.statusItem)return;
    if(!this.popover)this.popover=new ScraperPopover(this.statusItem,{
      snapshot:()=>this.panelSnapshot(),icon:(root,name)=>setIcon(root,name),
      settings:()=>{(this.app as unknown as {setting:{open():void;openTabById(id:string):void}}).setting.open();(this.app as unknown as {setting:{openTabById(id:string):void}}).setting.openTabById(this.manifest.id);},
      setup:()=>new XFeedSetupModal(this.app,this).open(),
      importFindings:()=>new ImportModal(this.app,this).open(),
      disconnect:()=>{void this.forgetLocalSession().catch(notify);},
      collect:id=>{void this.collectSelected(id);},
      cancel:()=>{const jobId=this.uiJobId||this.provider?.activity().jobId;if(jobId&&this.provider)void this.provider.execute("source_scraper_cancel_run",{jobId}).catch(notify);else this.cli.cancel();},
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
