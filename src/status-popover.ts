import {panelPosition,discoveryState,type PanelSnapshot} from "./panel-model.ts";

export interface PopoverHost {
  snapshot:()=>PanelSnapshot;icon:(root:HTMLElement,name:string)=>void;
  settings:()=>void;setup:()=>void;collect:(projectId?:string)=>void;cancel:()=>void;
  importFindings:()=>void;
  disconnect?:()=>void;
  selectProject:(id:string)=>void;renderReview:(root:HTMLElement)=>void;unmountReview?:()=>void;
}
let sequence=0;
/** Anchored, non-modal control surface. No workspace leaf and no collection on open. */
export class ScraperPopover {
  private root?:HTMLDivElement;
  private body?:HTMLDivElement;
  private resultsCount?:HTMLSpanElement;
  private resultNotice?:HTMLParagraphElement;
  private screen:"home"|"review"="home";
  private disposers:Array<()=>void>=[];
  private frame?:number;
  private homeUpdate?:(snapshot:PanelSnapshot)=>void;
  private signature="";
  private snapshotKey="";
  private focusPending=false;
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
    this.anchor.setAttribute("aria-expanded","false");this.anchor.removeAttribute("aria-controls");
    if(restoreFocus&&this.anchor.isConnected)this.anchor.focus({preventScroll:true});
  }
  showReview():void{this.screen="review";if(!this.root)this.open();else this.render();}
  update(dataChanged=false):void{
    if(!this.root)return;
    const s=this.host.snapshot(),key=JSON.stringify(s);
    if(!dataChanged&&key===this.snapshotKey)return;
    this.snapshotKey=key;
    if(this.resultsCount){if(this.resultsCount.textContent!==String(s.findings))this.resultsCount.textContent=String(s.findings);this.resultsCount.hidden=!s.findings;}
    this.updateResultNotice(s);
    if(JSON.stringify(s.projects)!==this.signature||(dataChanged&&this.screen==="review"))this.render();else this.homeUpdate?.(s);
    this.position();
  }
  private el<K extends keyof HTMLElementTagNameMap>(parent:HTMLElement,tag:K,cls:string,text?:string):HTMLElementTagNameMap[K]{
    const node=this.doc.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;parent.appendChild(node);return node;
  }
  private button(parent:HTMLElement,label:string,action:()=>void,cls="ss-button"):HTMLButtonElement{
    const button=this.el(parent,"button",cls,label);button.type="button";button.addEventListener("click",action);return button;
  }
  private iconButton(parent:HTMLElement,name:string,label:string,action:()=>void):void{
    const button=this.button(parent,"",action,"ss-icon-button");button.setAttribute("aria-label",label);button.title=label;this.host.icon(button,name);
  }
  private setScreen(screen:"home"|"review"):void{
    this.screen=screen;this.render();this.root?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }
  private render():void{
    const root=this.root;if(!root)return;root.replaceChildren();this.homeUpdate=undefined;this.resultNotice=undefined;this.host.unmountReview?.();
    const snapshot=this.host.snapshot();this.signature=JSON.stringify(snapshot.projects);this.snapshotKey=JSON.stringify(snapshot);
    const header=this.el(root,"header","ss-popover-header");this.el(header,"strong","ss-brand","Source Scraper");
    this.iconButton(header,"settings-2","Configuración",()=>{this.close(false);this.host.settings();});
    this.iconButton(header,"x","Cerrar Source Scraper",()=>this.close(true));
    const tabs=this.el(root,"div","ss-tabs");tabs.setAttribute("role","tablist");tabs.setAttribute("aria-label","Source Scraper");
    for(const [screen,label] of [["home","Buscar"],["review","Resultados"]] as const){
      const tab=this.button(tabs,label,()=>this.setScreen(screen),"ss-tab");tab.dataset.screen=screen;tab.id=root.id+"-"+screen;
      tab.setAttribute("role","tab");tab.setAttribute("aria-selected",String(this.screen===screen));tab.setAttribute("aria-controls",root.id+"-content");tab.tabIndex=this.screen===screen?0:-1;
      if(screen==="review"){this.resultsCount=this.el(tab,"span","ss-result-count",String(snapshot.findings));this.resultsCount.hidden=!snapshot.findings;}
      tab.addEventListener("keydown",event=>{if(["ArrowLeft","ArrowRight","Home","End"].includes(event.key)){event.preventDefault();this.setScreen(event.key==="Home"?"home":event.key==="End"?"review":this.screen==="home"?"review":"home");}});
    }
    this.body=this.el(root,"div","ss-popover-body");this.body.id=root.id+"-content";this.body.setAttribute("role","tabpanel");this.body.setAttribute("aria-labelledby",root.id+"-"+this.screen);
    if(this.screen==="review"){
      if(snapshot.findings){this.host.renderReview(this.body);this.resultNotice=this.el(this.body,"p","ss-result-notice");this.updateResultNotice(snapshot);}
      else{
        this.el(this.body,"p","ss-empty-title","Aún no hay resultados");const hint=this.el(this.body,"p","ss-hint");
        this.button(this.body,"Ir a Buscar",()=>this.setScreen("home"),"ss-button ss-primary");
        this.homeUpdate=s=>{hint.textContent=s.running?"La búsqueda está en curso.":s.message==="Búsqueda terminada."?"No se encontraron recursos con estos filtros. Ajusta la búsqueda e inténtalo de nuevo.":"Los recursos que busques o importes aparecerán aquí.";};
        this.homeUpdate(snapshot);
      }
    }else this.renderHome(this.body,snapshot);
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
    const hint=this.el(body,"p","ss-hint");
    const primary=this.button(body,"Conectar X",()=>{
      const state=discoveryState(this.host.snapshot());
      if(state.action==="cancel")this.host.cancel();
      else if(state.action==="collect")this.host.collect(state.projectId);
      else{this.close(false);if(state.action==="settings")this.host.settings();else this.host.setup();}
    },"ss-button ss-primary");
    const complete=this.button(body,"Ver resultados",()=>this.setScreen("review"),"ss-button ss-text-action");
    const more=this.el(body,"details","ss-more");this.el(more,"summary","","Más opciones");
    const options=this.el(more,"div","ss-more-content");
    this.button(options,"Importar JSON",()=>{this.close(false);this.host.importFindings();},"ss-button ss-secondary");
    this.button(options,"Conectar otra sesión de X",()=>{this.close(false);this.host.setup();},"ss-button ss-text-action");
    const disconnect=this.button(options,"Desconectar X",()=>this.host.disconnect?.(),"ss-button ss-text-action");
    const alternative=this.el(options,"label","ss-project-label","Otras fuentes");
    const select=this.el(alternative,"select","ss-project-select");select.setAttribute("aria-label","Otras fuentes");
    for(const p of snapshot.projects){const option=this.doc.createElement("option");option.value=p.id;option.textContent=p.name;select.appendChild(option);}
    select.addEventListener("change",()=>this.host.selectProject(select.value));
    const runOther=this.button(options,"Buscar en esta fuente",()=>this.host.collect(select.value),"ss-button ss-secondary");
    const diagnostics=this.el(options,"p","ss-diagnostics");
    const help=this.el(options,"p","ss-help","1. Conecta X. 2. Busca recursos. 3. En Resultados, selecciona lo útil y pídele a ChatGPT que lo evalúe o prepare notas. Este plugin no escribe en tu bóveda.");
    help.setAttribute("role","note");
    this.homeUpdate=s=>{
      const state=discoveryState(s);body.dataset.state=state.state;status.textContent=state.status;hint.textContent=state.hint;primary.textContent=state.button;
      complete.hidden=s.running||!s.findings||s.message!=="Búsqueda terminada.";
      select.value=s.projectId;select.disabled=s.running;
      alternative.hidden=!s.projects.length;runOther.hidden=!s.projects.length;
      const selected=s.projects.find(p=>p.id===select.value);
      runOther.disabled=s.running||!s.engine||!s.mcp||!selected||Boolean(selected.isX&&(!s.session||!s.xAllowed||!s.python));
      disconnect.hidden=!s.session||!s.xAllowed;disconnect.disabled=s.running;
      diagnostics.textContent=s.error||"Motor: "+(s.engine?"disponible":"sin configurar")+" · MCP: "+(s.mcp?"disponible":"sin conectar")+" · Lector X: "+(s.python?"disponible":"sin preparar");
      rootBusy(body,s.running);
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
