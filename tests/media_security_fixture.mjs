/** Synthetic managed ownership, actual bridge/CPU export. No renderer/provider calls. */
import {createServer} from '../bridge.mjs';import {mkdir,copyFile} from 'node:fs/promises';import {join} from 'node:path';import {once} from 'node:events';import {Readable} from 'node:stream';
const [data,source]=process.argv.slice(2),server=createServer({dataDir:data,port:0}),output='d'.repeat(32);await server.ready;
await mkdir(join(data,'renders'),{recursive:true});await copyFile(source,join(data,'renders',output+'.mp4'));
server.sequences.runs.set('seq_fixture',{outputs:[{id:output}]});server.sequences.api=async()=>{throw Error('No provider or renderer call permitted');};
const edit={format:'h3-edit',fps:24,projectId:'synthetic-media',name:'Synthetic MP4',cuts:[{windowId:'w1',title:'Fixture',source:{kind:'managed',jobId:'seq_fixture',outputId:output},inFrame:0,outFrame:48}]};
const j=await server.finishing.start({edit});await server.finishing.work.get(j.id)?.promise;const done=await server.finishing.handle({action:'get',id:j.id});if(done.status!=='completed')throw Error(done.error||done.message);
for(const [key,type] of [['html','text/html'],['svg','image/svg+xml']]){const bytes=Buffer.from('<script>parent.sentinel="executed"</script>');await server.studio.putBlob(key,Readable.from(bytes),bytes.length,type);}
server.listen(0,'127.0.0.1');await once(server,'listening');console.log(JSON.stringify({base:'http://127.0.0.1:'+server.address().port,media:done.downloadURL}));
let stopping=false;process.on('SIGTERM',()=>{if(stopping)return;stopping=true;server.close(async()=>{await server.shutdown;process.exit(0);});});
