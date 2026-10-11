/* Local image cropping. Originals and recorded takes are never overwritten. */
window.H3ImageCropUI={create(ctx){
 'use strict';const {$,esc,Store,project,openDialog,toast,mutate,hydrate}=ctx;let state=null,serial=0;
 const digest=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('');
 async function open(id){
  const ticket=++serial,p=project(),a=p.assets.find(a=>a.id===id&&a.kind==='image');if(!a)throw Error('Choose an image reference.');
  const blob=await Store.getBlob(id);if(!blob)throw Error('Reattach the missing original image first.');
  const hash=await digest(blob),bitmap=await createImageBitmap(blob);if(ticket!==serial||project()!==p||!p.assets.includes(a)){bitmap.close();throw Error('Project changed while opening the photo.');}
  const current=await Store.getBlob(id);if(ticket!==serial||project()!==p||!p.assets.includes(a)||!current||await digest(current)!==hash||ticket!==serial||project()!==p||!p.assets.includes(a)){bitmap.close();throw Error('The original photo changed while loading. Reopen it.');}
  state={p,a,blob,hash,bitmap,ticket,x:0,y:0,w:bitmap.width,h:bitmap.height,busy:false};
  openDialog('Crop photo · '+a.name,`<p class="info-note">Drag a rectangle over the person or detail to keep, or enter pixel coordinates. Everything outside it is removed from the new image. The original stays unchanged. ${a.generationExcluded?'This source is excluded from generation; the cropped copy will also stay excluded until you explicitly reactivate it in Subjects & images.':''}</p><canvas id="crop-source" aria-label="Original photo: drag to crop" style="display:block;max-width:100%;max-height:45vh;touch-action:none;cursor:crosshair"></canvas><div class="row wrap">${[['x','Left'],['y','Top'],['w','Width'],['h','Height']].map(([k,label])=>`<label>${label}<input id="crop-${k}" type="number" min="${k==='w'||k==='h'?1:0}" step="1" value="${state[k]}"></label>`).join('')}</div><button id="crop-reset">Reset selection</button><h3>Cropped preview</h3><canvas id="crop-preview" aria-label="Cropped photo preview" style="display:block;max-width:100%;max-height:30vh"></canvas><p id="crop-error" role="status"></p><label>Name<input id="crop-name" value="${esc(a.name.replace(/\.[^.]+$/,'')+' · crop.png')}"></label><label class="checkrow"><input id="crop-replace" type="checkbox" ${a.generationExcluded?'disabled':'checked'}>Use this crop wherever this image is currently referenced</label><p class="info-note">Live subject sources, window selections and picture tags use the new crop when checked. Saved takes and historical requests keep their original inputs.</p><div class="dialog-actions"><button id="crop-cancel">Cancel</button><button id="crop-save" class="primary">Save cropped copy</button></div>`,'image-crop');
  const canvas=$('#crop-source');canvas.dataset.cropTicket=ticket;canvas.width=bitmap.width;canvas.height=bitmap.height;
  const point=e=>{const r=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(bitmap.width,Math.round((e.clientX-r.left)*bitmap.width/r.width))),y:Math.max(0,Math.min(bitmap.height,Math.round((e.clientY-r.top)*bitmap.height/r.height)))};};let start=null;
  canvas.onpointerdown=e=>{if(state.busy)return;start=point(e);canvas.setPointerCapture(e.pointerId);};
  canvas.onpointermove=e=>{if(!start||state.busy)return;const end=point(e);Object.assign(state,{x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),w:Math.max(1,Math.abs(end.x-start.x)),h:Math.max(1,Math.abs(end.y-start.y))});sync();draw();};
  canvas.onpointerup=canvas.onpointercancel=()=>{start=null;};
  for(const k of ['x','y','w','h'])$('#crop-'+k).oninput=()=>{state[k]=Number($('#crop-'+k).value);draw();};
  $('#crop-reset').onclick=()=>{Object.assign(state,{x:0,y:0,w:bitmap.width,h:bitmap.height});sync();draw();};
  $('#crop-cancel').onclick=()=>ctx.close();$('#crop-save').onclick=()=>save().catch(e=>toast(e.message,true));draw();
 }
 function rect(){const s=state;for(const k of ['x','y','w','h'])if(!Number.isInteger(s[k]))throw Error('Use whole pixel coordinates.');if(s.x<0||s.y<0||s.w<1||s.h<1||s.x+s.w>s.bitmap.width||s.y+s.h>s.bitmap.height)throw Error('Keep the crop inside the original photo.');return s;}
 function sync(){for(const k of ['x','y','w','h'])$('#crop-'+k).value=state[k];}
 function draw(){const s=state,c=$('#crop-source'),out=$('#crop-preview');if(!c||!out)return;const g=c.getContext('2d');g.clearRect(0,0,c.width,c.height);g.drawImage(s.bitmap,0,0);try{rect();$('#crop-error').textContent='';$('#crop-save').disabled=s.busy;g.fillStyle='#0009';g.fillRect(0,0,c.width,s.y);g.fillRect(0,s.y+s.h,c.width,c.height-s.y-s.h);g.fillRect(0,s.y,s.x,s.h);g.fillRect(s.x+s.w,s.y,c.width-s.x-s.w,s.h);g.strokeStyle='#83e2ae';g.lineWidth=Math.max(2,c.width/250);g.strokeRect(s.x,s.y,s.w,s.h);out.width=s.w;out.height=s.h;out.getContext('2d').drawImage(s.bitmap,s.x,s.y,s.w,s.h,0,0,s.w,s.h);}catch(e){out.width=1;out.height=1;$('#crop-error').textContent=e.message;$('#crop-save').disabled=true;}}
 async function save(){
  const s=rect();if(s.busy)return;if(($('#crop-source')?.dataset.cropTicket!==String(s.ticket)||!$('#crop-source')?.closest('dialog')?.open))throw Error('Reopen the photo before saving this crop.');if(project()!==s.p||!s.p.assets.includes(s.a))throw Error('Project changed. Reopen the photo.');
  const name=$('#crop-name').value.trim();if(!name)throw Error('Give the cropped image a name.');const replace=$('#crop-replace').checked,geometry={x:s.x,y:s.y,w:s.w,h:s.h},stamp=H3Clinic.liveStamp(s.p);s.busy=true;draw();
  try{const canvas=$('#crop-preview'),blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('Could not create the cropped image.');
   const id=H3.uid(),info=await Store.thumbnail(blob);await Store.putBlob(id,blob);const original=await Store.getBlob(s.a.id);if(state!==s||project()!==s.p||!s.p.assets.includes(s.a)||H3Clinic.liveStamp(s.p)!==stamp||!original||await digest(original)!==s.hash||($('#crop-source')?.dataset.cropTicket!==String(s.ticket)||!$('#crop-source')?.closest('dialog')?.open)||H3Clinic.liveStamp(s.p)!==stamp)throw Error('Project or original photo changed. Crop was not attached.');
   const next=H3.clone(s.p),number=Math.max(next.counters.image||0,0,...next.assets.filter(a=>a.kind==='image').map(a=>a.number))+1;
   next.counters.image=number;next.assets.push({...H3.clone(s.a),id,number,name,type:'image/png',size:blob.size,width:geometry.w,height:geometry.h,missing:false,crop:{sourceAssetId:s.a.id,x:geometry.x,y:geometry.y,width:geometry.w,height:geometry.h},provenance:{kind:'local-crop',sourceAssetId:s.a.id}});
   if(replace)H3Clinic.replaceAsset(next,s.a.id,id);
   const [header,data]=info.url.split(','),thumb=new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:header.match(/^data:([^;]+)/)[1]});await Store.putBlob('thumb:'+id,thumb);mutate(()=>Object.assign(s.p,next));await hydrate();if(state===s&&$('#crop-source')?.dataset.cropTicket===String(s.ticket))ctx.close();toast('Cropped copy saved. Original photo preserved.');
  }finally{s.busy=false;if(state===s)draw();}
 }
 document.addEventListener('click',e=>{const button=e.target.closest('[data-crop-image]');if(!button)return;open(button.dataset.cropImage).catch(e=>toast(e.message,true));});
 return{open};
}};
