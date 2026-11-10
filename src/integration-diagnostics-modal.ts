import {App,Modal} from 'obsidian';
import {dialog,action} from './form-ui.ts';
import type {diagnoseIntegration} from './integration-health.ts';
type Report=Awaited<ReturnType<typeof diagnoseIntegration>>;
export class IntegrationDiagnosticsModal extends Modal {
  private load:()=>Promise<Report>;
  private active=true;
  constructor(app:App,load:()=>Promise<Report>){super(app);this.load=load;}
  onOpen(){
    const {body,footer}=dialog(this,'Integration diagnostics');
    const status=body.createEl('p',{text:'Checking local setup. No sources or notes are changed.'});
    action(footer,'Close',()=>this.close());
    void this.load().then(report=>{
      if(!this.active)return;
      status.setText(report.localReady?'Local integration is ready. Verify discovery from ChatGPT.':'Local integration needs attention.');
      body.createEl('p',{text:`Plugin ${report.pluginVersion}; engine ${report.engineVersion||'not verified'}; registered projects ${report.projectCount}.`});
      for(const check of report.checks){const row=body.createEl('p');row.createEl('strong',{text:check.status.toUpperCase()+' · '+check.id+' — '});row.createSpan({text:check.message});}
      body.createEl('p',{text:'X live access is not probed by this diagnostic. A successful bounded collection is required.'});
    }).catch(()=>{if(this.active)status.setText('Diagnostics could not complete. Check the local configuration.');});
  }
  onClose(){this.active=false;this.contentEl.empty();}
}
