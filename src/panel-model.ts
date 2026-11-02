export interface PanelProject {id:string;name:string;isX:boolean;minimumScore:number}
export interface PanelSnapshot {
  engine:boolean;mcp:boolean;python:boolean;session:boolean;xAllowed:boolean;
  projects:PanelProject[];projectId:string;findings:number;findingProject:string;
  running:boolean;error?:string;message?:string;
}
export function panelState(s:PanelSnapshot){
  if(s.running)return {state:"running",label:"Collecting",icon:"loader-circle",title:"Collecting sources",description:"You can close this panel. Collection will continue; no vault notes are written."};
  if(s.error)return {state:"error",label:"Needs attention",icon:"circle-alert",title:"Collection needs attention",description:s.error};
  if(s.findings)return {state:"review",label:s.findings+" candidates",icon:"inbox",title:s.findings+" candidates to review",description:"Inspect original evidence, compare quality and choose candidates for ChatGPT."};
  if(!s.engine||!s.mcp)return {state:"setup",label:"Setup",icon:"sliders-horizontal",title:"Get discovery ready",description:"Connect the local engine and ChatGPT tools, or import findings to review. Nothing runs automatically."};
  if(!s.projects.some(p=>p.isX)||!s.python||!s.session||!s.xAllowed)return {state:"setup",label:"Set up X",icon:"sliders-horizontal",title:"Connect your X feed",description:"The local tools are available. Add your X session to test the free For You collector."};
  return {state:"ready",label:"Ready to test",icon:"circle-check",title:"Ready for a test collection",description:"Collect a small sample, inspect its source evidence and let ChatGPT assess the candidates. Live feed quality still needs verification."};
}
export function panelPosition(anchor:{right:number;top:number;bottom:number},width:number,height:number,viewportWidth:number,viewportHeight:number){
  const edge=12,gap=8,w=Math.max(0,Math.min(width,viewportWidth-2*edge)),h=Math.max(0,Math.min(height,viewportHeight-2*edge));
  const left=Math.max(edge,Math.min(anchor.right-w,viewportWidth-w-edge));
  const above=anchor.top-gap-h,below=anchor.bottom+gap;
  return {left,top:Math.max(edge,Math.min(above>=edge||below+h>viewportHeight-edge?above:below,viewportHeight-h-edge))};
}
