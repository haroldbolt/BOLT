import fs from 'node:fs';
import path from 'node:path';
import {acquireCatalogWriterLock} from '../src/lib/catalogWriterLock';
import {catalogRepository} from '../src/lib/catalogRepository';
import {imageMetadataPatch, type CatalogImagePatch} from '../src/lib/catalogImagePatch';

// Filesystem-authorized maintenance; live servers must use the authenticated endpoint.
const [action,planPath]=process.argv.slice(2);
if(!['check','apply'].includes(action)||!planPath)throw new Error('Uso: catalog-images.ts check|apply plan.json');
const release=acquireCatalogWriterLock();
try {
  const plan=JSON.parse(fs.readFileSync(planPath,'utf8')) as {id:string;patches:CatalogImagePatch[]};
  if(!/^[a-zA-Z0-9_-]+$/.test(plan.id))throw new Error('Identificador de lote inválido');
  if(action==='check'){
    if(!Array.isArray(plan.patches)||plan.patches.length>10000||new Set(plan.patches.map(p=>p.productId)).size!==plan.patches.length)throw new Error('Lote inválido o duplicado');
    const catalog=new Map(catalogRepository.getAllProducts().map(p=>[p.id,p]));
    for(const patch of plan.patches){
      const product=catalog.get(patch.productId);
      if(!product)throw new Error(`Producto no encontrado: ${patch.productId}`);
      imageMetadataPatch(product,patch);
    }
    console.log(JSON.stringify({id:plan.id,products:plan.patches.length,valid:true}));
  }
  else {
    if(!process.env.BOLT_IMAGE_ACTOR)throw new Error('Identifica al operador autorizado con BOLT_IMAGE_ACTOR');
    const dir=path.resolve('.bolt-private/image-batches',plan.id);fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const file=path.resolve('src/data/persisted-catalog-overrides.json');
    if(!fs.existsSync(path.join(dir,'before.json')))fs.writeFileSync(path.join(dir,'before.json'),fs.existsSync(file)?fs.readFileSync(file):'{}',{mode:0o600});
    const planFile=path.join(dir,'plan.json');
    if(fs.existsSync(planFile)&&fs.readFileSync(planFile,'utf8')!==JSON.stringify(plan,null,2)){
      if(fs.existsSync(path.join(dir,'result.json')))throw new Error('El ID ya identifica otro plan aplicado.');
      fs.renameSync(planFile,path.join(dir,`rejected-plan-${Date.now()}.json`));
    }
    if(!fs.existsSync(planFile))fs.writeFileSync(planFile,JSON.stringify(plan,null,2),{mode:0o600});
    const result=catalogRepository.applyImagePatches(plan.patches,{name:process.env.BOLT_IMAGE_ACTOR,email:'local-authorized-operator'});
    fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({...result,at:new Date().toISOString()},null,2));
    console.log(JSON.stringify({...result,backup:dir,storage:file}));
  }
} finally {release();}
