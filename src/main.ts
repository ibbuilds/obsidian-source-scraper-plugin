import {dialog,action,formStatus,labelFields} from "./form-ui.ts";
import {feedFilterForm,applyFeedFilterForm} from "./filter-form.ts";
import {ReviewIndex} from "./review-index.ts";
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
    const {body:root,footer}=dialog(this,"Importar resultados",false);
    action(footer,"Cerrar",()=>this.close());
    paragraph(root,"Pega resultados del motor o elige un archivo de tu bóveda.");
    const files=this.app.vault.getFiles().filter(file=>/\.(json|ndjson)$/i.test(file.path));
    new Setting(root).setName("Archivo JSON de la bóveda")
      .setDesc("Opcional: también puedes pegar los datos abajo.")
      .addDropdown(d=>{
        d.addOption("","Pegar datos");
        for(const file of files.slice(0,200))d.addOption(file.path,file.path);
        d.setValue("").onChange(value=>{this.selectedFile=value;input.disabled=Boolean(value);});
      });
    const input=root.createEl("textarea",{cls:"ss-code-input",attr:{rows:"8","aria-label":"Resultados JSON o NDJSON",placeholder:"Pega los resultados JSON o NDJSON del motor"}});
    input.addEventListener("input",()=>{this.pasted=input.value;});
    new Setting(footer).addButton(b=>b.setButtonText("Importar")
      .setCta().onClick(async()=>{
        try{
          let text=this.selectedFile?"":this.pasted;
          if(!text.trim()&&this.selectedFile){
            const file=this.app.vault.getAbstractFileByPath(this.selectedFile);
            if(!(file instanceof TFile))throw new Error("El archivo de resultados ya no está disponible.");
            if(file.stat.size>8_000_000)throw new Error("El archivo supera el límite de 8 MB.");
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
    const {body:root,footer}=dialog(this,"Editar proyecto",true);
    action(footer,"Cerrar",()=>this.close());
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
            if(!(file instanceof TFile))throw Error("El archivo del proyecto ya no está disponible.");
            const input=await this.app.vault.read(file);
            const manifest=parseProjectManifest(input);
            this.body=JSON.stringify(manifest,null,2);
            area.value=this.body;
            status.setText("Proyecto cargado: "+manifest.id+". El archivo no ha cambiado.");
          }catch(error){notify(error);}
        });
      });
    const area=root.createEl("textarea",{
      cls:"ss-code-input",attr:{rows:"12","aria-label":"Configuración del proyecto en JSON",placeholder:"Configuración del proyecto en JSON"}
    });
    area.value=this.body;
    area.addEventListener("input",()=>{
      this.body=area.value;
      // Once edited, do not claim that the selected existing file is identical.
      this.selectedPath="";
    });
    const status=root.createEl("pre",{cls:"ss-preview"});
    status.setText("Valida o copia el JSON. Los proyectos nuevos se crean en el espacio de trabajo externo mediante MCP.");
    new Setting(footer).addButton(b=>b.setButtonText("Validar proyecto")
      .onClick(()=>{
        try{
          const manifest=parseProjectManifest(this.body);
          status.setText("Proyecto válido\n"+
            "ID: "+manifest.id+"\nFuentes: "+manifest.sources.length+
            "\nProcesadores: "+manifest.pipeline.join(", ")+
            "\nSalidas: "+manifest.outputs.length+
            "\nEl motor valida cada fuente al ejecutar. No se ha iniciado ninguna búsqueda.");
        }catch(error){status.setText(errorMessage(error));}
      }));
    new Setting(footer).addButton(b=>b.setButtonText("Usar proyecto")
      .onClick(async()=>{
        try{
          if(!this.selectedPath)throw Error("Elige un proyecto existente para usarlo.");
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
    const {body:root,footer}=dialog(this,"Formato de borradores",true);
    action(footer,"Cerrar",()=>this.close());
    paragraph(root,"Elige las propiedades, el título y las secciones de los borradores. Esta configuración no cambia notas existentes.");
    const area=root.createEl("textarea",{cls:"ss-code-input",attr:{rows:"12","aria-label":"Formato del borrador en JSON",placeholder:"Configuración JSON del borrador"}});
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
    new Setting(footer).addButton(b=>b.setButtonText("Ver muestra")
      .onClick(()=>{try{validate();}catch(error){result.setText(errorMessage(error));}}));
    new Setting(footer).addButton(b=>b.setButtonText("Guardar formato")
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
    labelFields(root);
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
    const {body:root,footer}=dialog(this,this.entity.title);action(footer,"Cerrar",()=>this.close());
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
      provenance:this.entity.provenance??"No incluida en esta importación"
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
    const {body:root,footer}=dialog(this,"Borradores",true);
    action(footer,"Cerrar",()=>this.close());
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
    root.appendChild(preview);refresh();
    paragraph(root,"Para guardarlo, pídeselo a ChatGPT mediante tu conector de Obsidian.");
    labelFields(root);
  }
  onClose():void{this.contentEl.empty();}
}
class RunModal extends Modal {
  private busy=false;
  constructor(app:Plugin["app"],private plugin:ScraperPlugin){super(app);}
  onOpen():void{
    const {body:root,footer}=dialog(this,"Ejecutar proyecto");action(footer,"Cerrar",()=>this.close());
    paragraph(root,"Ejecuta las fuentes del proyecto configurado y muestra sus resultados. No guarda notas.");
    paragraph(root,"Motor: "+(this.plugin.settings.cliPath?"Preparado":"Sin configurar"));
    paragraph(root,"Proyecto: "+(this.plugin.registeredProjects().find(p=>p.configPath===this.plugin.settings.configPath)?.id||"Sin seleccionar"));
    new Setting(footer).addButton(b=>b.setButtonText("Buscar recursos")
      .setCta().onClick(async()=>{
        if(this.busy)return;
        this.busy=true;b.setDisabled(true);stop.setDisabled(false);
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
        finally{this.busy=false;b.setDisabled(false);stop.setDisabled(true);}
      }));
    const stop=action(footer,"Detener",()=>{this.plugin.cli.cancel();this.close();});stop.setDisabled(true);
    labelFields(root);
  }
}
class XFeedSetupModal extends Modal {
  private clearSecrets?:()=>void;
  constructor(app:Plugin["app"],private plugin:ScraperPlugin){super(app);}
  onOpen():void{
    const {body:root,footer}=dialog(this,"Conectar X");root.addClass("ss-x-setup");action(footer,"Cancelar",()=>this.close());
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
    new Setting(root).setName("ID de cuenta · twid").setDesc("Puedes pegar twid completo o tu ID numérico.").addText(t=>t.setValue(accountId).setPlaceholder("u=123456789").onChange(value=>{accountId=value;}));
    for(const [label,key] of [["auth_token","session"],["ct0","csrf"]] as const){
      new Setting(root).setName(label).setDesc(label==="auth_token"?"Cookie de acceso a tu cuenta.":"Cookie de validación de la sesión.").addText(t=>{t.setPlaceholder(existingSession?"Vacío conserva la sesión actual":"Pega el valor de "+label);t.inputEl.type="password";t.inputEl.autocomplete="off";t.inputEl.spellcheck=false;t.inputEl.setAttribute("aria-label",label);secretInputs.push(t.inputEl);t.onChange(value=>{if(key==="session")accountSession=value;else csrf=value;});});
    }
    if(existingSession)paragraph(root,"Ya hay una sesión cargada. Deja auth_token y ct0 vacíos para conservarla.");
    paragraph(root,this.plugin.canRememberSession()?"Se guarda cifrada en este equipo. No tendrás que pegarla al reiniciar Obsidian.":"En este sistema la sesión se mantiene en memoria hasta cerrar Obsidian. No se guarda en ajustes ni en notas.");
    const status=formStatus(root);
    new Setting(footer).addButton(button=>button.setButtonText("Conectar").setCta().onClick(async()=>{
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
        if(project){const prior=verify(project);const account=normalizeXAccountId(accountId);if(prior.sources.some(source=>source.adapter==="x-for-you-local"&&String(source.config.accountId)===account)){manifest=prior;}else{manifest=xFeedVariant(manifest);project=projects.find(p=>p.id===manifest.id);if(project)verify(project);}}
        if(!project){
          if(projects.length>=100)throw Error("Se alcanzó el límite de fuentes guardadas.");
          project=writeWorkspaceProject(settings.mcpWorkspacePath,this.app.vault.adapter.getBasePath(),manifest);settings.mcpProjectsJson=JSON.stringify([...projects,project]);
        }
        settings.configPath=project.configPath;await this.plugin.savePrefs();await this.plugin.useLocalSession(session);
        this.clearSecrets?.();this.close();await this.plugin.openView();
      }catch(error){status.setText(error instanceof Error&&/Enter both/.test(error.message)?"Pega auth_token y ct0 sin espacios.":errorMessage(error));}
      finally{busy=false;button.setDisabled(false);}
    }));
    labelFields(root);
  }
  onClose():void{this.clearSecrets?.();this.clearSecrets=undefined;this.contentEl.empty();}
}
class FeedFiltersModal extends Modal {
  constructor(app:Plugin["app"],private plugin:ScraperPlugin){super(app);}
  onOpen():void{
    const {body:root,footer}=dialog(this,"Filtros de búsqueda");root.addClass("ss-filter-form");
    action(footer,"Cancelar",()=>this.close());
    try{
      const entries=this.plugin.registeredProjects();
      const ordered=[...entries].sort((a,b)=>Number(b.configPath===this.plugin.settings.configPath)-Number(a.configPath===this.plugin.settings.configPath));
      const entry=ordered.find(p=>{try{return parseProjectManifest(readFileSync(p.configPath,"utf8")).sources.some(source=>source.adapter==="x-for-you-local");}catch{return false;}});
      if(!entry)throw Error("Conecta X antes de configurar sus filtros.");
      const raw=readFileSync(entry.configPath,"utf8");
      if(createHash("sha256").update(raw).digest("hex")!==entry.manifestHash)throw Error("La configuración cambió. Revisa el proyecto en los ajustes.");
      const project=parseProjectManifest(raw);
      if(!project.sources.some(source=>source.adapter==="x-for-you-local"))throw Error("Selecciona tu fuente de X para editar estos filtros.");
      const values=feedFilterForm(project);
      paragraph(root,"Sólo pasan enlaces que cumplen todas las condiciones. Los campos vacíos no añaden restricciones.");
      new Setting(root).setName("Incluir términos").setDesc("Separados por comas. Se buscan en la publicación de origen.").addTextArea(t=>t.setValue(values.include).setPlaceholder("Ej.: design system, UI kit, typography").onChange(v=>{values.include=v;}));
      new Setting(root).setName("Coincidencia").addDropdown(d=>d.addOptions({any:"Cualquiera de los términos",all:"Todos los términos"}).setValue(values.mode).onChange(v=>{values.mode=v as "any"|"all";}));
      new Setting(root).setName("Excluir términos").setDesc("Descarta publicaciones que contengan alguna de estas palabras.").addTextArea(t=>t.setValue(values.exclude).setPlaceholder("Ej.: giveaway, sponsored").onChange(v=>{values.exclude=v;}));
      const numeric=(parent:HTMLElement,name:string,key:"days"|"likes"|"reposts"|"pages"|"minimum",placeholder:string,min:number,max:number,description:string)=>{
        new Setting(parent).setName(name).setDesc(description).addText(t=>{t.setValue(values[key]).setPlaceholder(placeholder).onChange(v=>{values[key]=v;});t.inputEl.type="number";t.inputEl.min=String(min);t.inputEl.max=String(max);t.inputEl.step="1";t.inputEl.inputMode="numeric";});
      };
      numeric(root,"Antigüedad máxima · días","days","Sin límite",1,36500,"Ej.: 30 para el último mes; 60 para los últimos dos.");
      const engagement=root.createDiv({cls:"ss-field-pair"});
      numeric(engagement,"Likes mínimos","likes","Sin mínimo",0,Number.MAX_SAFE_INTEGER,"");
      numeric(engagement,"Reposts mínimos","reposts","Sin mínimo",0,Number.MAX_SAFE_INTEGER,"");
      const advanced=root.createEl("details",{cls:"ss-disclosure"});advanced.createEl("summary",{text:"Límite y reglas del perfil"});
      numeric(advanced,"Páginas por búsqueda","pages","1",1,10,"De 1 a 10. Cada página lee una muestra de tu feed.");
      numeric(advanced,"Puntuación mínima de coincidencia","minimum","0",0,100,"Oculta recursos por debajo de esta puntuación de palabras clave. No mide calidad editorial.");
      if(project.filters){const pre=advanced.createEl("pre",{cls:"ss-preview"});pre.setText(JSON.stringify(project.filters,null,2));paragraph(advanced,"Las reglas de fechas, dominios y otras condiciones existentes se conservan.");}
      const status=formStatus(root);let busy=false;
      action(footer,"Guardar filtros",()=>{void (async()=>{
        if(busy)return;busy=true;const before={...this.plugin.settings};
        try{
          if(this.plugin.isCollecting())throw Error("Espera a que termine la búsqueda para cambiar los filtros.");
          if(!(this.app.vault.adapter instanceof FileSystemAdapter))throw Error("Se necesita Obsidian de escritorio.");
          const updated=applyFeedFilterForm(project,values);
          let selected=entry;
          if(JSON.stringify(updated)!==JSON.stringify(project)){
            const variant=xFeedVariant({...updated,id:"x-for-you-resources"});
            const registered=entries.find(p=>p.id===variant.id);
            if(registered){if(createHash("sha256").update(readFileSync(registered.configPath,"utf8")).digest("hex")!==registered.manifestHash)throw Error("El perfil guardado cambió. Revísalo en los ajustes.");selected=registered;}
            else{if(entries.length>=100)throw Error("Se alcanzó el límite de perfiles guardados.");selected=writeWorkspaceProject(this.plugin.settings.mcpWorkspacePath,this.app.vault.adapter.getBasePath(),variant);this.plugin.settings.mcpProjectsJson=JSON.stringify([...entries,selected]);}
          }
          this.plugin.settings.configPath=selected.configPath;await this.plugin.savePrefs();this.close();await this.plugin.openView();new Notice("Filtros guardados. Se aplicarán en la próxima búsqueda.");
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
    const index=new ReviewIndex(imported.records);
    const list=root.createDiv({cls:"ss-candidate-list",attr:{tabindex:"0"}});list.setAttribute("aria-label","Recursos encontrados");
    const pagination=root.createDiv({cls:"ss-pagination"});
    const draftArea=root.createDiv({cls:"ss-review-footer"});
    const selection=draftArea.createSpan({cls:"ss-selection-count"});selection.setAttribute("role","status");
    const preview=new ButtonComponent(draftArea).setButtonText("Ver borradores").setTooltip("Vista previa para ChatGPT; no guarda notas").onClick(()=>{
      try{
        const selected=this.plugin.getSelected();
        if(!selected.length)throw Error("Selecciona recursos antes de preparar notas.");
        if(selected.length>200)throw Error("Selecciona como máximo 200 recursos.");
        this.plugin.closePopover();new ExportModal(this.app,this.plugin,selected).open();
      }catch(error){notify(error);}
    }).buttonEl;preview.classList.add("ss-preview-action");preview.type="button";
    const updateSelection=()=>{
      const count=this.plugin.selected.size;
      selection.textContent=count+(count===1?" seleccionado":" seleccionados");preview.disabled=count===0;
    };
    const renderResults=()=>{
      if(this.root!==root||!root.isConnected)return;
      list.empty();pagination.empty();
      const filtered=index.filter(this.search);
      const pageSize=40,pageCount=Math.max(1,Math.ceil(filtered.length/pageSize));this.page=Math.min(this.page,pageCount-1);
      const visible=filtered.slice(this.page*pageSize,(this.page+1)*pageSize);
      if(!visible.length){const empty=list.createDiv({cls:"ss-empty-results"});empty.createEl("strong",{text:"No hay coincidencias"});paragraph(empty,"Prueba otra palabra.");}
      for(const entity of visible){
        const item=list.createEl("article",{cls:"ss-record"});
        const head=item.createDiv({cls:"ss-record-head"});
        const checkbox=head.createEl("input",{type:"checkbox",cls:"ss-select-control",attr:{'aria-label':"Seleccionar "+entity.title}});
        checkbox.checked=this.plugin.selected.has(entity.key);checkbox.dataset.key=entity.key;
        checkbox.addEventListener("change",()=>{
          if(checkbox.checked)this.plugin.selected.add(entity.key);else this.plugin.selected.delete(entity.key);
          updateSelection();
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
      pagination.hidden=pageCount===1;
      const previous=pagination.createEl("button",{text:"Anterior"});previous.disabled=this.page===0;previous.onclick=()=>{this.page--;renderResults();};
      pagination.createSpan({text:filtered.length?((this.page*pageSize+1)+"–"+Math.min((this.page+1)*pageSize,filtered.length)+" de "+filtered.length):"0 recursos"});
      const next=pagination.createEl("button",{text:"Siguiente"});next.disabled=this.page>=pageCount-1;next.onclick=()=>{this.page++;renderResults();};
    };
    search.onChange(()=>{this.search=input.value;this.page=0;renderResults();});
    renderResults();updateSelection();
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
    const root=this.containerEl;root.empty();root.addClass("ss-settings");
    root.createEl("h2",{text:"Source Scraper"});
    paragraph(root,"Conexión local y preferencias. Los cambios se aplican al guardar.");
    const body=root.createDiv({cls:"ss-settings-body"});
    const draft={...this.plugin.settings},dirty=new Set<keyof Preferences>();
    const change=(key:keyof Preferences,value:string)=>{draft[key]=value;dirty.add(key);};
    const section=(label:string)=>{const part=body.createDiv({cls:"ss-settings-section"});part.createEl("h3",{text:label});return part;};
    const connection=section("Conexión");
    new Setting(connection).setName("Sesión de X").setDesc("Conecta X o renueva una sesión existente.").addButton(b=>b.setButtonText(this.plugin.localSession()?"Cambiar sesión":"Conectar X").onClick(()=>new XFeedSetupModal(this.app,this.plugin).open()));
    new Setting(connection).setName("Lectura de X").setDesc("Permite leer tu feed Para ti. Al desactivarlo se borra la sesión guardada.").addToggle(t=>t.setValue(draft.xProviderEnabled==="true").onChange(v=>{change("xProviderEnabled",String(v));}));
    new Setting(connection).setName("Herramientas para ChatGPT").setDesc("Conecta el motor con Vault as MCP.").addToggle(t=>t.setValue(draft.mcpEnabled==="true").onChange(v=>{change("mcpEnabled",String(v));}));
    const notes=section("Borradores");
    new Setting(notes).setName("Carpeta sugerida").setDesc("Los borradores se previsualizan; el plugin no crea notas.").addText(t=>t.setPlaceholder("Source Scraper/Imported").setValue(draft.outputFolder).onChange(v=>{change("outputFolder",v);}));
    new Setting(notes).setName("Propiedades y contenido").addButton(b=>b.setButtonText("Editar formato").onClick(()=>new NoteMappingModal(this.app,this.plugin).open()));
    const technical=body.createEl("details",{cls:"ss-settings-section ss-disclosure"});technical.createEl("summary",{text:"Configuración del motor"});
    paragraph(technical,"Rutas locales y proyectos autorizados. Normalmente sólo se configuran una vez.");
    for(const [key,label,placeholder] of [["cliPath","Ejecutable del motor","Ruta absoluta a source-scraper.mjs"],["nodeExecutable","Intérprete Node.js","Ruta a node.exe"],["xPythonPath","Intérprete de X","Ruta al Python del proyecto"],["configPath","Proyecto activo","Ruta al archivo del proyecto"],["mcpWorkspacePath","Carpeta de proyectos","Carpeta fuera de tu bóveda"],["mcpCliHash","Huella del motor · SHA-256","64 caracteres hexadecimales"]] as const){
      new Setting(technical).setName(label).addText(t=>t.setValue(draft[key]).setPlaceholder(placeholder).onChange(v=>{change(key,v.trim());}));
    }
    new Setting(technical).setName("Proyectos autorizados · JSON").setDesc("Registro local de rutas y huellas verificadas.").addTextArea(t=>{t.setValue(draft.mcpProjectsJson).onChange(v=>{change("mcpProjectsJson",v);});t.inputEl.addClass("ss-code-input");});
    const footer=root.createDiv({cls:"ss-settings-footer"}),status=formStatus(footer);let busy=false;
    action(footer,"Guardar ajustes",()=>{void (async()=>{
      if(busy)return;busy=true;const prior=this.plugin.settings;
      try{
        if(this.plugin.isCollecting())throw Error("Espera a que termine la búsqueda antes de guardar ajustes.");
        const merged={...prior};for(const key of dirty)merged[key]=draft[key];
        const registry=JSON.parse(merged.mcpProjectsJson);if(!Array.isArray(registry)||registry.length>100||registry.some(p=>!p||typeof p.id!=="string"||typeof p.configPath!=="string"||!/^[a-f0-9]{64}$/.test(p.manifestHash)))throw Error("Revisa el JSON de proyectos autorizados.");
        this.plugin.settings=merged;
        if(prior.xProviderEnabled==="true"&&merged.xProviderEnabled!=="true")await this.plugin.forgetLocalSession();else await this.plugin.savePrefs();
        dirty.clear();status.setText("Ajustes guardados.");status.addClass("ss-status-success");
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
      setup:()=>new XFeedSetupModal(this.app,this).open(),filters:()=>new FeedFiltersModal(this.app,this).open(),
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
