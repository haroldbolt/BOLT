import fs from 'node:fs';
import path from 'node:path';

// JSON persistence supports one writer process. Server and maintenance CLI share this lock.
export function acquireCatalogWriterLock(root=process.cwd()) {
  const dir=path.join(root,'.bolt-private');fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const file=path.join(dir,'catalog-writer.lock');
  if(fs.existsSync(file)) {
    const pid=Number(fs.readFileSync(file,'utf8'));
    let live=true;try{process.kill(pid,0);}catch(e:any){if(e.code==='ESRCH')live=false;}
    if(live)throw new Error('Otro servidor o proceso administrativo utiliza este almacenamiento. Ejecuta el lote mediante su endpoint autenticado o detén ese proceso.');
    fs.unlinkSync(file);
  }
  fs.writeFileSync(file,String(process.pid),{flag:'wx',mode:0o600});
  const release=()=>{if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')===String(process.pid))fs.unlinkSync(file);};
  process.once('exit',release);
  return release;
}
