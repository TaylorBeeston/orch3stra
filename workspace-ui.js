/* Navigation shell: presents the existing tools without changing project/render data.
 * Dialog bodies are detached, not serialized, so local listeners and unfinished form
 * values survive Back. No backend operations are started by navigation itself.
 */
window.H3WorkspaceUI={create(ctx){
 'use strict';
 const {$,esc,project,setDialogName}=ctx;
 const dialog=$('#dialog'),body=$('#dialog-body'),title=$('#dialog-title'),stack=[];
 let current=null,area='overview',refreshTimer;
 const labels={overview:'Overview',story:'Story',references:'References',timeline:'Timeline',post:'Post'};
 try{const saved=localStorage.getItem('h3-director:workspace:v2');if(labels[saved])area=saved;}catch{}
 const home=document.createElement('section');home.id='workspace-home';home.setAttribute('aria-label','Project workspace');$('.main').prepend(home);
 const nav=document.createElement('nav');nav.className='workspace-navigation';nav.setAttribute('aria-label','Workspace');
 nav.innerHTML=Object.entries(labels).map(([id,name])=>`<button data-workspace-area="${id}">${name}</button>`).join('')+'<span class="workspace-nav-spacer"></span><button data-workspace-tool="activity">Activity</button><button data-workspace-tool="tools">All tools / settings</button>';
 $('.topbar').after(nav);
 const detailsButton=document.createElement('button');detailsButton.dataset.workspaceTool='window-details';detailsButton.textContent='Window settings';detailsButton.title='Timing, reference sources and continuity for the selected window';$('.timeline-toolbar .toolbar-right').prepend(detailsButton);
 const compact=document.createElement('div');compact.className='workspace-header-actions';
 compact.innerHTML='<button data-action="projects">Projects</button><button data-workspace-tool="settings">Settings</button>';
 $('.topbar').append(compact);
 // Undo controls are still the original nodes with their existing handlers.
 compact.prepend($('#redo'));compact.prepend($('#undo'));
 const back=document.createElement('button');back.id='workspace-back';back.className='workspace-back';back.type='button';
 $('.dialog-head').prepend(back);$('.dialog-head .film-home-button')?.setAttribute('hidden','');
 const crumb=document.createElement('small');crumb.className='workspace-crumb';title.before(crumb);
 const exit=$('[data-action="close-dialog"]');exit.title='Close workspace';
 exit.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();closeAll();},true);
 back.addEventListener('click',e=>{e.preventDefault();goBack();});
 dialog.addEventListener('cancel',e=>{e.preventDefault();goBack();});
 document.body.classList.add('usability-shell');
 const action=(attrs,text,lead,description)=>`<article class="workspace-card"><span class="workspace-kicker">${esc(lead)}</span><h3>${esc(text)}</h3><p>${esc(description)}</p><button ${attrs}>${esc(text)} →</button></article>`;
 function refresh(){
  clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{if(!home.hidden)drawHome();},80);
 }
 function drawHome(){
  const p=project(),count=p.windows?.length||0,assets=p.assets?.length||0;
  let saved=0;try{saved=p.windows.filter(w=>{const x=window.H3Edit?.segment(p,w.id);return x&&!x.issue;}).length;}catch{}
  let cards='',heading='',copy='';
  if(area==='overview'){
   heading=p.name||'Your film';copy='One place to plan the story, prepare references, and finish the edit.';
   cards=action('data-workspace-area="story"','Develop the story','01 · Plan','Write the brief, create the cast, and draft your scenes.')+
    action('data-workspace-area="references"','Prepare references','02 · Prepare','Characters, images, voices, and help filling missing coverage.')+
    action('data-workspace-area="timeline"','Review and render','03 · Make','Watch saved takes or render only the windows you choose.')+
    action('data-workspace-area="post"','Finish the film','04 · Finish','Trim awkward moments, add music and logos, then export.');
  }else if(area==='story'){
   heading='Make the story yours';copy='Start with the brief below. Use these tools when you need a particular kind of help.';
   cards=action('data-film="outline"','Story + cast','Start here','Propose characters and a rough timeline together.')+
    action('data-film="open"','Refine with the assistant','Keep developing','Ask for changes, review proposals, and keep creative control.')+
    action('data-action="scaffold"','Pacing and timeline','Plan the length','Choose timing yourself or ask the planner for a runtime.');
  }else if(area==='references'){
   heading='A library, not an upload list';copy='Prepare what each shot needs without loading every reference into every window.';
   cards=action('data-ref="home"','Characters and files','Your library','Create characters, approve identities, and manage reference variants.')+
    action('data-coverage="open"','Fill missing coverage','Recommended','Inspect existing images, create genuine gaps, and review results here.')+
    action('data-film="images"','Image studio','Generate images','Make a new outfit, setting, angle, or identity portrait.')+
    action('data-film="voices"','Voices','Sound like your cast','Create or bind a consistent voice for each character.')+
    action('data-scene-tab="board"','Scene reference board','Fine control','See the exact inputs, pins, and coverage for each scene.')+
    action('data-clinic="open"','Project clinic','Troubleshoot','Fix reference problems without deleting source media.');
  }else if(area==='post'){
   heading='Finish, without regenerating';copy='Your generated originals remain intact. Post edits are a separate finishing cut.';
   cards=action('data-speech-quality="open"','Subtitles & speech quality','Check actual audio','Recognize retained words locally, export observed captions, and opt into capped alternatives for confirmed failures.')+action('data-speech-review="open"','Review rendered speech','Listen first','Compare the selected take with its script, flag suspect windows and choose alternate takes.')+action('data-post="open"','Open Post room','Edit the finish','Trim, mute, add music or logos, and fade to black.')+action('data-sound="open"','Sound library','Build your soundtrack','Import YouTube or local audio, detect samples, audition and add to Post.')+
    action('data-action="export"','Export and backups','Keep a copy','Export project data or open the finishing tools for the final MP4.');
  }
  home.innerHTML=`<header class="workspace-welcome"><p class="workspace-kicker">${esc(labels[area])}</p><h1>${esc(heading)}</h1><p>${esc(copy)}</p></header><div class="workspace-summary"><span>${count} ${count===1?'window':'windows'}</span><span>${saved} with saved footage</span><span>${p.subjects?.length||0} ${(p.subjects?.length||0)===1?'subject':'subjects'}</span><span>${assets} reference ${assets===1?'file':'files'}</span></div><div class="workspace-card-grid">${cards}</div>`;
 }
 function selectArea(next){
  if(!labels[next])return;area=next;document.body.dataset.workspace=area;
  try{localStorage.setItem('h3-director:workspace:v2',area);}catch{}
  nav.querySelectorAll('[data-workspace-area]').forEach(n=>{n.classList.toggle('active',n.dataset.workspaceArea===area);n.setAttribute('aria-current',n.dataset.workspaceArea===area?'page':'false');});
  home.hidden=area==='timeline';drawHome();
  if(area==='timeline')requestAnimationFrame(()=>{window.dispatchEvent(new Event('resize'));});
 }
 function formScrolls(){return [...body.querySelectorAll('*')].filter(n=>n.scrollTop||n.scrollLeft).map(n=>({node:n,top:n.scrollTop,left:n.scrollLeft}));}
 function capture(){
  const fragment=document.createDocumentFragment(),focus=body.contains(document.activeElement)?document.activeElement:null,scroll=body.scrollTop,scrolls=formScrolls();
  for(const media of body.querySelectorAll('video,audio'))media.pause?.();
  while(body.firstChild)fragment.append(body.firstChild);
  return {...current,fragment,focus,scroll,scrolls,projectId:project().id,windowId:ctx.selected?.()};
 }
 function chrome(){
  back.textContent=stack.length?'← Back':'← '+labels[area];back.title=stack.at(-1)?.title||'Return to '+labels[area];
  crumb.textContent=[labels[area],...stack.slice(-2).map(x=>x.title)].join(' / ');
  dialog.classList.toggle('workspace-dialog',!current?.name?.startsWith('subject:')&&!current?.name?.startsWith('asset:'));
  window.H3Activity?.syncLayer(true);
 }
 function open(nameTitle,html,name=''){
  const route=name||nameTitle;
  if(current&&current.projectId!==project().id){stack.length=0;current=null;}
  if(dialog.open&&current&&current.route!==route){if(stack.length>=12)stack.shift();stack.push(capture());}
  current={title:nameTitle,name,route,projectId:project().id};setDialogName(name);dialog.dataset.panel=name;title.textContent=nameTitle;body.innerHTML=html;body.scrollTop=0;
  if(!dialog.open)dialog.showModal();chrome();
 }
 function goBack(){
  for(const media of body.querySelectorAll('video,audio'))media.pause?.();
  while(stack.length){const previous=stack.pop();if(previous.projectId!==project().id)continue;
   if(previous.windowId){if(!project().windows.some(w=>w.id===previous.windowId))continue;if(ctx.selected?.()!==previous.windowId)ctx.select?.(previous.windowId);}
   current=previous;setDialogName(previous.name);dialog.dataset.panel=previous.name;title.textContent=previous.title;body.replaceChildren(previous.fragment);body.scrollTop=previous.scroll;
   for(const p of previous.scrolls||[]){p.node.scrollTop=p.top;p.node.scrollLeft=p.left;}
   chrome();try{previous.focus?.focus({preventScroll:true});}catch{}document.dispatchEvent(new CustomEvent('h3-panel-restored',{detail:{name:previous.name}}));return;
  }
  closeAll();
 }
 function closeAll(){stack.length=0;current=null;for(const media of body.querySelectorAll('video,audio'))media.pause?.();dialog.close();setDialogName('');window.H3Activity?.syncLayer(true);refresh();}
 function tools(which='tools'){
  const buttons=[...document.querySelectorAll('.header-actions button')].filter(n=>n.id!=='undo'&&n.id!=='redo');
  const list=buttons.map(n=>{const q=n.cloneNode(true);q.removeAttribute('id');if(typeof n.onclick==='function'&&n.id)q.dataset.workspaceOriginal=n.id;q.classList.remove('primary');q.removeAttribute('hidden');q.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));return{html:q.outerHTML,label:n.textContent.trim()};});
  list.push({html:'<button data-workspace-tool="window-details">Selected window settings</button>',label:'Selected window settings timing sources continuity'});
  if(which==='activity'){
   const matched=list.filter(x=>/render|sequence|AI requests|WanGP|progress/i.test(x.label));
   open('Activity','<p class="workspace-help">Check rendering, AI requests, and queue state. Opening a monitor does not submit work.</p><div class="workspace-tool-grid">'+matched.map(x=>x.html).join('')+'</div>','workspace-activity');return;
  }
  open('All tools and settings','<label class="workspace-search">Find a tool<input id="workspace-tool-search" type="search" placeholder="Try voices, queue, coverage, or export…" autocomplete="off"></label><div class="workspace-tool-grid">'+list.map(x=>`<div data-workspace-tool-row="${esc(x.label.toLowerCase())}">${x.html}</div>`).join('')+'</div>','workspace-tools');$('#workspace-tool-search').focus();
 }
 document.addEventListener('input',e=>{if(e.target.id==='workspace-tool-search'){const q=e.target.value.toLowerCase().trim();body.querySelectorAll('[data-workspace-tool-row]').forEach(n=>n.hidden=!n.dataset.workspaceToolRow.includes(q));}});
 document.addEventListener('click',e=>{const n=e.target.closest('[data-workspace-area],[data-workspace-tool],[data-workspace-original]');if(!n)return;e.preventDefault();e.stopImmediatePropagation();
  if(n.dataset.workspaceOriginal){document.getElementById(n.dataset.workspaceOriginal)?.click();return;}
  if(n.dataset.workspaceArea){if(dialog.open)closeAll();selectArea(n.dataset.workspaceArea);return;}
  if(n.dataset.workspaceTool==='settings'){ctx.settings();return;}if(n.dataset.workspaceTool==='window-details'){ctx.windowSettings();return;}tools(n.dataset.workspaceTool);
 },true);
 document.addEventListener('click',e=>{if(dialog.open&&e.target.closest('[data-post="open"]'))closeAll();},true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&e.target.id==='workspace-tool-search'){e.preventDefault();goBack();return;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();tools();}});
 selectArea(area);
 return {open,back:goBack,close:goBack,closeAll,refresh,selectArea,get area(){return area;},get depth(){return stack.length;}};
}};
