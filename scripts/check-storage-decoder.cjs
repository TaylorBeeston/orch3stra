const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const scope={window:{},Blob,Uint8Array,atob,decodeURIComponent};
vm.runInNewContext(fs.readFileSync('storage.js','utf8'),scope);
(async()=>{
  const bytes=Buffer.from([0,255,127,1,13,10]);
  const blob=scope.window.DirectorStore.blobFromDataURL('data:image/jpeg;base64,'+bytes.toString('base64'));
  assert.equal(blob.type,'image/jpeg');
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()),bytes);
  assert.throws(()=>scope.window.DirectorStore.blobFromDataURL('not-data'));
  assert.throws(()=>scope.window.DirectorStore.blobFromDataURL('data:image/jpeg;base64,%%%'));
  const app=fs.readFileSync('app.js','utf8');
  assert.equal((app.match(/Store\.blobFromDataURL\(info\.url,'image\/jpeg'\)/g)||[]).length,2);
  assert(!app.includes('fetch(info.url)'));
  console.log('PASS thumbnail data URLs preserve bytes without network fetch; invalid input fails closed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
