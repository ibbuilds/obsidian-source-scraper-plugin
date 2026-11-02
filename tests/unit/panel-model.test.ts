import {test} from "node:test";
import assert from "node:assert/strict";
import {panelPosition,panelState,discoveryState,type PanelSnapshot} from "../../src/panel-model.ts";

const connected:PanelSnapshot={engine:true,mcp:true,python:true,session:true,xAllowed:true,
  projects:[{id:"x",name:"X feed",isX:true,minimumScore:50}],projectId:"x",findings:0,findingProject:"",running:false};
test("the normal journey requires X even with public demo findings and healthy local tools",()=>{
  const sample={...connected,session:false,xAllowed:false,findings:4,exampleFindings:true,projects:[{id:"starter-project",name:"Offline starter",isX:false,minimumScore:0}],projectId:"starter-project"};
  assert.equal(discoveryState(sample).button,"Conectar X");assert.equal(discoveryState(sample).status,"Sin conectar");
  assert.equal(discoveryState(connected).button,"Buscar recursos");
  assert.equal(discoveryState({...connected,running:true}).action,"cancel");
  assert.equal(discoveryState({...connected,error:"401"}).button,"Reintentar búsqueda");
  assert.equal(discoveryState({...connected,mcp:false}).action,"settings");
});
test("the indicator never calls an untested X feed verified or connected without its local session",()=>{
  assert.equal(panelState(connected).label,"Ready to test");
  assert.match(panelState(connected).description,/still needs verification/);
  for(const key of ["engine","mcp","python","session","xAllowed"] as const){
    assert.equal(panelState({...connected,[key]:false}).state,"setup");
  }
  assert.equal(panelState({...connected,projects:[]}).state,"setup");
});
test("existing findings remain reviewable offline, while active collection and errors remain visible",()=>{
  const offline={...connected,session:false,mcp:false,findings:7};
  assert.equal(panelState(offline).label,"7 candidates");
  assert.equal(panelState({...offline,error:"Authentication failed"}).state,"error");
  assert.equal(panelState({...offline,running:true,error:"Old error"}).state,"running");
});
test("a selected public project can collect without an X session",()=>{
  const state=panelState({...connected,session:false,xAllowed:false,python:false,projectId:"public",projects:[{id:"public",name:"Public resources",isX:false,minimumScore:0}]});
  assert.equal(state.title,"Ready to collect sources");assert.equal(state.state,"ready");
});
test("the floating panel stays above its status anchor and within narrow or short viewports",()=>{
  assert.deepEqual(panelPosition({right:990,top:780,bottom:800},420,500,1000,800),{left:568,top:272});
  assert.deepEqual(panelPosition({right:300,top:8,bottom:28},280,200,320,640),{left:20,top:36});
  const result=panelPosition({right:150,top:180,bottom:200},420,680,280,240);
  assert.deepEqual(result,{left:12,top:12});
});
