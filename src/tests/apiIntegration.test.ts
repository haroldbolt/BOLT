import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AdminRepository } from '../lib/adminRepository';
import { INITIAL_PRODUCTS, INITIAL_STORES, INITIAL_ORDERS, INITIAL_DRIVERS } from '../data/seedData';
import type { Order } from '../types';

const dir = mkdtempSync(path.join(tmpdir(), 'bolt-http-'));
const previousDataDir = process.env.BOLT_DATA_DIR;
process.env.BOLT_DATA_DIR = path.join(dir, 'module-default');
const { createBoltApp } = await import('../../server');
const { OrdersRepository } = await import('../lib/ordersRepository');
const products = structuredClone(INITIAL_PRODUCTS);
const product = products[0];
product.stockByStore.HUB_KENNEDY = 10;
product.reservedStockByStore.HUB_KENNEDY = 0;
Object.assign(product, { inventoryVerifiedByStore: { HUB_KENNEDY: true } });
const repository = new OrdersRepository({ dataDir: dir, initialOrders: [], initialDrivers: structuredClone(INITIAL_DRIVERS) });
const stores = structuredClone(INITIAL_STORES);
const adminRepository = new AdminRepository({ dataDir: dir, products, stores });
adminRepository.createAdministrator('qa.api', 'Acceso-Aislado-API-2026');
const session = await adminRepository.login('qa.api', 'Acceso-Aislado-API-2026', 'qa-api');
const authorizedHeaders = { Cookie: `bolt_admin_session=${session.token}`, 'X-CSRF-Token': session.csrfToken };
const app = await createBoltApp({ serveFrontend: false, products, stores, repository, adminRepository });
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const port = (server.address() as {port:number}).port;
const base = `http://127.0.0.1:${port}/api/v1`;
let passed = 0;
function check(value: unknown, label: string) { assert.ok(value, label); passed++; }
async function post(url: string, body: unknown, headers: Record<string,string> = {}) {
  const res = await fetch(base + url, { method:'POST', headers:{'Content-Type':'application/json',...authorizedHeaders,...headers}, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() as any };
}
const payload = {
  storeId:'HUB_KENNEDY', deliveryMode:'TURBO',
  items:[{ productId:product.id,quantity:1,price:1,weightKg:0.001,requiresPrescription:false }],
  customer:{name:'Prueba aislada',phone:'0000000000',email:'prueba@example.invalid',isGuest:true},
  deliveryAddress:{address:'Dirección de prueba, Kennedy',details:'',porteriaPolicy:'DEJAR_EN_PORTERIA',coordinates:{lat:4.6325,lng:-74.1520}},
  paymentMethod:'WOMPI_CARD',tip:0,
};
try {
  const created = await post('/orders',payload);
  assert.equal(created.status,201,JSON.stringify(created.body));passed++;
  check(product.reservedStockByStore.HUB_KENNEDY === 1,'Una unidad pedida reserva solo una unidad a través de HTTP');
  check(created.body.items[0].price === product.price,'El precio enviado por el cliente no altera el precio del servidor');
  check(created.body.items[0].weightKg === product.weightKg,'El peso enviado por el cliente no altera el peso del servidor');
  check(created.body.payment.status === 'PENDIENTE' && !created.body.payment.transactionId,'No se acredita un pago ni se inventa una transacción');
  product.stockByStore.HUB_KENNEDY = 1;
  const failed = await post('/orders',payload);
  check(failed.status === 400,'Se rechaza el pedido sin unidades libres');
  check(product.reservedStockByStore.HUB_KENNEDY === 1,'Un pedido rechazado no deja otra reserva aplicada');
  const invalid = await post('/orders',{...payload,items:[{...payload.items[0],quantity:-1}]});
  check(invalid.status === 400,'Se rechazan cantidades negativas');

  const order = structuredClone(INITIAL_ORDERS[0]) as Order;
  order.id='HTTP-GPS-SPLIT';order.orderNumber='HTTP-GPS-SPLIT';order.isSplitOrder=true;order.fulfillmentStatus='EN_CAMINO';
  order.childShipments=[0,1].map(i=>({shipmentId:`HTTP-HIJO-${i}`,parentOrderId:order.id,shipmentIndex:i+1,shipmentCount:2,
    items:order.items,weightKg:10,weightGrams:10000,subtotal:10,cashToCollect:0,fulfillmentStatus:'EN_CAMINO',secretDeliveryCode:'0000',
    estimatedDeliveryMinutes:25,timestamps:{},driver:structuredClone(INITIAL_DRIVERS[i]),assignmentId:`ASG-HTTP-${i}`,tripId:`TRIP-HTTP-${i}`}));
  const stored=repository.createOrder(order);check(stored.success,'Se prepara pedido dividido aislado');
  const child=order.childShipments[0];
  const point={pointId:'GPS-HTTP-1',orderId:order.id,shipmentId:child.shipmentId,driverId:child.driver!.id,assignmentId:child.assignmentId,tripId:child.tripId,
    latitude:4.65,longitude:-74.10,accuracy:10,timestamp:Date.now(),sequenceNumber:1};
  const gpsHeaders = {'x-driver-id':child.driver!.id};
  const sent=await post('/driver/gps',point,gpsHeaders);check(sent.status===200,'Se acepta GPS válido del hijo');
  const tracked = await fetch(base+`/orders/${order.id}/tracking?shipmentId=${child.shipmentId}`, { headers: authorizedHeaders }).then(r=>r.json()) as any;
  check(tracked.assignmentId===child.assignmentId && tracked.tripId===child.tripId,'El contexto corresponde al hijo solicitado');
  check(tracked.nextSequenceNumber===2 && tracked.telemetry.pointId===point.pointId,'El servidor devuelve la secuencia para reanudar');
  const parent=await fetch(base+`/orders/${order.id}/tracking`, { headers: authorizedHeaders }).then(r=>r.json()) as any;
  check(parent.telemetry===null,'El padre no mezcla la ubicación de los hijos');
  const second=await fetch(base+`/orders/${order.id}/tracking?shipmentId=HTTP-HIJO-1`, { headers: authorizedHeaders }).then(r=>r.json()) as any;
  check(second.telemetry===null,'El segundo hijo no recibe puntos del primero');
  const unknown=await fetch(base+`/orders/${order.id}/tracking?shipmentId=NO-EXISTE`, { headers: authorizedHeaders });
  check(unknown.status===404,'Un hijo inexistente no devuelve el rastreo del padre');
  const repeated=await post('/driver/gps',point,gpsHeaders);
  check(repeated.status===200 && repository.getTelemetryHistory(order.id,child.shipmentId).length===1,'Reintentar la misma lectura no duplica puntos');
  const withoutDate:any={...point,pointId:'GPS-SIN-FECHA',sequenceNumber:2};delete withoutDate.timestamp;
  const rejected=await post('/driver/gps',withoutDate,gpsHeaders);
  check(rejected.status===400,'Se rechaza una lectura sin fecha');
  console.log(`API aislada: ${passed} comprobaciones aprobadas`);
} finally {
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  app.locals.closeAdmin();
  if (previousDataDir === undefined) delete process.env.BOLT_DATA_DIR; else process.env.BOLT_DATA_DIR = previousDataDir;
  // Es un directorio exacto creado por esta prueba, fuera del proyecto.
  if(path.dirname(dir)!==path.resolve(tmpdir()) || !path.basename(dir).startsWith('bolt-http-'))throw new Error('Directorio temporal inválido');
  rmSync(dir,{recursive:true,force:true});
}
