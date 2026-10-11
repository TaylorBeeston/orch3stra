/** CLI shutdown: await every manager/write barrier; forced timeout keeps the crash lock. */
export async function shutdownBridge(server,{timeoutMs=4000}={}){
 const force=message=>{console.error(message+' Writer ownership is not released as a graceful shutdown; preserve the crash lock and inspect before restarting.');process.kill(process.pid,'SIGKILL');};
 // Keep this timer referenced: an unresolved promise alone does not keep Node alive.
 const timer=setTimeout(()=>force('Director shutdown timed out.'),timeoutMs);
 try{
  await new Promise((resolve,reject)=>server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()));
  if(!server.shutdown||typeof server.shutdown.then!=='function')throw Error('Missing full manager shutdown barrier.');
  await server.shutdown;clearTimeout(timer);process.exit(0);
 }catch(error){clearTimeout(timer);force('Director shutdown could not be confirmed: '+error.message);}
}
