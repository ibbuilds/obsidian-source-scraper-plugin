import {panelPosition,panelState,type PanelSnapshot} from "./panel-model.ts";

export interface PopoverHost {
  snapshot:()=>PanelSnapshot;icon:(root:HTMLElement,name:string)=>void;
  settings:()=>void;setup:()=>void;collect:()=>void;cancel:()=>void;
  importFindings:()=>void;
  disconnect?:()=>void;
  selectProject:(id:string)=>void;renderReview:(root:HTMLElement)=>void;unmountReview?:()=>void;
}
let sequence=0;
/** Anchored, non-modal control surface. No workspace leaf and no collection on open. */
export class ScraperPopover {
  private root?:HTMLDivElement;
  private body?:HTMLDivElement;
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
    this.root?.remove();this.root=undefined;this.body=undefined;this.homeUpdate=undefined;this.focusPending=false;this.screen="home";
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
  private render():void{
    const root=this.root;if(!root)return;root.replaceChildren();this.homeUpdate=undefined;
    this.host.unmountReview?.();
    const snapshot=this.host.snapshot();this.signature=JSON.stringify(snapshot.projects);this.snapshotKey=JSON.stringify(snapshot);
    const header=this.el(root,"header","ss-popover-header");
    if(this.screen==="review")this.iconButton(header,"arrow-left","Back to overview",()=>{this.screen="home";this.render();});
    else this.host.icon(this.el(header,"span","ss-brand-icon"),"scan-search");
    const brand=this.el(header,"div","ss-brand");this.el(brand,"strong","","Source Scraper");
    this.el(brand,"span","ss-subtitle",this.screen==="home"?"Resource discovery":"Candidate review");
    this.iconButton(header,"sliders-horizontal","Source Scraper settings",()=>{this.close(false);this.host.settings();});
    this.iconButton(header,"x","Close Source Scraper",()=>this.close(true));
    this.body=this.el(root,"div","ss-popover-body");
    if(this.screen==="review")this.host.renderReview(this.body);else this.renderHome(this.body,snapshot);
    const footer=this.el(root,"footer","ss-panel-footer");this.host.icon(this.el(footer,"span",""),"shield-check");
    this.el(footer,"span","","Only ChatGPT writes notes, when you ask.");
    if(root.style.visibility!=="hidden")root.focus({preventScroll:true});
    this.position();
  }
  private renderHome(body:HTMLElement,snapshot:PanelSnapshot):void{
    body.classList.add("ss-overview");
    const hero=this.el(body,"section","ss-hero");
    const heading=this.el(hero,"div","ss-status-heading"),icon=this.el(heading,"span","ss-state-icon");
    const title=this.el(heading,"h3","ss-title"),description=this.el(hero,"p","ss-description");
    const context=this.el(hero,"p","ss-queue-context");
    const project=this.el(body,"label","ss-project-label","Project");
    const select=this.el(project,"select","ss-project-select");select.setAttribute("aria-label","Research project");
    for(const p of snapshot.projects){const option=this.doc.createElement("option");option.value=p.id;option.textContent=p.name;select.appendChild(option);}
    select.addEventListener("change",()=>this.host.selectProject(select.value));
    const actions=this.el(body,"div","ss-popover-actions");
    const primary=this.button(actions,"Review candidates",()=>{
      const s=this.host.snapshot(),selected=s.projects.find(p=>p.id===s.projectId);
      if(s.findings)this.showReview();
      else if(s.running)this.host.cancel();
      else if(!s.engine||!s.mcp){this.close(false);this.host.settings();}
      else if(!selected||Boolean(selected.isX&&(!s.session||!s.xAllowed||!s.python))){this.close(false);this.host.setup();}
      else this.host.collect();
    },"ss-button ss-primary");
    const secondary=this.el(actions,"div","ss-secondary-actions");
    const collect=this.button(secondary,"Collect sources",()=>this.host.snapshot().running?this.host.cancel():this.host.collect());
    this.button(secondary,"Import findings",()=>{this.close(false);this.host.importFindings();});
    const feedback=this.el(body,"p","ss-feedback");feedback.setAttribute("role","status");feedback.setAttribute("aria-live","polite");
    const connection=this.el(body,"details","ss-connection"),summary=this.el(connection,"summary","ss-connection-summary");
    const connectionIcon=this.el(summary,"span","ss-connection-icon");this.host.icon(connectionIcon,"plug");
    this.el(summary,"span","ss-connection-label","Connection");
    const connectionState=this.el(summary,"span","ss-connection-state");
    const chevron=this.el(summary,"span","ss-chevron");this.host.icon(chevron,"chevron-down");
    const checks=this.el(connection,"div","ss-checks");
    const row=(label:string)=>{const node=this.el(checks,"div","ss-check-row"),mark=this.el(node,"span","ss-check");this.el(node,"span","ss-check-label",label);const value=this.el(node,"span","ss-check-value");return {node,mark,value};};
    const engine=row("Local engine"),mcp=row("ChatGPT tools"),session=row("X session"),python=row("X runtime");
    const connectionActions=this.el(connection,"div","ss-connection-actions");
    this.button(connectionActions,"Connect X locally",()=>{this.close(false);this.host.setup();},"ss-button ss-quiet");
    const disconnect=this.button(connectionActions,"Disconnect local X",()=>this.host.disconnect?.(),"ss-button ss-quiet");
    const setRow=(target:ReturnType<typeof row>,ok:boolean,text:string)=>{target.value.textContent=text;target.mark.dataset.ready=String(ok);this.host.icon(target.mark,ok?"check":"minus");};
    this.homeUpdate=s=>{
      const state=panelState(s),selected=s.projects.find(p=>p.id===s.projectId);
      const canCollect=Boolean(s.engine&&s.mcp&&selected&&(!selected.isX||(s.session&&s.xAllowed&&s.python)));
      body.dataset.state=state.state;
      title.textContent=state.title;description.textContent=state.description;this.host.icon(icon,state.icon);
      context.textContent=s.findings&&s.findingProject?"Review queue · "+s.findingProject.replace(/[-_]/g," "):"";context.hidden=!context.textContent;
      project.hidden=!s.projects.length;select.value=s.projectId;select.disabled=s.running;
      primary.textContent=s.findings?"Review candidates":s.running?"Stop collection":!s.engine||!s.mcp?"Open settings":canCollect?"Collect sources":"Connect X locally";
      collect.hidden=!s.findings;collect.textContent=s.running?"Stop collection":"Collect sources";collect.disabled=!s.running&&!canCollect;
      collect.title=collect.disabled?"Configure the local connection and select a project to collect.":"";
      secondary.classList.toggle("ss-single-action",collect.hidden);
      feedback.textContent=s.message||"";feedback.hidden=!feedback.textContent;
      const localReady=s.engine&&s.mcp, xReady=s.session&&s.xAllowed&&s.python;
      connectionState.textContent=!localReady?"Setup needed":selected?.isX&&!xReady?"X not connected":"Local tools ready";
      connectionState.dataset.ready=String(localReady&&(!selected?.isX||xReady));
      setRow(engine,s.engine,s.engine?"Detected":"Not configured");setRow(mcp,s.mcp,s.mcp?"15 available":"Not connected");
      setRow(session,s.session&&s.xAllowed,s.session&&s.xAllowed?"Loaded locally":"Not connected");setRow(python,s.python,s.python?"Detected":"Not configured");
      python.node.hidden=Boolean(selected&&!selected.isX);session.node.hidden=Boolean(selected&&!selected.isX);
      disconnect.hidden=!s.session||!s.xAllowed;disconnect.disabled=s.running;
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
