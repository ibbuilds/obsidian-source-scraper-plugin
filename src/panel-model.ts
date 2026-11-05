export interface PanelProject {id:string;name:string;isX:boolean;minimumScore:number}
export interface PanelSnapshot {
  engine:boolean;mcp:boolean;python:boolean;session:boolean;xAllowed:boolean;
  projects:PanelProject[];projectId:string;findings:number;findingProject:string;
  cycle?:{state:string;pages:number;observations:number;reason:string};
  running:boolean;error?:string;message?:string;exampleFindings?:boolean;
}
/** The normal user journey is the personalized X feed; other adapters stay in advanced options. */
export function discoveryState(s:PanelSnapshot){
  const project=s.projects.find(p=>p.isX&&p.id===s.projectId)||s.projects.find(p=>p.isX);
  if(s.running)return {state:"running",status:s.cycle?.state==="waiting"?"Waiting for new posts":"Collecting…",hint:s.cycle?`${s.cycle.pages} pages · ${s.cycle.observations} posts. ${s.cycle.reason}.`:"You can close this panel. Collection continues.",action:"cancel",button:s.cycle?"Stop cycle":"Stop",projectId:project?.id};
  if(!s.engine||!s.mcp)return {state:"setup",status:"Setup required",hint:"Set up the local connection to start collecting.",action:"settings",button:"Set up Source Scraper",projectId:project?.id};
  if(!s.python)return {state:"setup",status:"X setup required",hint:"Configure the local X reader to continue.",action:"settings",button:"Set up connection",projectId:project?.id};
  if(!project||!s.session||!s.xAllowed)return {state:"setup",status:"Not connected",hint:"Find tools and resources in your feed.",action:"connect",button:"Connect X",projectId:project?.id};
  if(s.error)return {state:"error",status:"Collection failed",hint:"Check your X session and try again.",action:"collect",button:"Retry",projectId:project.id};
  return {state:"ready",status:"Session loaded",hint:s.message==="Collection complete."?(s.findings?"Collection complete. Review the resources.":"No resources found. Try different filters."):"Collect resources and review them here. AI assistance is optional.",action:"collect",button:"Find resources",projectId:project.id};
}
export function panelState(s:PanelSnapshot){
  if(s.running)return {state:"running",label:"Collecting",icon:"loader-circle",title:"Collecting sources",description:"You can close this panel. Collection will continue; no vault notes are written."};
  if(s.error)return {state:"error",label:"Needs attention",icon:"circle-alert",title:"Collection needs attention",description:s.error};
  if(s.findings)return {state:"review",label:s.findings+" candidates",icon:"inbox",title:s.findings+" candidates to review",description:"Inspect the evidence, review resources yourself, or use an AI through MCP."};
  if(!s.engine||!s.mcp)return {state:"setup",label:"Setup",icon:"sliders-horizontal",title:"Get discovery ready",description:"Connect the local engine, or import findings to review. MCP access is optional."};
  if(s.projects.some(p=>p.id===s.projectId&&!p.isX))return {state:"ready",label:"Ready",icon:"circle-check",title:"Ready to collect sources",description:"Collect from the selected project, then inspect and manage its resources here."};
  if(!s.projects.some(p=>p.isX)||!s.python||!s.session||!s.xAllowed)return {state:"setup",label:"Set up X",icon:"sliders-horizontal",title:"Connect your X feed",description:"The local tools are available. Add your X session to test the free For You collector."};
  return {state:"ready",label:"Ready to test",icon:"circle-check",title:"Ready for a test collection",description:"Collect a sample and review its source evidence here, with optional AI assistance. Live feed quality still needs verification."};
}
export function panelPosition(anchor:{right:number;top:number;bottom:number},width:number,height:number,viewportWidth:number,viewportHeight:number){
  const edge=12,gap=8,w=Math.max(0,Math.min(width,viewportWidth-2*edge)),h=Math.max(0,Math.min(height,viewportHeight-2*edge));
  const left=Math.max(edge,Math.min(anchor.right-w,viewportWidth-w-edge));
  const above=anchor.top-gap-h,below=anchor.bottom+gap;
  return {left,top:Math.max(edge,Math.min(above>=edge||below+h>viewportHeight-edge?above:below,viewportHeight-h-edge))};
}
