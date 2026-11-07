import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Product, Store, Order } from '../types';
import { saleVariant, salesCatalog } from './variantCommerce';

type Actor = { email: string; name: string };
type Numbers = Record<string, number>;
type Effect = { sold: number; reserved: number };
export type PriceSource = {
  shop: string; currency: string; complete: boolean; completedAt: string;
  variants: Array<{ id: string; sku?: string | null; title: string; price: string | null; compareAtPrice?: string | null; product: { id: string; title: string; handle: string } }>;
};
type Value = { productId: string; variantId: string; price: number; stock: Numbers; reserved: Numbers; delta: Numbers; revision: number };
type PricePlan = { status: string; reason?: string; before: number; rawConsulted?: string | null; consulted?: number; applied?: number; source?: string; sourceId?: string; method?: string; revision?: number };
type StockPlan = { storeId: string; storeName: string; status: string; before?: number; after?: number; reserved?: number; reason?: string; reversed?: boolean };
type Row = { key: string; productId: string; product: string; variantId: string; variant: string; sku: string; price: PricePlan; stocks: StockPlan[]; done: boolean };
export type CatalogBatch = { id: string; inventoryDelta?: 0 | 6; createdAt: string; actor: Actor; reason: string; source: { shop: string; currency: string; consultedAt: string; sha256: string }; backupPath: string; rows: Row[]; status: string; audit: Array<{ at: string; actor: Actor; action: string; count: number }> };
type State = { version: 1; values: Record<string, Value>; baselineEffects: Record<string, Effect>; batches: Record<string, CatalogBatch>; audit: any[] };
const copy = <T>(v:T):T => structuredClone(v);
const hash = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const keyFor = (p: string, v: string) => JSON.stringify([p,v]);
const effectKey = (p:string,s:string) => JSON.stringify([p,s]);

// Orders are the durable source of reservation/delivery effects. No order is rewritten.
export function orderEffects(orders: Order[]): Record<string, Effect> {
  const effects: Record<string, Effect> = {};
  for(const order of orders) {
    const shipments = order.childShipments?.length ? order.childShipments : [order];
    for(const shipment of shipments) for(const item of shipment.items || []) {
      const key = effectKey(item.productId, order.storeId);
      const e = effects[key] ||= {sold:0,reserved:0};
      if(shipment.fulfillmentStatus === 'ENTREGADO') e.sold += item.quantity;
      else if(shipment.fulfillmentStatus !== 'CANCELADO' || shipment.physicalReturnPending) e.reserved += item.quantity;
    }
  }
  return effects;
}

export function parseCOP(raw: unknown, currency: string): number | null {
  // Shopify Money uses a decimal point, never locale thousands separators.
  if(currency !== 'COP' || typeof raw !== 'string' || !/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER / 100 ? n : null;
}

export class CatalogOperations {
  private state?: State;
  constructor(private options: { file: string; products: () => Product[]; stores: () => Store[]; orders: () => Order[] }) {
    if(fs.existsSync(options.file)) this.state = JSON.parse(fs.readFileSync(options.file,'utf8'));
  }
  private persist(next: State) {
    fs.mkdirSync(path.dirname(this.options.file),{recursive:true, mode:0o700});
    const temporary = this.options.file + '.tmp';
    const fd=fs.openSync(temporary,'w',0o600);
    try { fs.writeFileSync(fd,JSON.stringify(next)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary,this.options.file);
    this.state=next; // Commit effects and completion markers together, only after durable write.
  }
  private fresh(): State { return {version:1,values:{},baselineEffects:orderEffects(this.options.orders()),batches:{},audit:[]}; }
  private ensureValue(state: State, p:Product, variantId:string): Value {
    const k=keyFor(p.id,variantId);
    if(!state.values[k]) {
      const v=saleVariant(p,variantId);
      state.values[k]={productId:p.id,variantId,price:v.price,stock:copy(v.stockByStore||{}),reserved:copy(v.reservedStockByStore||{}),delta:{},revision:0};
    }
    return state.values[k];
  }
  private current(p:Product, variantId:string, state:State|undefined, effects:Record<string,Effect>) {
    const sale=saleVariant(p,variantId), value=state?.values[keyFor(p.id,variantId)];
    if(!value || !state) return {...sale,commerceRevision:hash({price:sale.price,stock:sale.stockByStore,reserved:sale.reservedStockByStore})};
    const stock:Numbers={}, reserved:Numbers={};
    const storeIds=new Set([...Object.keys(value.stock),...Object.keys(value.delta),...Object.keys(value.reserved),...this.options.stores().map(s=>s.id)]);
    for(const id of storeIds) {
      const e=effects[effectKey(sale.id,id)] || {sold:0,reserved:0};
      const b=state.baselineEffects[effectKey(sale.id,id)] || {sold:0,reserved:0};
      stock[id]=(value.stock[id]||0)+(value.delta[id]||0)-(e.sold-b.sold);
      reserved[id]=Math.max(0,(value.reserved[id]||0)+e.reserved-b.reserved);
    }
    return {...sale,price:value.price,stockByStore:stock,reservedStockByStore:reserved,commerceRevision:hash({revision:value.revision,stock,reserved,price:value.price})};
  }
  public initializeOrderTracking() {
    if(this.state) return;
    const state=this.fresh();
    for(const p of this.options.products()) {
      for(const id of p.presentaciones?.length ? p.presentaciones.map(v=>v.varianteId) : [p.id]) this.ensureValue(state,p,id);
    }
    this.persist(state); // Establish a durable baseline, no stock adjustment or price import.
  }
  public getProducts(): Product[] {
    const effects=orderEffects(this.options.orders());
    const baseProducts=this.options.products();
    // Register products added later before they can receive orders. Their initial state
    // must not remain a transient catalog object after the first batch migration.
    if(this.state) {
      const additions=baseProducts.flatMap(p=>(p.presentaciones?.length?p.presentaciones:[{varianteId:p.id}]).filter(v=>!this.state!.values[keyFor(p.id,v.varianteId)]).map(v=>({p,v})));
      if(additions.length) {
        const next=copy(this.state);
        for(const {p,v} of additions) {
          this.ensureValue(next,p,v.varianteId);
          const id=saleVariant(p,v.varianteId).id;
          for(const store of this.options.stores()) {
            const k=effectKey(id,store.id);next.baselineEffects[k]=effects[k]||{sold:0,reserved:0};
          }
        }
        this.persist(next);
      }
    }
    return baseProducts.map(p=>{
      const variants=p.presentaciones?.length ? p.presentaciones : [{varianteId:p.id,nombre:p.presentation,sku:p.sku,foto:p.image,bodegaIds:p.bodegaIds||Object.keys(p.stockByStore),transport:p.transport}];
      const presentaciones=variants.map(v=>{
        const current=this.current(p,v.varianteId,this.state,effects);
        return {...v,price:current.price,stockByStore:current.stockByStore,reservedStockByStore:current.reservedStockByStore,commerceRevision:current.commerceRevision};
      });
      const first=presentaciones[0];
      return {...p,price:first.price,stockByStore:first.stockByStore,reservedStockByStore:first.reservedStockByStore,commerceRevision:first.commerceRevision,presentaciones};
    });
  }
  public getSalesProducts() {return salesCatalog(this.getProducts());}
  public getBatch(id:string) { const b=this.state?.batches[id]; if(!b) throw new Error('Lote no encontrado'); return copy(b); }
  public listBatches() {return Object.values(this.state?.batches||{}).map(b=>({id:b.id,status:b.status,createdAt:b.createdAt,total:b.rows.length,completed:b.rows.filter(r=>r.done).length}));}
  public getAuditLog() {return [...(this.state?.audit||[]),...Object.values(this.state?.batches||{}).flatMap(b=>b.audit.map((a,i)=>({...a,id:`${b.id}:${i}`,timestamp:a.at,productName:`Lote ${b.id}`,details:{batchId:b.id,count:a.count,reason:b.reason}})))];}
  public prepare(id:string, source:PriceSource, actor:Actor, inventoryDelta:0|6=6): CatalogBatch {
    actor={email:actor.email,name:actor.name};
    if(inventoryDelta!==0&&inventoryDelta!==6)throw new Error('El lote permite +6 o solo precios (0)');
    if(!/^[a-zA-Z0-9_-]{6,100}$/.test(id)) throw new Error('ID de lote inválido');
    if(!source.complete || !Array.isArray(source.variants) || !source.shop || !Number.isFinite(Date.parse(source.completedAt))) throw new Error('Se necesita una consulta Shopify completa y fechada');
    const digest=hash(source);
    if(this.state?.batches[id]) {
      if(this.state.batches[id].source.sha256!==digest || (this.state.batches[id].inventoryDelta??6)!==inventoryDelta) throw new Error('El ID ya pertenece a otra fuente u operación; reanuda el lote original');
      return this.getBatch(id);
    }
    const products=this.getProducts(), stores=this.options.stores(), next=copy(this.state||this.fresh());
    const byId=new Map<string,PriceSource['variants']>(); const bySku=new Map<string,PriceSource['variants']>();
    for(const v of source.variants) {byId.set(v.id,[...(byId.get(v.id)||[]),v]);if(v.sku) bySku.set(v.sku,[...(bySku.get(v.sku)||[]),v]);}
    const boltSkuCounts=new Map<string,number>();
    for(const p of products) for(const v of p.presentaciones||[]) if(v.sku) boltSkuCounts.set(v.sku,(boltSkuCounts.get(v.sku)||0)+1);
    const rows:Row[]=[];
    for(const p of products) for(const v of p.presentaciones||[]) {
      const value=this.ensureValue(next,p,v.varianteId);
      const price:PricePlan={status:'PENDING',before:value.price,revision:value.revision};
      let matches=byId.get(v.varianteId)||[];
      let method='SHOPIFY_VARIANT_ID';
      if(!matches.length) {
        method='UNIQUE_EXACT_SKU'; matches=v.sku && boltSkuCounts.get(v.sku)===1 ? bySku.get(v.sku)||[] : [];
      }
      const match=matches.length===1 ? matches[0] : undefined;
      if(match && p.id.startsWith('gid://shopify/Product/') && match.product.id!==p.id) {
        price.status='SKIPPED';price.reason='Identificador de variante pertenece a otro producto';
      } else if(!match) {
        price.status='SKIPPED';price.reason=matches.length>1 || (v.sku && ((bySku.get(v.sku)?.length||0)>1 || (boltSkuCounts.get(v.sku)||0)>1)) ? 'SKU o ID duplicado/ambiguo' : 'Sin correspondencia inequívoca';
      } else {
        const n=parseCOP(match.price,source.currency);
        price.rawConsulted=match.price;
        price.source=`https://${source.shop}/admin/products/${match.product.id.split('/').pop()}/variants/${match.id.split('/').pop()}`;
        price.sourceId=match.id;price.method=method;
        if(n===null) {price.status='SKIPPED';price.reason=source.currency!=='COP'?'Moneda distinta de COP':'Precio de venta ausente, inválido o no positivo';}
        else price.consulted=n;
      }
      const associations=new Set(v.bodegaIds || []);
      const stocks=inventoryDelta===0?[]:stores.filter(s=>s.isActive && (associations.has(s.id)||!!s.shopifyLocationGid&&associations.has(s.shopifyLocationGid))).map(s=>({storeId:s.id,storeName:s.name,status:'PENDING'}));
      rows.push({key:keyFor(p.id,v.varianteId),productId:p.id,product:p.name,variantId:v.varianteId,variant:v.nombre,sku:v.sku,price,stocks,done:false});
    }
    const backupPath=path.join(path.dirname(this.options.file),'backups',id);
    fs.mkdirSync(backupPath,{recursive:true,mode:0o700});
    // Recovery data before any write. Orders are not copied or modified.
    const writeBackup=(file:string,contents:unknown)=>{const target=path.join(backupPath,file);const data=JSON.stringify(contents);if(fs.existsSync(target)){if(fs.readFileSync(target,'utf8')!==data)throw new Error('Respaldo existente no coincide: revisa la preparación interrumpida');}else fs.writeFileSync(target,data,{flag:'wx',mode:0o600});};
    writeBackup('catalog-before.json',{products,stores,orderEffects:orderEffects(this.options.orders()),ordersSha256:hash(this.options.orders())});
    writeBackup('operations-before.json',this.state||null);
    const batch:CatalogBatch={id,createdAt:new Date().toISOString(),actor,reason:'Ajuste manual autorizado de +6 unidades vendibles por variante y bodega asociada; no es conteo físico ni stock Shopify',source:{shop:source.shop,currency:source.currency,consultedAt:source.completedAt,sha256:digest},backupPath,rows,status:'PREPARED',audit:[]};
    batch.inventoryDelta=inventoryDelta;
    if(inventoryDelta===0)batch.reason='Actualización de precios desde Shopify, sin ajuste de inventario';
    next.batches[id]=batch;this.persist(next);return copy(batch);
  }
  public apply(id:string, actor:Actor, limit=100): CatalogBatch {
    actor={email:actor.email,name:actor.name};
    const next=copy(this.state!);const batch=next?.batches[id];if(!batch) throw new Error('Lote no encontrado');
    if(batch.status.startsWith('REVERS')) throw new Error('Lote en reversión: no se puede volver a aplicar');
    const base=new Map(this.options.products().map(p=>[p.id,p]));const effects=orderEffects(this.options.orders());const stores=this.options.stores();
    const pending=batch.rows.filter(r=>!r.done).slice(0,Math.max(1,Math.min(500,limit)));
    for(const row of pending) {
      const p=base.get(row.productId), v=p?.presentaciones?.find(v=>v.varianteId===row.variantId);
      if(!p||!v) {row.stocks.forEach(s=>{s.status='SKIPPED';s.reason='Variante eliminada desde la preparación'});row.price.status='SKIPPED';row.price.reason='Variante eliminada';row.done=true;continue;}
      const value=next.values[row.key];const current=this.current(p,row.variantId,next,effects);
      for(const stock of row.stocks) {
        const store=stores.find(s=>s.id===stock.storeId);
        const associated=store && (v.bodegaIds.includes(store.id)||!!store.shopifyLocationGid&&v.bodegaIds.includes(store.shopifyLocationGid));
        if(!store?.isActive || !associated) {stock.status='SKIPPED';stock.reason='Bodega inactiva o asociación retirada';continue;}
        stock.before=current.stockByStore[store.id]||0;stock.reserved=current.reservedStockByStore[store.id]||0;
        if(!Number.isSafeInteger(stock.before)||stock.before<0||!Number.isSafeInteger(stock.reserved)) {stock.status='SKIPPED';stock.reason='Existencia/reserva inválida';continue;}
        value.delta[store.id]=(value.delta[store.id]||0)+6;stock.after=stock.before+6;stock.status='APPLIED';
      }
      if(row.price.status==='PENDING') {
        if(value.revision!==row.price.revision || value.price!==row.price.before) {row.price.status='SKIPPED';row.price.reason='Precio modificado desde la preparación';}
        else {value.price=row.price.consulted!;value.revision++;row.price.applied=value.price;row.price.revision=value.revision;row.price.status=value.price===row.price.before?'UNCHANGED':'APPLIED';}
      }
      row.done=true;
    }
    if(pending.length) batch.audit.push({at:new Date().toISOString(),actor,action:'APPLY_MANUAL_PLUS_6_AND_SHOPIFY_PRICES',count:pending.length});
    batch.status=batch.rows.every(r=>r.done)?'COMPLETED':'RUNNING';
    this.persist(next);return copy(batch);
  }
  public edit(productId:string, params:{variantId?:string;priceCOP?:number;stockByStore?:Numbers;expectedRevision?:string},actor:Actor):Product {
    actor={email:actor.email,name:actor.name};
    const p=this.getProducts().find(p=>p.id===productId);if(!p) throw new Error('Producto no encontrado');
    const variantId=params.variantId||p.presentaciones?.[0]?.varianteId||p.id;
    const v=p.presentaciones?.find(v=>v.varianteId===variantId);if(!v)throw new Error('Variante no encontrada');
    if(!params.expectedRevision || params.expectedRevision!==v.commerceRevision) throw new Error('El precio o inventario cambió; recarga antes de guardar');
    if(params.priceCOP!==undefined && (!Number.isFinite(params.priceCOP)||params.priceCOP<=0))throw new Error('Precio COP inválido');
    const next=copy(this.state||this.fresh());const value=this.ensureValue(next,p,variantId);
    const current=saleVariant(p,variantId);
    for(const [storeId,qty] of Object.entries(params.stockByStore||{})) {
      const s=this.options.stores().find(s=>s.id===storeId);
      if(!s?.isActive || !(v.bodegaIds.includes(storeId)||!!s.shopifyLocationGid&&v.bodegaIds.includes(s.shopifyLocationGid)))throw new Error('Bodega no asociada o inactiva');
      if(!Number.isSafeInteger(qty)||qty<(current.reservedStockByStore[storeId]||0))throw new Error('Existencia inválida o menor que reservas');
      value.delta[storeId]=(value.delta[storeId]||0)+qty-(current.stockByStore[storeId]||0);
    }
    if(params.priceCOP!==undefined && params.priceCOP!==value.price){value.price=params.priceCOP;value.revision++;}
    next.audit.push({at:new Date().toISOString(),actor,action:'MANUAL_VARIANT_EDIT',productId,variantId,params});
    this.persist(next);return this.getProducts().find(p=>p.id===productId)!;
  }
  public reverse(id:string,actor:Actor):CatalogBatch {
    actor={email:actor.email,name:actor.name};
    const next=copy(this.state!);const batch=next?.batches[id];if(!batch)throw new Error('Lote no encontrado');
    const products=new Map(this.getProducts().map(p=>[p.id,p]));let count=0;
    for(const row of batch.rows.filter(r=>r.done)) {
      const p=products.get(row.productId),value=next.values[row.key];if(!p||!value)continue;
      const current=saleVariant(p,row.variantId);
      for(const s of row.stocks.filter(s=>s.status==='APPLIED'&&!s.reversed)) {
        if((current.stockByStore[s.storeId]||0)-(current.reservedStockByStore[s.storeId]||0)<6) {s.reason='Reversión pendiente: menos de 6 unidades disponibles';continue;}
        value.delta[s.storeId]=(value.delta[s.storeId]||0)-6;s.reversed=true;s.reason=undefined;count++;
      }
      if(['APPLIED','UNCHANGED'].includes(row.price.status)) {
        if(value.revision===row.price.revision && value.price===row.price.applied){value.price=row.price.before;value.revision++;row.price.status='REVERSED';}
        else row.price.reason='Reversión pendiente: precio modificado posteriormente';
      }
    }
    batch.status=batch.rows.every(r=>r.done&&r.stocks.every(s=>s.status!=='APPLIED'||s.reversed)&&!['APPLIED','UNCHANGED'].includes(r.price.status))?'REVERSED':'REVERSAL_PENDING';
    batch.audit.push({at:new Date().toISOString(),actor,action:'COMPENSATING_REVERSAL',count});this.persist(next);return copy(batch);
  }
}
