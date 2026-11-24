import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {AddressConfirmationModal} from '../../../src/components/customer/AddressConfirmationModal';
import {evaluateDeliveryQuote} from '../../../src/lib/deliveryService';
import {INITIAL_STORES} from '../../../src/data/seedData';
import fixtures from '../../../src/tests/coverage-address-fixtures.json';

const cedritos=fixtures.find(f=>f.name==='Cedritos')!;
const chapinero=fixtures.find(f=>f.name==='Chapinero')!;
const suba=fixtures.find(f=>f.name==='Suba')!;
const chia=fixtures.find(f=>f.name==='Chia')!;
const respond=(body:unknown, status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});

const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
const el=(sel:string)=>document.querySelector(sel);
const button=(match:RegExp)=>[...document.querySelectorAll<HTMLButtonElement>('#root button')].find(b=>match.test(b.textContent || ''));
const assert=(condition:unknown,message:string)=>{if(!condition)throw Error(message)};
// Safari may suspend timers in a background tab. Read the current UI once more on resume.
async function eventually(predicate: () => unknown, message: string, limit = 8000) {
  const deadline = Date.now() + limit;
  while (!predicate()) {
    if (Date.now() >= deadline) throw Error(message);
    await sleep(20);
  }
}
const street=()=>document.querySelector<HTMLInputElement>('input[aria-label="Dirección de entrega"]')!;
const marker=()=>el('[data-test=marker]') as HTMLButtonElement|null;
const pointIs=(f:any)=>marker()?.dataset.lat===String(f.coordinates.lat) && marker()?.dataset.lng===String(f.coordinates.lng);
const fill=(input:HTMLInputElement,text:string)=>{
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,text);
  input.dispatchEvent(new Event('input',{bubbles:true}));
};
let quoteRequests:Parameters<typeof evaluateDeliveryQuote>[0][]=[],reverseCalls=0,forwardCalls=0,gpsCalls=0,unexpected:string[]=[];
let interceptReverse:(f:any)=>Promise<Response>,interceptForward:()=>Promise<Response>;
type Fixture=typeof cedritos;
function resolved(f:Fixture){return respond({status:'OK',address:f.formattedAddress,formattedAddress:f.formattedAddress,municipality:f.municipality,locality:f.locality});}
function candidates(...list:Fixture[]) {return respond({status:'SELECT_ADDRESS',message:'Selecciona una dirección.',candidates:list.map(f=>({...f,placeId:f.name}))});}
window.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input),window.location.origin);

  if(url.pathname==='/api/v1/geocode/forward'){forwardCalls++;return interceptForward()}
  if(url.pathname==='/api/v1/geocode/reverse'){reverseCalls++;const f=fixtures.find(f=>f.coordinates.lat===Number(url.searchParams.get('lat')) && f.coordinates.lng===Number(url.searchParams.get('lng')));if(!f)throw Error('Coordenadas no presentes en fixtures');return interceptReverse(f)}
  if(url.pathname==='/api/v1/delivery/quote'){const q=JSON.parse(String(init?.body));quoteRequests.push(q);return respond(evaluateDeliveryQuote(q,INITIAL_STORES))}
  unexpected.push(url.pathname);
  return respond({error:'Petición deshabilitada en esta prueba'},405);
}) as typeof fetch;
let gpsError=0;
Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(success:PositionCallback,fail:PositionErrorCallback){
  gpsCalls++;
  if(gpsError){queueMicrotask(()=>fail({code:gpsError} as GeolocationPositionError));return}
  queueMicrotask(()=>success({coords:{latitude:cedritos.coordinates.lat,longitude:cedritos.coordinates.lng,accuracy:18},timestamp:Date.now()} as GeolocationPosition));
}}});
// The standalone runner bundles the real form but doesn't compile its Tailwind stylesheet.
const mapLayout=document.createElement('style');
mapLayout.textContent='[data-address-map-frame]{position:relative;height:224px;width:100%}';
document.head.appendChild(mapLayout);
const root=createRoot(document.getElementById('root')!);
let mount=0;
function loadStreetTiles(){
  const target=el('[data-test=map-tiles]') as HTMLButtonElement;
  flushSync(()=>target.click());
}
async function reset(saved=false, waitFor: 'form' | 'map' | 'tiles' = 'tiles'){
  quoteRequests=[]; reverseCalls=forwardCalls=gpsCalls=gpsError=0; unexpected=[];
  interceptReverse=async f=>resolved(f);interceptForward=async()=>candidates(chapinero,suba);
  flushSync(()=>root.render(<React.StrictMode><AddressConfirmationModal key={++mount} isOpen onClose={()=>{}} currentAddress={saved?cedritos.address:''} currentDetails={saved?'Recepción':''} currentCoordinates={saved?cedritos.coordinates:undefined} currentTerritory={saved?cedritos:undefined} onConfirmAddress={()=>true} stores={INITIAL_STORES} cartItems={[]}/></React.StrictMode>));
  await eventually(()=>street(),'No se montó el formulario');
  if(waitFor==='form')return;
  el('[data-address-map-frame]')?.scrollIntoView({block:'center'});
  await eventually(()=>el('[data-test=map-tiles]'),'No se inicializó el mapa al tener tamaño');
  if(waitFor==='tiles')loadStreetTiles();
  if(saved)await eventually(()=>button(/Usar esta dirección/)?.disabled===false,'No se restauró el destino verificado');
}
async function setMunicipality(){
  const select=el('[aria-label="Municipio de entrega"]') as HTMLSelectElement;
  select.value=cedritos.municipality;select.dispatchEvent(new Event('change',{bubbles:true}));await sleep(20);
}
const tests:[string,()=>Promise<void>][]=[
  ['Al volver a la pestaña se recupera el mapa pendiente y se conserva el mapa ya pintado',async()=>{
    const originalHidden=Object.getOwnPropertyDescriptor(document,'hidden');
    const originalVisibility=Object.getOwnPropertyDescriptor(document,'visibilityState');
    const changeVisibility=(hidden:boolean)=>{
      Object.defineProperty(document,'hidden',{configurable:true,value:hidden});
      Object.defineProperty(document,'visibilityState',{configurable:true,value:hidden?'hidden':'visible'});
      flushSync(()=>document.dispatchEvent(new Event('visibilitychange')));
    };
    const surface=()=>el('[data-test=map-surface]');
    try {
      changeVisibility(true);
      await reset(false,'form');
      const frame=el('[data-address-map-frame]');
      assert(frame && frame.clientWidth>0 && frame.clientHeight>0,'La prueba debe tener espacio mientras la pestaña está oculta');
      await sleep(40);
      assert(!surface(),'El mapa se inicializó en segundo plano');
      changeVisibility(false);
      await eventually(surface,'El mapa no se inicializó al mostrar la pestaña');
      changeVisibility(true);
      await eventually(()=>!surface(),'Se conservó un mapa suspendido antes de pintar calles');
      changeVisibility(false);
      await eventually(surface,'No se recuperó el mapa pendiente');
      loadStreetTiles();
      (el('[data-test=map-click]') as HTMLButtonElement).click();
      await eventually(()=>pointIs(chapinero) && street().value===chapinero.formattedAddress && quoteRequests.length===1,'No se ubicó el punto antes de volver a segundo plano');
      const paintedSurface=surface();
      changeVisibility(true);
      (el('[data-test=map-chia]') as HTMLButtonElement | null)?.click();
      changeVisibility(false);
      await sleep(40);
      assert(surface()===paintedSurface && pointIs(chapinero),'Regresar a primer plano creó otro mapa o perdió el pin');
      assert(reverseCalls===1 && quoteRequests.length===1 && forwardCalls===0 && gpsCalls===0,'Cambiar de pestaña repitió una consulta de ubicación o cotización');
      marker()!.click();
      await eventually(()=>pointIs(suba) && street().value===suba.formattedAddress,'El pin pintado dejó de responder al volver a la pestaña');
    } finally {
      if(originalHidden)Object.defineProperty(document,'hidden',originalHidden);else Reflect.deleteProperty(document,'hidden');
      if(originalVisibility)Object.defineProperty(document,'visibilityState',originalVisibility);else Reflect.deleteProperty(document,'visibilityState');
      document.dispatchEvent(new Event('visibilitychange'));
    }
  }],
  ['El mapa espera a tener altura visible y carga al aparecer el formulario',async()=>{
    const originalLayout=mapLayout.textContent;
    try {
      mapLayout.textContent+='[data-address-map-frame]{height:0!important;min-height:0!important}';
      await reset(false,'form');
      const frame=el('[data-address-map-frame]');
      assert(frame && frame.getBoundingClientRect().height<=2,'La prueba necesita un mapa inicialmente sin altura');
      await sleep(60);
      assert(!el('[data-test=map-surface]'),'Se inicializó un mapa sin espacio para pintar las calles');
      mapLayout.textContent=originalLayout;
      frame!.scrollIntoView({block:'center'});
      await eventually(()=>el('[data-test=map-tiles]'),'No se recuperó el mapa al ganar altura');
      loadStreetTiles();
      (el('[data-test=map-click]') as HTMLButtonElement).click();
      await eventually(()=>street().value===chapinero.formattedAddress,'Las calles se cargaron sin recuperar la selección en el mapa');
    } finally {mapLayout.textContent=originalLayout;}
  }],
  ['El mapa raster espera las calles y la proyección antes de aceptar un punto',async()=>{
    await reset(true,'map');
    assert(el('[data-test=map-surface]')?.getAttribute('data-rendering')==='RASTER','El mapa de direcciones no pide el renderizador raster');
    const originalStreet=street().value;
    const initialQuotes=quoteRequests.length;
    (el('[data-test=map-click]') as HTMLButtonElement).click();
    marker()?.click();
    await sleep(30);
    assert(reverseCalls===0 && quoteRequests.length===initialQuotes && street().value===originalStreet,'Un toque o arrastre actualizó el destino antes de cargar las calles');
    loadStreetTiles();
    (el('[data-test=map-invalid-projection]') as HTMLButtonElement).click();
    await sleep(30);
    assert(reverseCalls===0 && street().value===originalStreet,'Un punto fuera de los límites visibles se envió a resolver');
    (el('[data-test=map-click]') as HTMLButtonElement).click();
    await eventually(()=>pointIs(chapinero) && street().value===chapinero.formattedAddress,'No se habilitó el toque tras cargar las calles');
    marker()!.click();
    await eventually(()=>pointIs(suba) && street().value===suba.formattedAddress,'No se habilitó el arrastre tras cargar las calles');
    assert(reverseCalls===2,'Se enviaron consultas extra al cambiar el punto dos veces');
  }],
  ['Cambiar el punto de Bogotá a Chía actualiza el municipio antes de continuar',async()=>{
    await reset(true);
    (el('[data-test=map-chia]') as HTMLElement).click();
    await eventually(()=>pointIs(chia) && street().value===chia.formattedAddress, 'El mapa o la dirección conservaron el destino anterior');
    const select=el('[aria-label="Municipio de entrega"]') as HTMLSelectElement;
    assert(select.value===chia.municipality && quoteRequests.at(-1)?.destination.municipality===chia.municipality,
      'El municipio seleccionado o el municipio cotizado no corresponden al punto nuevo');
  }],
  ['Editar durante la consulta inversa descarta una dirección tardía',async()=>{
    await reset(true);let release!:()=>void;
    interceptReverse=async f=>{await new Promise<void>(r=>release=r);return resolved(f)};
    interceptForward=async()=>candidates(suba);
    (el('[data-test=map-click]') as HTMLElement).click();
    await eventually(()=>!!release && pointIs(chapinero),'La resolución del pin no quedó pendiente');
    const initialQuotes=quoteRequests.length;
    fill(street(),suba.address);await sleep(20);release();
    await eventually(()=>button(/Elegir esta dirección/),'La dirección nueva fue sobrescrita por la respuesta del punto anterior');
    assert(street().value===suba.address && pointIs(chapinero),'El texto cambió o se perdió el pin de referencia');
    assert(quoteRequests.length===initialQuotes && button(/Validar este destino/)?.disabled,'Se cotizó o se puede validar una pareja de dirección y coordenadas caducada');
  }],
  ['Editar una calle conserva el pin de referencia y bloquea su validación',async()=>{
    await reset(true);const count=quoteRequests.length;
    interceptForward=async()=>respond({status:'UNAVAILABLE',candidates:[],message:'La búsqueda está temporalmente fuera de servicio.'});
    fill(street(),chapinero.address);await eventually(()=>forwardCalls>0,'No llegó la búsqueda');await sleep(50);
    assert(pointIs(cedritos),'Desapareció el pin existente al editar la calle');
    assert(button(/Validar este destino/)?.disabled,'Un pin anterior puede validar la calle recién escrita');
    assert(!button(/Usar esta dirección/) || button(/Usar esta dirección/)!.disabled,'Se puede confirmar una calle sin resolver');
    assert(quoteRequests.length===count,'Se cotizó con el punto anterior');
  }],
  ['Una elección explícita de candidato mueve el pin y cotiza el punto elegido',async()=>{
    await reset();await setMunicipality();fill(street(),chapinero.address);
    await eventually(()=>button(/Elegir esta dirección/),'No aparecieron candidatos');
    assert(!marker() && quoteRequests.length===0,'Se eligió el primer resultado sin confirmación');
    button(/Elegir esta dirección/)!.click();await eventually(()=>pointIs(chapinero) && button(/Usar esta dirección/)?.disabled===false,'El candidato no recibió su cotización');
    assert(quoteRequests.at(-1)?.destination.coordinates?.lng===chapinero.coordinates.lng,'La cotización usó otro destino');
  }],
  ['Un toque en mapa durante la búsqueda permite confirmar la dirección nueva',async()=>{
    await reset();await setMunicipality();let release!:()=>void;
    interceptForward=async()=>{await new Promise<void>(r=>release=r);return candidates(suba)};
    fill(street(),suba.address);await eventually(()=>!!release,'No quedó la búsqueda en espera');
    (el('[data-test=map-click]') as HTMLElement).click();
    await eventually(()=>street().value===chapinero.formattedAddress,'El clic no actualizó la dirección');
    release();await sleep(100);
    assert(pointIs(chapinero) && !button(/Elegir esta dirección/),'Una búsqueda tardía reemplazó el pin');
    assert(button(/Usar esta dirección/)?.disabled===false,'El indicador de búsqueda obsoleto bloqueó la confirmación');
  }],
  ['Ubicación obtenida, consulta fallida y reintento del mismo punto sin otro GPS',async()=>{
    await reset();interceptReverse=async f=>reverseCalls===1?respond({error:'Servicio no disponible'},503):resolved(f);
    button(/Usar mi ubicación actual/)!.click();await eventually(()=>reverseCalls===1 && pointIs(cedritos),'El GPS no colocó el punto');
    await eventually(()=>button(/reintent.*direcci|volver a consultar.*direcci/i),'Falta reintentar la dirección del punto GPS');
    assert(!document.body.innerText.includes('En iPhone y Safari:'),'Mostró instrucciones de permisos después de obtener las coordenadas');
    button(/reintent.*direcci|volver a consultar.*direcci/i)!.click();await eventually(()=>street().value===cedritos.formattedAddress,'Reintentar no recuperó la dirección');
    assert(gpsCalls===1 && reverseCalls===2,'Se volvió a pedir la ubicación al teléfono');
  }],
  ['Dos movimientos conservan la última dirección aunque el primero responda tarde',async()=>{
    await reset();let release!:()=>void;
    interceptReverse=async f=>{if(f===chapinero)await new Promise<void>(r=>release=r);return resolved(f)};
    (el('[data-test=map-click]') as HTMLElement).click();await eventually(()=>!!release && pointIs(chapinero),'El primer punto no apareció');
    marker()!.click();await eventually(()=>street().value===suba.formattedAddress,'El arrastre no actualizó la dirección');
    release();await sleep(90);assert(pointIs(suba) && street().value===suba.formattedAddress,'Una respuesta antigua reemplazó al punto nuevo');
    assert(quoteRequests.length===1 && quoteRequests[0].destination.coordinates.lng===suba.coordinates.lng,'Se cotizó una respuesta antigua');
  }],
  ['Denegar permiso mantiene la opción de escribir y evita consultar coordenadas',async()=>{
    await reset();gpsError=1;button(/Usar mi ubicación actual/)!.click();
    await eventually(()=>button(/^Escribir dirección$/),'Falta la acción de entrada manual');
    assert(document.body.innerText.includes('En iPhone y Safari:'),'Faltan los pasos de permisos de Safari');
    button(/^Escribir dirección$/)!.click();assert(document.activeElement===street(),'El foco no pasó a la dirección');
    assert(!marker() && reverseCalls===0 && quoteRequests.length===0,'El rechazo cambió el destino');
  }],
];
document.getElementById('run')!.onclick=async()=>{
  const run=document.getElementById('run') as HTMLButtonElement;run.disabled=true;
  const report=document.getElementById('resultado')!;report.dataset.done='false';
  const rows:{name:string;ok:boolean;detail:string}[]=[];
  for(const [name,fn] of tests){
    let ok=true,detail='';
    try{await fn();assert(unexpected.length===0,'Petición inesperada '+unexpected.join(', '))}catch(e){ok=false;detail=e instanceof Error?e.message:String(e)}
    rows.push({name,ok,detail});
    report.textContent=rows.map(row=>(row.ok?'PASS ':'FAIL ')+row.name+(row.detail?' — '+row.detail:'')).join('\n');
  }
  report.dataset.failures=String(rows.filter(row=>!row.ok).length);
  report.dataset.done='true';run.disabled=false;
};
