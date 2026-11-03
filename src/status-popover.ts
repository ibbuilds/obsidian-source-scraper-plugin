import {ButtonComponent,DropdownComponent} from "obsidian";
import {panelPosition,discoveryState,type PanelSnapshot} from "./panel-model.ts";

export interface PopoverHost {
  snapshot:()=>PanelSnapshot;icon:(root:HTMLElement,name:string)=>void;
  settings:()=>void;setup:()=>void;filters:()=>void;collect:(projectId?:string)=>void;cancel:()=>void;
  importFindings:()=>void;
  disconnect?:()=>void;
  selectProject:(id:string)=>void;renderReview:(root:HTMLElement)=>void;unmountReview?:()=>void;renderTools:(root:HTMLElement)=>void;
}
let sequence=0;
/** Anchored, non-modal control surface. No workspace leaf and no collection on open. */
export class ScraperPopover {
  private root?:HTMLDivElement;
  private body?:HTMLDivElement;
  private resultsCount?:HTMLSpanElement;
  private resultNotice?:HTMLParagraphElement;
  private screen:"home"|"review"|"options"="home";
  private disposers:Array<()=>void>=[];
  private frame?:number;
  private homeUpdate?:(snapshot:PanelSnapshot)=>void;
  private signature="";
  private snapshotKey="";
  private focusPending=false;
  private returnScreen:"home"|"review"="home";
  private readonly doc:Document;
  private readonly win:Window;
  constructor(private anchor:HTMLElement,private host:PopoverHost){this.doc=anchor.ownerDocument;this.win=this.doc.defaultView!;}
  get isOpen():boolean{return Boolean(this.root);}
  open():void{
    if(this.root)return;this.focusPending=true;
    const root=this.doc.createElement("div");this.root=root;
    root.className="ss-popover";root.id="ss-popover-"+(++sequence);root.tabIndex=-1;
    root.setAttribute("role","dialog");root.setAttribute("aria-modal","false");root.setAttribute("aria-label","Source Scraper");
    root.style.visibility="hidden";this.doc.body.appendChild(root);
    if(typeof root.showPopover==="function"){
      root.setAttribute("popover","manual");try{root.showPopover();}catch{root.removeAttribute("popover");}
    }
    this.anchor.setAttribute("aria-expanded","true");this.anchor.setAttribute("aria-controls",root.id);
    const listen=(target:EventTarget,type:string,fn:EventListener,capture=false)=>{
      target.addEventListener(type,fn,capture);this.disposers.push(()=>target.removeEventListener(type,fn,capture));
    };
    listen(this.doc,"pointerdown",event=>{const path=event.composedPath();if(!path.includes(root)&&!path.includes(this.anchor))this.close(false);},true);
    listen(this.doc,"keydown",event=>{
      const key=event as KeyboardEvent;
      if(key.key==="Escape"&&!key.isComposing&&!this.doc.querySelector(".modal-container")){key.preventDefault();key.stopPropagation();this.close(true);}
    },true);
    listen(this.win,"resize",()=>this.position());listen(this.doc,"scroll",()=>this.position(),true);
    const Resize=(this.win as unknown as {ResizeObserver?:typeof ResizeObserver}).ResizeObserver;
    if(Resize){const observer=new Resize(()=>this.position());observer.observe(root);observer.observe(this.anchor);this.disposers.push(()=>observer.disconnect());}
    this.render();
  }
  close(restoreFocus=false):void{
    this.host.unmountReview?.();
    this.root?.remove();this.root=undefined;this.body=undefined;this.resultsCount=undefined;this.resultNotice=undefined;this.homeUpdate=undefined;this.focusPending=false;this.screen="home";
    this.disposers.splice(0).forEach(dispose=>dispose());
    if(this.frame!==undefined)this.win.cancelAnimationFrame(this.frame);this.frame=undefined;
    this.returnScreen="home";this.anchor.setAttribute("aria-expanded","false");this.anchor.removeAttribute("aria-controls");
    if(restoreFocus&&this.anchor.isConnected)this.anchor.focus({preventScroll:true});
  }
  showReview():void{this.screen="review";if(!this.root)this.open();else this.render();}
  update(dataChanged=false):void{
    if(!this.root)return;
    const s=this.host.snapshot(),key=JSON.stringify(s);
    if(!dataChanged&&key===this.snapshotKey)return;
    this.snapshotKey=key;
    this.updateResultNotice(s);
    if(JSON.stringify(s.projects)!==this.signature||(dataChanged&&this.screen==="review"))this.render();else this.homeUpdate?.(s);
    this.position();
  }
  private el<K extends keyof HTMLElementTagNameMap>(parent:HTMLElement,tag:K,cls:string,text?:string):HTMLElementTagNameMap[K]{
    const node=this.doc.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;parent.appendChild(node);return node;
  }
  private button(parent:HTMLElement,label:string,action:()=>void,cls="ss-button"):HTMLButtonElement{
    const button=new ButtonComponent(parent).setButtonText(label).onClick(action).buttonEl;
    button.classList.add(...cls.split(" "));button.type="button";return button;
  }
  private iconButton(parent:HTMLElement,name:string,label:string,action:()=>void):void{
    const component=new ButtonComponent(parent).setIcon(name).setTooltip(label).onClick(action);
    component.buttonEl.classList.add("ss-icon-button","clickable-icon");component.buttonEl.type="button";component.buttonEl.setAttribute("aria-label",label);
  }
  private setScreen(screen:"home"|"review"|"options"):void{
    if(screen==="options"&&this.screen!=="options")this.returnScreen=this.screen;
    this.screen=screen;this.render();this.root?.querySelector<HTMLElement>(".ss-brand")?.focus({preventScroll:true});
  }
  private render():void{
    const root=this.root;if(!root)return;root.replaceChildren();this.homeUpdate=undefined;this.resultNotice=undefined;this.host.unmountReview?.();
    const snapshot=this.host.snapshot();this.signature=JSON.stringify(snapshot.projects);this.snapshotKey=JSON.stringify(snapshot);
    root.dataset.screen=this.screen;
    const header=this.el(root,"header","ss-popover-header");
    if(this.screen!=="home")this.iconButton(header,"arrow-left",this.screen==="options"?"Volver":"Volver a buscar",()=>this.setScreen(this.screen==="options"?this.returnScreen:"home"));
    const title=this.el(header,"strong","ss-brand",this.screen==="options"?"Opciones":this.screen==="review"?"Recursos":"Source Scraper");title.tabIndex=-1;
    if(this.screen!=="options")this.iconButton(header,"settings-2","Opciones",()=>this.setScreen("options"));
    this.iconButton(header,"x","Cerrar Source Scraper",()=>this.close(true));
    this.resultsCount=undefined;
    this.body=this.el(root,"div","ss-popover-body");this.body.id=root.id+"-content";
    if(this.screen==="review"){
      if(snapshot.findings){this.host.renderReview(this.body);this.resultNotice=this.el(this.body,"p","ss-result-notice");this.updateResultNotice(snapshot);}
      else{
        this.el(this.body,"p","ss-empty-title","Aún no hay resultados");const hint=this.el(this.body,"p","ss-hint");
        this.button(this.body,"Ir a Buscar",()=>this.setScreen("home"),"ss-button ss-primary");
        this.homeUpdate=s=>{hint.textContent=s.running?"La búsqueda está en curso.":s.message==="Búsqueda terminada."?"No se encontraron recursos con estos filtros. Ajusta la búsqueda e inténtalo de nuevo.":"Los recursos que busques o importes aparecerán aquí.";};
        this.homeUpdate(snapshot);
      }
    }else if(this.screen==="options")this.renderOptions(this.body,snapshot);else this.renderHome(this.body,snapshot);
    this.position();
  }
  private updateResultNotice(s:PanelSnapshot):void{
    if(!this.resultNotice)return;
    const text=s.running?"Buscando recursos… Los resultados anteriores siguen disponibles.":s.error?"La búsqueda no terminó. Vuelve a Buscar para reintentar.":"";
    this.resultNotice.textContent=text;this.resultNotice.hidden=!text;
  }
  private renderHome(body:HTMLElement,snapshot:PanelSnapshot):void{
    body.classList.add("ss-discovery");
    const source=this.el(body,"div","ss-source-line");this.el(source,"strong","","X · Para ti");const status=this.el(source,"span","ss-source-status");
    this.el(body,"h2","ss-discovery-title","Encuentra enlaces");
    const hint=this.el(body,"p","ss-hint");hint.setAttribute("role","status");
    const filters=this.button(body,"Filtros de búsqueda",()=>{this.close(false);this.host.filters();},"ss-filter-link");
    const primary=this.button(body,"Conectar X",()=>{
      const state=discoveryState(this.host.snapshot());
      if(state.action==="cancel")this.host.cancel();
      else if(state.action==="collect")this.host.collect(state.projectId);
      else{this.close(false);if(state.action==="settings")this.host.settings();else this.host.setup();}
    },"ss-button ss-primary");
    const complete=this.button(body,"",()=>this.setScreen("review"),"ss-results-link");
    this.el(complete,"span","","Recursos");this.resultsCount=this.el(complete,"span","ss-result-count");
    this.host.icon(this.el(complete,"span","ss-chevron"),"chevron-right");
    this.homeUpdate=s=>{
      const state=discoveryState(s);body.dataset.state=state.state;status.textContent=state.status;hint.textContent=state.hint;primary.textContent=state.button;
      this.resultsCount!.textContent=s.findings+(s.exampleFindings?" de ejemplo":s.findings===1?" disponible":" disponibles");
      complete.setAttribute("aria-label",s.findings?"Ver resultados":"Ver resultados vacíos");
      filters.disabled=s.running||!s.projects.some(p=>p.isX);
      rootBusy(body,s.running);
    };
    body.appendChild(primary);this.homeUpdate(snapshot);
  }
  private renderOptions(options:HTMLElement,snapshot:PanelSnapshot):void{
    options.classList.add("ss-options");
    this.button(options,"Importar resultados",()=>{this.close(false);this.host.importFindings();},"ss-button ss-secondary");
    this.el(options,"h3","ss-section-label","Cuenta de X");
    this.button(options,"Cambiar sesión",()=>{this.close(false);this.host.setup();},"ss-button ss-text-action");
    const disconnect=this.button(options,"Desconectar X",()=>this.host.disconnect?.(),"ss-button ss-text-action");
    const alternative=this.el(options,"label","ss-project-label","Otras fuentes");
    const dropdown=new DropdownComponent(alternative);for(const p of snapshot.projects)dropdown.addOption(p.id,p.name);
    const select=dropdown.selectEl;select.classList.add("ss-project-select");select.setAttribute("aria-label","Otras fuentes");
    dropdown.onChange(value=>this.host.selectProject(value));
    const runOther=this.button(options,"Buscar en esta fuente",()=>this.host.collect(select.value),"ss-button ss-secondary");
    const advanced=this.el(options,"details","ss-review-tools");this.el(advanced,"summary","","Herramientas avanzadas");
    this.host.renderTools(this.el(advanced,"div","ss-controls"));
    this.button(options,"Configuración del plugin",()=>{this.close(false);this.host.settings();},"ss-button ss-text-action");
    const diagnostics=this.el(advanced,"p","ss-diagnostics");
    this.homeUpdate=s=>{
      select.value=s.projectId;select.disabled=s.running;
      alternative.hidden=!s.projects.length;runOther.hidden=!s.projects.length;
      const selected=s.projects.find(p=>p.id===select.value);
      runOther.disabled=s.running||!s.engine||!s.mcp||!selected||Boolean(selected.isX&&(!s.session||!s.xAllowed||!s.python));
      disconnect.hidden=!s.session||!s.xAllowed;disconnect.disabled=s.running;
      diagnostics.textContent=s.error||"Motor: "+(s.engine?"disponible":"sin configurar")+" · MCP: "+(s.mcp?"disponible":"sin conectar")+" · Lector X: "+(s.python?"disponible":"sin preparar");
      rootBusy(options,s.running);
    };
    this.homeUpdate(snapshot);
  }
  private position():void{
    if(!this.root||this.frame!==undefined)return;
    this.frame=this.win.requestAnimationFrame(()=>{
      this.frame=undefined;const root=this.root;if(!root)return;
      const rect=root.getBoundingClientRect(),p=panelPosition(this.anchor.getBoundingClientRect(),rect.width,rect.height,this.win.innerWidth,this.win.innerHeight);
      root.style.left=p.left+"px";root.style.top=p.top+"px";root.style.visibility="";
      if(this.focusPending){this.focusPending=false;root.focus({preventScroll:true});}
    });
  }
}
function rootBusy(body:HTMLElement,busy:boolean):void{body.setAttribute("aria-busy",String(busy));}
