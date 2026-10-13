/* App-owned approvals: never native confirm/alert/prompt; one live intent at a time. */
(function(){
  if(window.H3Confirm)return;
  const dialog=document.createElement('dialog');dialog.id='app-confirm';dialog.className='app-confirm';dialog.setAttribute('aria-labelledby','app-confirm-title');dialog.setAttribute('aria-describedby','app-confirm-summary');
  dialog.innerHTML='<h2 id="app-confirm-title"></h2><pre id="app-confirm-summary" style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit"></pre><p id="app-confirm-note" role="status"></p><div class="row wrap"><button data-app-confirm="cancel">Cancel</button><button data-app-confirm="accept" class="primary">Confirm</button></div>';
  document.body.append(dialog);let pending=null;
  function finish(accepted){const p=pending;if(!p)return;pending=null;clearInterval(p.timer);let valid=false;try{valid=p.valid();}catch{}if(dialog.open)dialog.close();p.resolve(Boolean(accepted&&valid));if(p.focus?.isConnected)p.focus.focus();}
  dialog.querySelector('[data-app-confirm=cancel]').onclick=()=>finish(false);
  dialog.querySelector('[data-app-confirm=accept]').onclick=()=>finish(true);
  dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false);});dialog.addEventListener('close',()=>{if(!dialog.open)finish(false);});
  window.addEventListener('pagehide',()=>finish(false));
  window.H3Confirm={ask({title='Review action',summary,accept='Confirm',valid=()=>true,note='Escape or Cancel keeps the queue unchanged.'}){if(pending)return Promise.resolve(false);return new Promise(resolve=>{let safe=false;try{safe=valid();}catch{}if(!safe){resolve(false);return;}const focus=document.activeElement;dialog.querySelector('#app-confirm-title').textContent=title;dialog.querySelector('#app-confirm-summary').textContent=String(summary);dialog.querySelector('#app-confirm-note').textContent=note;dialog.querySelector('[data-app-confirm=accept]').textContent=accept;pending={resolve,valid,focus,timer:setInterval(()=>{let safe=false;try{safe=valid();}catch{}if(!safe)finish(false);},100)};try{dialog.showModal();dialog.querySelector('[data-app-confirm=cancel]').focus();}catch{finish(false);}});},cancel:()=>finish(false),get pending(){return Boolean(pending);}};
})();
