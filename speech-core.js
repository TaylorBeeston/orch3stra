/* Pure voice-workshop edit decisions. No network or model access. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.H3Speech=api;})(globalThis,()=>{
  'use strict';
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  function youtubeURL(raw){
    const u=new URL(String(raw).trim());
    if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port)throw Error('Use a normal public YouTube video URL.');
    const host=u.hostname.toLowerCase();let id;
    if(host==='youtu.be')id=u.pathname.slice(1);
    else if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(host)){
      if(u.pathname==='/watch')id=u.searchParams.get('v');
      else id=/^\/(?:shorts|embed|live)\/([^/]+)\/?$/.exec(u.pathname)?.[1];
    }
    if(!/^[a-zA-Z0-9_-]{11}$/.test(id||''))throw Error('Paste a single YouTube video link, not a channel, playlist, or arbitrary URL.');
    return 'https://www.youtube.com/watch?v='+id;
  }
  function intervals(rows,duration){
    if(!finite(duration)||duration<=0)throw Error('The source duration is unavailable.');
    const cuts=rows.filter(s=>s.keep!==false).map(s=>{
      const a=Number(s.start),b=Number(s.end);
      if(!finite(a)||!finite(b)||a<0||b<=a||b>duration+.02)throw Error('Each kept cut must have valid start/end times within the source.');
      return [a,Math.min(b,duration)];
    }).sort((a,b)=>a[0]-b[0]);
    const merged=[];for(const c of cuts){const prev=merged.at(-1);if(prev&&c[0]<=prev[1]+.001)prev[1]=Math.max(prev[1],c[1]);else merged.push(c.slice());}
    return merged;
  }
  function keptDuration(rows,duration,gap=.05){const cuts=intervals(rows,duration);return cuts.reduce((n,c)=>n+c[1]-c[0],0)+Math.max(0,cuts.length-1)*gap;}
  function fit(rows,duration,limit=7.5,gap=.05){
    let remaining=limit,first=true;return rows.slice().sort((a,b)=>a.start-b.start).map(s=>{const r={...s};if(r.keep===false)return r;if(!first)remaining-=gap;first=false;const length=Math.max(0,Math.min(r.end-r.start,remaining));r.keep=length>.03;r.end=r.keep?r.start+length:r.end;remaining-=length;return r;});
  }
  function split(rows,id,at,makeId){const i=rows.findIndex(r=>r.id===id);if(i<0)throw Error('Select a transcript row first.');const s=rows[i];if(at<=s.start+.02||at>=s.end-.02)throw Error('Put the playhead inside the selected row.');const left=(s.words||[]).filter(w=>(w.start+w.end)/2<at),right=(s.words||[]).filter(w=>(w.start+w.end)/2>=at);return [...rows.slice(0,i),{...s,end:at,words:left,text:left.length?left.map(w=>w.word).join(''):s.text},{...s,id:makeId(),start:at,words:right,text:right.length?right.map(w=>w.word).join(''):'[Edit transcript for this half]'},...rows.slice(i+1)];}
  function pcmWav(samples,rate){
    if(!Number.isInteger(rate)||rate<8000||rate>192000)throw Error('Unsupported WAV sample rate.');
    const out=new ArrayBuffer(44+samples.length*2),v=new DataView(out);
    const str=(pos,s)=>{for(let i=0;i<s.length;i++)v.setUint8(pos+i,s.charCodeAt(i));};
    str(0,'RIFF');v.setUint32(4,36+samples.length*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,samples.length*2,true);
    for(let i=0;i<samples.length;i++){const s=Math.max(-1,Math.min(1,samples[i]||0));v.setInt16(44+i*2,Math.round(s*(s<0?32768:32767)),true);}return out;
  }
  function assemble(buffer,cuts,gap=.05,fade=.005){
    const rate=buffer.sampleRate,ranges=cuts.map(([a,b])=>[Math.round(a*rate),Math.min(buffer.length,Math.round(b*rate))]),pad=Math.round(gap*rate);
    const len=ranges.reduce((n,[a,b])=>n+b-a,0)+Math.max(0,ranges.length-1)*pad;
    if(len<1||len>rate*60)throw Error('Keep between a fraction of a second and 60 seconds for an audition; H3 reference export is limited separately.');
    const out=new Float32Array(len),channels=Array.from({length:buffer.numberOfChannels},(_,c)=>buffer.getChannelData(c));let pos=0;
    for(const [a,b] of ranges){const f=Math.min(Math.floor((b-a)/2),Math.round(fade*rate));for(let j=a;j<b;j++){let x=0;for(const c of channels)x+=c[j]/channels.length;const gain=f?Math.min(1,(j-a)/f,(b-1-j)/f):1;out[pos+j-a]=x*gain;}pos+=b-a+pad;}
    return {bytes:pcmWav(out,rate),duration:len/rate};
  }
  function regroup(rows,turns){
    if(!Array.isArray(turns)||turns.some(t=>!finite(t.start)||!finite(t.end)||t.start<0||t.end<=t.start||typeof t.speaker!=='string'))throw Error('Invalid diarization turns.');
    const label=row=>{const scores=new Map(),active=turns.filter(t=>Math.min(row.end,t.end)>Math.max(row.start,t.start));for(const t of active)scores.set(t.speaker,(scores.get(t.speaker)||0)+Math.min(row.end,t.end)-Math.max(row.start,t.start));const ranked=[...scores].sort((a,b)=>b[1]-a[1]);const tied=ranked.length>1&&Math.abs(ranked[0][1]-ranked[1][1])<.001;const overlapping=active.some((a,i)=>active.slice(i+1).some(b=>a.speaker!==b.speaker&&Math.min(a.end,b.end,row.end)-Math.max(a.start,b.start,row.start)>.03));return{...row,speaker:!ranked.length||tied?'UNASSIGNED':ranked[0][0],overlapping,...(row.words?{words:row.words.map(label)}:{})};};return rows.map(label);
  }
  return {regroup,youtubeURL,intervals,keptDuration,fit,split,pcmWav,assemble};
});
