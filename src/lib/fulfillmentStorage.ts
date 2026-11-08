import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const digest=(s:string)=>crypto.createHash('sha256').update(s).digest('hex');
export function atomicJson(file:string,value:unknown){
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 const tmp=file+'.'+crypto.randomUUID()+'.tmp',fd=fs.openSync(tmp,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(tmp,file);
 const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
function validate(data:any){if(!data||![1,2].includes(data.version)||!Array.isArray(data.orders)||!Array.isArray(data.drivers)||!Array.isArray(data.audit)||!data.telemetry||!data.dispatch)throw Error('Almacenamiento operativo inválido. No se reemplaza por datos de demostración.');return data;}
export class FulfillmentStorage {
 readonly file:string;readonly journal:string;
 constructor(readonly directory:string,private phase?:(stage:string)=>void){this.file=path.join(directory,'persisted-fulfillment.json');this.journal=path.join(directory,'.bolt-storage','transition-v2.json');}
 read(){if(!fs.existsSync(this.file))return null;return validate(JSON.parse(fs.readFileSync(this.file,'utf8')));}
 commit(snapshot:any){
  const current=this.read();
  let transition=current?.version===2?current.transition:undefined;
  if(!transition){
   if(fs.existsSync(this.journal)){
    transition=JSON.parse(fs.readFileSync(this.journal,'utf8')).transition;
    for(const source of transition.sources){const f=path.join(this.directory,source.name);if(!fs.existsSync(f)||digest(fs.readFileSync(f,'utf8'))!==source.sha256)throw Error('La fuente cambió durante la transición. Requiere revisión; no se sobrescribe.');}
   }else{
    const id=crypto.randomUUID();const names=current?['persisted-fulfillment.json']:['persisted-orders.json','persisted-drivers.json','persisted-audit.json','persisted-telemetry.json'];
    const sources=names.filter(n=>fs.existsSync(path.join(this.directory,n))).map(name=>{
     const content=fs.readFileSync(path.join(this.directory,name),'utf8');const backup=path.join(this.directory,'.bolt-storage','backups',id,name);
     atomicJson(backup,JSON.parse(content));return {name,sha256:digest(content),backup:path.relative(this.directory,backup)};
    });
    transition={id,processVersion:1,from:current?.version||'legacy-files',startedAt:new Date().toISOString(),sources};
    atomicJson(this.journal,{phase:'PREPARED',transition});
   }
   this.phase?.('prepared');
  }
  const next={...snapshot,version:2,revision:(current?.revision||0)+1,committedAt:new Date().toISOString(),transition};
  validate(next);atomicJson(this.file,next);this.phase?.('published');
  // This journal is recoverable bookkeeping, not another authoritative state.
  try{atomicJson(this.journal,{phase:'COMMITTED',transition,revision:next.revision});}catch{/* v2 file is already the committed authority. */}
  return next;
 }
}
export function checkStorageRelease(dataDir:string,candidate:string){
 const contractPath=path.join(candidate,'storage-contract.json');
 if(!fs.existsSync(contractPath))throw Error('Reversión incompatible: la revisión no declara un lector de fulfillment v2. No se inicia código antiguo.');
 const contract=JSON.parse(fs.readFileSync(contractPath,'utf8'));
 const file=path.join(dataDir,'persisted-fulfillment.json');const version=fs.existsSync(file)?validate(JSON.parse(fs.readFileSync(file,'utf8'))).version:0;
 if(contract.format!=='bolt-fulfillment'||!contract.readVersions?.includes(version)||contract.writeVersion!==2)throw Error('Revisión incompatible con el esquema operativo; usa una revisión de recuperación compatible.');
 return {compatible:true,sourceVersion:version,writerVersion:2};
}
