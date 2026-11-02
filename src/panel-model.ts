export interface PanelProject {id:string;name:string;isX:boolean;minimumScore:number}
export interface PanelSnapshot {
  engine:boolean;mcp:boolean;python:boolean;session:boolean;xAllowed:boolean;
  projects:PanelProject[];projectId:string;findings:number;findingProject:string;
  running:boolean;error?:string;message?:string;exampleFindings?:boolean;
}
/** The normal user journey is the personalized X feed; other adapters stay in advanced options. */
export function discoveryState(s:PanelSnapshot){
  const project=s.projects.find(p=>p.isX&&p.id===s.projectId)||s.projects.find(p=>p.isX);
  if(s.running)return {state:"running",status:"Buscando…",hint:"Puedes cerrar el panel. La búsqueda continúa.",action:"cancel",button:"Detener",projectId:project?.id};
  if(!s.engine||!s.mcp)return {state:"setup",status:"Falta configurar",hint:"Completa la conexión local para empezar a buscar.",action:"settings",button:"Configurar Source Scraper",projectId:project?.id};
  if(!s.python)return {state:"setup",status:"Falta preparar X",hint:"Configura el lector local de X para continuar.",action:"settings",button:"Preparar conexión",projectId:project?.id};
  if(!project||!s.session||!s.xAllowed)return {state:"setup",status:"Sin conectar",hint:"Encuentra herramientas y recursos en tu feed.",action:"connect",button:"Conectar X",projectId:project?.id};
  if(s.error)return {state:"error",status:"No se pudo buscar",hint:"Revisa tu sesión de X y vuelve a intentarlo.",action:"collect",button:"Reintentar",projectId:project.id};
  return {state:"ready",status:"Sesión cargada",hint:s.message==="Búsqueda terminada."?(s.findings?"Búsqueda terminada. Revisa los recursos.":"No se encontraron recursos. Prueba otros filtros."):"Busca recursos y elige cuáles revisar con ChatGPT.",action:"collect",button:"Buscar recursos",projectId:project.id};
}
export function panelState(s:PanelSnapshot){
  if(s.running)return {state:"running",label:"Collecting",icon:"loader-circle",title:"Collecting sources",description:"You can close this panel. Collection will continue; no vault notes are written."};
  if(s.error)return {state:"error",label:"Needs attention",icon:"circle-alert",title:"Collection needs attention",description:s.error};
  if(s.findings)return {state:"review",label:s.findings+" candidates",icon:"inbox",title:s.findings+" candidates to review",description:"Inspect original evidence, compare quality and choose candidates for ChatGPT."};
  if(!s.engine||!s.mcp)return {state:"setup",label:"Setup",icon:"sliders-horizontal",title:"Get discovery ready",description:"Connect the local engine and ChatGPT tools, or import findings to review. Nothing runs automatically."};
  if(s.projects.some(p=>p.id===s.projectId&&!p.isX))return {state:"ready",label:"Ready",icon:"circle-check",title:"Ready to collect sources",description:"Collect from the selected project, then inspect evidence and choose useful resources for ChatGPT."};
  if(!s.projects.some(p=>p.isX)||!s.python||!s.session||!s.xAllowed)return {state:"setup",label:"Set up X",icon:"sliders-horizontal",title:"Connect your X feed",description:"The local tools are available. Add your X session to test the free For You collector."};
  return {state:"ready",label:"Ready to test",icon:"circle-check",title:"Ready for a test collection",description:"Collect a small sample, inspect its source evidence and let ChatGPT assess the candidates. Live feed quality still needs verification."};
}
export function panelPosition(anchor:{right:number;top:number;bottom:number},width:number,height:number,viewportWidth:number,viewportHeight:number){
  const edge=12,gap=8,w=Math.max(0,Math.min(width,viewportWidth-2*edge)),h=Math.max(0,Math.min(height,viewportHeight-2*edge));
  const left=Math.max(edge,Math.min(anchor.right-w,viewportWidth-w-edge));
  const above=anchor.top-gap-h,below=anchor.bottom+gap;
  return {left,top:Math.max(edge,Math.min(above>=edge||below+h>viewportHeight-edge?above:below,viewportHeight-h-edge))};
}
