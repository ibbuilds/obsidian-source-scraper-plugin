import {test} from "node:test";
import assert from "node:assert/strict";
import {panelPosition,panelState,type PanelSnapshot} from "../../src/panel-model.ts";

const connected:PanelSnapshot={engine:true,mcp:true,python:true,session:true,xAllowed:true,
  projects:[{id:"x",name:"X feed",isX:true,minimumScore:50}],projectId:"x",findings:0,findingProject:"",running:false};
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
test("the floating panel stays above its status anchor and within narrow or short viewports",()=>{
  assert.deepEqual(panelPosition({right:990,top:780,bottom:800},420,500,1000,800),{left:568,top:272});
  assert.deepEqual(panelPosition({right:300,top:8,bottom:28},280,200,320,640),{left:20,top:36});
  const result=panelPosition({right:150,top:180,bottom:200},420,680,280,240);
  assert.deepEqual(result,{left:12,top:12});
});
