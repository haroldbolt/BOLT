import fs from 'node:fs';
import path from 'node:path';
import { CatalogOperations } from '../src/lib/catalogOperations';
import { acquireCatalogWriterLock } from '../src/lib/catalogWriterLock';
import { catalogRepository } from '../src/lib/catalogRepository';
import { localCatalogService } from '../src/lib/localCatalogService';

// Local administrative maintenance, protected by filesystem access and the server's writer lock.
// Never provisions an account, bypasses HTTP auth, contacts Shopify or modifies an order.
const [action,id,sourcePath]=process.argv.slice(2);
const allowed=['prepare-prices','prepare','apply','report','reverse'];
if(!allowed.includes(action)||!id)throw new Error('Uso: node --import tsx scripts/catalog-batch.ts prepare|apply|report|reverse ID [fuente.json]');
if(!process.env.BOLT_BATCH_ACTOR)throw new Error('Indica BOLT_BATCH_ACTOR para la auditoría del operador local autorizado');
const release=acquireCatalogWriterLock();
try {
 const actor={name:process.env.BOLT_BATCH_ACTOR,email:'local-authorized-operator'};
 const readOrders=()=>JSON.parse(fs.readFileSync('src/data/persisted-orders.json','utf8'));
 const operations=new CatalogOperations({file:path.resolve('.bolt-private/catalog-operations.json'),products:()=>catalogRepository.getAllProducts(true),stores:()=>localCatalogService.getStores(),orders:readOrders});
 if(action==='prepare' || action==='prepare-prices') operations.prepare(id,JSON.parse(fs.readFileSync(sourcePath,'utf8')),actor,action==='prepare-prices'?0:6);
 if(action==='apply') {let batch=operations.getBatch(id);while(batch.status!=='COMPLETED'){batch=operations.apply(id,actor,500);console.log(JSON.stringify({completed:batch.rows.filter(r=>r.done).length,total:batch.rows.length}));}}
 if(action==='reverse')operations.reverse(id,actor);
 const batch=operations.getBatch(id);
 const current=operations.getProducts();const byId=new Map(current.map(p=>[p.id,p]));
 const rows=batch.rows.flatMap(r=>(r.stocks.length?r.stocks:[null]).map(s=>({lote:id,producto:r.product,producto_id:r.productId,variante:r.variant,variante_id:r.variantId,sku:r.sku,bodega:s?.storeName||'',bodega_id:s?.storeId||'',existencia_anterior:s?.before??'',existencia_posterior:s?.after??'',reservas_conservadas:s?.reserved??'',precio_anterior:r.price.before,precio_shopify:r.price.rawConsulted??'',precio_aplicado:byId.get(r.productId)?.presentaciones?.find(v=>v.varianteId===r.variantId)?.price??r.price.before,moneda:batch.source.currency,fuente:r.price.source||'',fecha_consulta:batch.source.consultedAt,estado_inventario:s?.status||'SIN_BODEGA_ACTIVA_ASOCIADA',motivo_inventario:s?.reason||'',estado_precio:r.price.status,motivo_precio:r.price.reason||'',metodo:r.price.method||''})));
 const out=path.resolve('.bolt-private/reports',id);fs.mkdirSync(out,{recursive:true,mode:0o700});
 const escape=(v:unknown)=>'"'+String(v??'').replace(/"/g,'""')+'"';
 fs.writeFileSync(path.join(out,'detalle.csv'),'\uFEFF'+[Object.keys(rows[0]).map(escape).join(','),...rows.map(row=>Object.values(row).map(escape).join(','))].join('\r\n'));
 const summary={id,status:batch.status,products:new Set(batch.rows.map(r=>r.productId)).size,variants:batch.rows.length,warehouses:[...new Set(batch.rows.flatMap(r=>r.stocks.map(s=>s.storeId)))],adjustments:batch.rows.flatMap(r=>r.stocks).filter(s=>s.status==='APPLIED').length,pricesUpdated:batch.rows.filter(r=>r.price.status==='APPLIED').length,pricesUnchanged:batch.rows.filter(r=>r.price.status==='UNCHANGED').length,pricesPending:batch.rows.filter(r=>r.price.status==='SKIPPED').length,backupPath:batch.backupPath,storage:path.resolve('.bolt-private/catalog-operations.json'),source:batch.source};
 fs.writeFileSync(path.join(out,'resumen.json'),JSON.stringify(summary,null,2));fs.writeFileSync(path.join(out,'lote.json'),JSON.stringify(batch));
 console.log(JSON.stringify(summary,null,2));
}finally{release();}
