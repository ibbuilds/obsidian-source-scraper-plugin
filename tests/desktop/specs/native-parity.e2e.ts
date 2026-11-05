import {browser,expect} from '@wdio/globals';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const artifacts=resolve('artifacts');
const frame=()=>browser.execute(()=>{
 const root=document.querySelector<HTMLElement>('.ss-dialog,.ss-popover,.cmt-popover')!;
 const r=root.getBoundingClientRect(),bad:string[]=[];
 if(r.left<11||r.top<11||r.right>innerWidth-11||r.bottom>innerHeight-11)bad.push('outside viewport');
 if(root.scrollWidth>root.clientWidth+1)bad.push('horizontal overflow');
 if(!root.classList.contains('ss-dialog')&&(Math.abs(r.width-Math.min(400,innerWidth-24))>1||Math.abs(r.height-Math.min(500,innerHeight-24))>1))bad.push('incorrect panel size');
 const footer=root.querySelector<HTMLElement>('.ss-dialog-footer,.ss-home-footer,.cmt-footer');
 if(footer&&!footer.hidden){const f=footer.getBoundingClientRect();if(f.top<r.top||f.bottom>r.bottom+1)bad.push('footer outside frame');
  const buttons=Array.from(footer.querySelectorAll<HTMLButtonElement>('button')).filter(b=>b.getClientRects().length);
  for(let i=0;i<buttons.length;i++){const a=buttons[i].getBoundingClientRect();for(let j=i+1;j<buttons.length;j++){const b=buttons[j].getBoundingClientRect();if(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)bad.push('overlapping footer buttons');}}
 }
 for(const field of Array.from(root.querySelectorAll<HTMLInputElement>('input,textarea,select'))){
  if(!field.getClientRects().length)continue;
  if(!field.getAttribute('aria-label')&&!field.getAttribute('aria-labelledby')&&!field.labels?.length)bad.push('unlabelled field');
  const f=field.getBoundingClientRect();if(f.width>root.clientWidth)bad.push('oversized field');
 }
 const primary=root.querySelector<HTMLElement>('.ss-primary,.cmt-primary'),style=primary?getComputedStyle(primary):undefined;
 const header=root.querySelector<HTMLElement>('.ss-popover-header,.cmt-header');
 return {bad,width:r.width,height:r.height,headerHeight:header?.getBoundingClientRect().height,button:style?{font:style.fontSize,height:primary!.getBoundingClientRect().height,color:style.color,background:style.backgroundColor,radius:style.borderRadius}:null};
});
const settle=()=>browser.executeAsync(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done(null))));
const fixture={schemaVersion:1,dataset:'entities',projectId:'native-audit',records:Array.from({length:80},(_,i)=>({projectId:'native-audit',key:'item:'+i,type:'web-resource',title:i===0?'A long resource title that should wrap naturally without widening the panel':'Resource '+i,url:'https://example.org/resource/'+i,attributes:{description:'Supporting evidence for a reusable interface resource.'},category:'library',score:50,confidence:.8,reasons:['Matched the configured terms.'],review:'pending',updatedAt:'2026-11-03T00:00:00Z',observationCount:1}))};
describe('Shared native UI audit in actual Obsidian',()=>{
 it('checks every panel and form at three widths in both themes',async()=>{
  mkdirSync(artifacts,{recursive:true});
  await browser.executeObsidian(({plugins,require},payload)=>{
   (globalThis as any).__parityObsidian=require('obsidian');
   const Controller=(new Function(payload.code+"; return NativeChatGPT;"))().ConnectionPopover;
   const style=document.createElement('style');style.id='native-parity-style';style.textContent=payload.css;document.head.appendChild(style);
   const still=document.createElement("style");still.textContent=".ss-popover *,.cmt-popover * {transition:none!important;animation:none!important;}";document.head.appendChild(still);
   const parent=document.querySelector('.status-bar')!,anchor=document.createElement('div');anchor.className='cmt-status';anchor.textContent='ChatGPT';anchor.tabIndex=0;parent.appendChild(anchor);
   const host:any={settings:{tunnelId:'',mcpUrl:'http://127.0.0.1:8765/mcp',autoConnect:false,chatgptLinked:false,autoDetectLocal:true},snapshot:{state:'stopped',detail:'Local fixture',managed:false},installing:false,
    facts:{client:true,key:false,vault:'running',token:false},inspect:async()=>({...host.facts}),prepareLocal:async()=>{},useAutomaticLocal:async()=>{},findClient:async()=>false,installClient:async()=>{},chooseClient:async()=>false,saveAccount:async()=>{},saveLocal:async()=>{},setAutoConnect:async()=>{},acknowledgeChatgpt:async()=>{},connect:async()=>{},disconnect:()=>{},forgetKey:async()=>{},forgetToken:async()=>{}};
   (globalThis as any).__parity={host,pop:new Controller(anchor,host,()=>{})};
   (plugins as any).sourceScraper.setImported(payload.fixture);
   const plugin=(plugins as any).sourceScraper,fs=require("node:fs"),path=require("node:path");
   const workspace=fs.mkdtempSync(path.join(require("node:os").tmpdir(),"ss-native-parity-")),configPath=path.join(workspace,"project.json");
   const manifest={id:"native-x",name:"Native UI audit",sources:[{id:"x-for-you",adapter:"x-for-you-local",config:{accountId:"123456",pagesPerRun:1}}],pipeline:["x-discovery"],evaluator:"keyword",policy:{includeKeywords:[],excludeKeywords:[],minimumScore:0},outputs:[]};
   const raw=JSON.stringify(manifest);fs.writeFileSync(configPath,raw);plugin.settings.mcpWorkspacePath=workspace;plugin.settings.configPath=configPath;plugin.settings.mcpProjectsJson=JSON.stringify([{id:manifest.id,configPath,manifestHash:require("node:crypto").createHash("sha256").update(raw).digest("hex")}]);

  },{code:readFileSync(resolve(artifacts,'chatgpt-native.js'),'utf8'),css:readFileSync(resolve(artifacts,'chatgpt-native.css'),'utf8'),fixture});
  const failures:string[]=[],reports:any[]=[];
  const check=async(name:string,width:number,theme:string)=>{await browser.sendCommand("Input.dispatchMouseEvent",{type:"mouseMoved",x:1,y:1});await settle();const report=await frame();reports.push({name,width,theme,...report});console.log("SCREEN "+JSON.stringify({name,width,theme,bad:report.bad}));for(const message of report.bad)failures.push(`${name}/${width}/${theme}: ${message}`);if(width===390||width===1440&&theme==='dark')await browser.$('.ss-dialog,.ss-popover,.cmt-popover').saveScreenshot(resolve(artifacts,`parity-${name}-${width}-${theme}.png`));return report;};
  const sourceHome=async()=>{await browser.executeObsidian(async({plugins})=>{const p=(plugins as any).sourceScraper;p.closePopover();await p.openView();});await browser.$('.ss-popover').waitForDisplayed();};
  const sourceOptions=async()=>{await sourceHome();await browser.$('.ss-popover button[aria-label=Options]').click();};
  const click=async(text:string)=>{const b=browser.$(`//button[normalize-space()='${text}']`);await b.waitForClickable();await b.click();};
  for(const [width,height] of [[1440,900],[768,700],[390,480]])for(const theme of ['dark','light']){
   await browser.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
   await browser.execute(t=>{document.body.classList.toggle('theme-dark',t==='dark');document.body.classList.toggle('theme-light',t==='light');},theme);
   await sourceHome();const source=await check('source-home',width,theme);
   await click("Search filters");await check("source-filters",width,theme);await browser.keys("Escape");await sourceHome();
   await browser.$('.ss-results-link').click();await check('source-results',width,theme);
   await browser.$('.ss-record-title').click();await check('source-detail',width,theme);await browser.keys('Escape');
   for(const [button,name] of [['Change session','source-session'],['Import results','source-import']]){await sourceOptions();await click(button);await check(name,width,theme);if(name==='source-session'){await browser.$('.ss-session-help summary').click();await check(name+'-help',width,theme);}await browser.keys('Escape');}
   for(const [button,name] of [['Edit project','source-project'],['Draft format','source-format'],['Run project','source-run']]){await sourceOptions();await browser.$('.ss-review-tools summary').click();await click(button);await check(name,width,theme);await browser.keys('Escape');}
   await sourceHome();await browser.$('.ss-results-link').click();if(!await browser.$('.ss-select-control').isSelected())await browser.$('.ss-select-control').click();await click('Preview drafts');await check('source-drafts',width,theme);await browser.keys('Escape');
   for(const state of ['loading','client','installing','account','saved-account','chatgpt','home','error','recovery','settings','settings-expanded']){
    await browser.executeObsidian(async({plugins},mode)=>{
     (plugins as any).sourceScraper.closePopover();const {host,pop}=(globalThis as any).__parity;pop.close();
     host.facts={client:!['client','installing'].includes(mode),key:!['client','installing','account'].includes(mode),vault:mode==='recovery'?'stopped':'running',token:mode==='settings-expanded',toolCount:15};
     host.settings.tunnelId=host.facts.key?'tunnel_0123456789abcdef0123456789abcdef':'';host.settings.chatgptLinked=!['client','installing','account','chatgpt'].includes(mode);host.installing=mode==='installing';
     host.snapshot={state:mode==='error'?'error':mode==='recovery'?'waiting-for-obsidian':host.settings.chatgptLinked?'connected':'not-configured',detail:'An intentionally long connection report. '.repeat(30),managed:host.settings.chatgptLinked};
     const inspect=host.inspect;if(mode==='loading')host.inspect=()=>new Promise(()=>{});pop.open();await Promise.resolve();host.inspect=inspect;
     if(mode==='saved-account')pop.go('account');if(mode.startsWith('settings'))pop.go('settings');
     if(mode==='settings-expanded')document.querySelectorAll<HTMLDetailsElement>('.cmt-popover details').forEach(d=>{d.open=true;});
    },state);
    const chat=await check('chatgpt-'+state,width,theme);
    if(state==='home'){if(source.headerHeight!==chat.headerHeight)failures.push(`header mismatch/${width}/${theme}`);if(JSON.stringify(source.button)!==JSON.stringify(chat.button))failures.push(`native button mismatch/${width}/${theme}: ${JSON.stringify({source:source.button,chat:chat.button})}`);}
    await browser.execute(()=>{(globalThis as any).__parity.pop.close();});
   }
  }
  writeFileSync(resolve(artifacts,'native-parity-report.json'),JSON.stringify({screens:reports.length,failures,reports},null,2));
  console.log('NATIVE_PARITY '+JSON.stringify({screens:reports.length,failures}));
  expect(failures).toEqual([]);
 });
});
