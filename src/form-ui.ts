import {Modal,ButtonComponent} from "obsidian";
let fieldId=0;
/** Native dialog chrome with one scroll area and persistent actions. */
export function dialog(modal:Modal,title:string,wide=false){
  modal.setTitle(title);modal.modalEl.addClass("ss-dialog");modal.modalEl.toggleClass("ss-dialog-wide",wide);
  modal.contentEl.empty();modal.contentEl.addClass("source-scraper-modal");
  const body=modal.contentEl.createDiv({cls:"ss-dialog-body"});
  const footer=modal.contentEl.createDiv({cls:"ss-dialog-footer"});
  return {body,footer};
}
export function action(root:HTMLElement,label:string,run:()=>void,primary=false){
  const button=new ButtonComponent(root).setButtonText(label).onClick(run);
  if(primary)button.buttonEl.addClass("ss-primary");
  button.buttonEl.type="button";return button;
}
export function formStatus(root:HTMLElement){
  const status=root.createDiv({cls:"ss-form-status",attr:{role:"status","aria-live":"polite","aria-atomic":"true"}});
  return status;
}
/** Associate native Setting labels/descriptions with every input, including JSON. */
export function labelFields(root:HTMLElement){
  for(const row of Array.from(root.querySelectorAll<HTMLElement>(".setting-item"))){
    const name=row.querySelector<HTMLElement>(".setting-item-name"),desc=row.querySelector<HTMLElement>(".setting-item-description");
    if(name&&!name.id)name.id="ss-field-"+(++fieldId);
    if(desc&&!desc.id)desc.id="ss-help-"+(++fieldId);
    for(const input of Array.from(row.querySelectorAll<HTMLInputElement>("input,textarea,select"))){
      if(name)input.setAttribute("aria-labelledby",name.id);
      if(desc?.textContent)input.setAttribute("aria-describedby",desc.id);
    }
  }
}
