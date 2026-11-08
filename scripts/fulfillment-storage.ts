import path from 'node:path';import fs from 'node:fs';import {spawn} from 'node:child_process';
import {checkStorageRelease,FulfillmentStorage,atomicJson} from '../src/lib/fulfillmentStorage';
import {acquireCatalogWriterLock} from '../src/lib/catalogWriterLock';
const [command,dataArg,candidateArg]=process.argv.slice(2);const directory=path.resolve(dataArg||'src/data');const candidate=path.resolve(candidateArg||'.');
if(!['check','migrate','backup','run'].includes(command)||!dataArg)throw Error('Uso: fulfillment-storage.ts check|migrate|backup|run DATA_DIR [CANDIDATE_DIR]');
const check=checkStorageRelease(directory,candidate);
if(command==='check')console.log(JSON.stringify(check));
else if(command==='run'){
 const entry=path.join(candidate,'server.js');if(!fs.existsSync(entry))throw Error('Compila primero la revisión compatible.');
 const child=spawn(process.execPath,[entry],{cwd:candidate,env:{...process.env,BOLT_DATA_DIR:directory},stdio:'inherit'});
 const stop=(signal:NodeJS.Signals)=>{if(child.exitCode===null)child.kill(signal);};
 process.on('SIGTERM',stop);process.on('SIGINT',stop);
 child.on('error',()=>{console.error('No se pudo iniciar la revisión compatible.');process.exitCode=1;});
 child.on('exit',(code,signal)=>{process.off('SIGTERM',stop);process.off('SIGINT',stop);process.exitCode=code??(signal?0:1);});
}else{
 const release=acquireCatalogWriterLock(directory);
 try{
  process.env.BOLT_DATA_DIR=directory;
  const {OrdersRepository}=await import('../src/lib/ordersRepository');
  const repo=new OrdersRepository({dataDir:directory});
  if(command==='migrate'){repo.flush();console.log(JSON.stringify({migrated:true,version:2,orders:repo.getAllOrders().length}));}
  else{
   // Back up the latest complete state; this is not a command to restore old business data.
   repo.flush();const snapshot=new FulfillmentStorage(directory).read();
   const dest=path.join(directory,'.bolt-storage','recovery',new Date().toISOString().replace(/[:.]/g,'-')+'.json');atomicJson(dest,snapshot);
   console.log(JSON.stringify({backup:dest,version:2,revision:snapshot.revision}));
  }
 }finally{release()}
}
