// Isolated browser harness; not imported by the customer app or copied into its production build.
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AddressConfirmationModal} from '../components/customer/AddressConfirmationModal';
import {SavedAddressesModal} from '../components/customer/SavedAddressesModal';
import {api} from '../lib/api';
import {GuestAddressStore} from '../lib/guestAddresses';
import {INITIAL_STORES} from '../data/seedData';
import fixtures from './coverage-address-fixtures.json';
import municipal from './municipal-coverage-fixtures.json';

const destinations:Record<string,any> = {
  Cedritos:fixtures[0],Chía:fixtures.find(f=>f.name==='Chia'),
  Cajicá:municipal.find(f=>f.name==='Cajicá'),Cota:municipal.find(f=>f.name==='Cota'),
};
if(Object.values(destinations).some(f=>!f?.coordinates))throw Error('Falta un fixture verificado de ubicación.');
let scenario='Cedritos',calls=0,pending:PositionCallback|undefined;
let update=()=>{};
const point=()=>destinations[scenario] || destinations.Cedritos;
const position=(f=point())=>({coords:{latitude:f.coordinates.lat,longitude:f.coordinates.lng,accuracy:18},timestamp:Date.now()}) as GeolocationPosition;
Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(success:PositionCallback,error:PositionErrorCallback){
  calls++;update();
  if(scenario==='Respuesta pendiente'){pending=success;return;}
  const code:Record<string,number>={'Permiso denegado':1,'Sin señal':2,'Tiempo agotado':3};
  if(code[scenario]){queueMicrotask(()=>error({code:code[scenario]} as GeolocationPositionError));return;}
  const fixture=point();queueMicrotask(()=>success(position(fixture)));
}}});
api.reverseGeocode=async(lat,lng)=>{
  if(scenario==='Geocodificación fallida')return null;
  const f=Object.values(destinations).find(f=>f.coordinates.lat===lat && f.coordinates.lng===lng);
  return f ? {address:f.formattedAddress || f.address,municipality:f.municipality || f.name,locality:f.locality,neighborhood:f.name==='Cedritos'?'Cedritos':undefined} : null;
};
// Read-only delivery quotes continue through the actual BOLT backend on this same test origin.
const memory=new Map<string,string>();
const addressStore=new GuestAddressStore({getItem:k=>memory.get(k)??null,setItem:(k,v)=>{memory.set(k,v)}});

function Review(){
  const [,render]=useState(0),[bookOpen,setBookOpen]=useState(true),[formOpen,setFormOpen]=useState(false),[auto,setAuto]=useState(false);
  const [quote,setQuote]=useState<any>(null),[confirmations,setConfirmations]=useState(0);
  update=()=>render(n=>n+1);
  const book=addressStore.getSnapshot();
  const open=(location:boolean)=>{setAuto(location);setBookOpen(false);setFormOpen(true)};
  const refresh=()=>render(n=>n+1);
  return <div className="p-4 space-y-3 bg-slate-50 min-h-screen">
    <h1 className="font-bold">Simulación de ubicación · BOLT</h1>
    <p>Datos de prueba. No consulta tu ubicación real ni crea pedidos.</p>
    <label>Escenario <select aria-label="Escenario de ubicación" className="border p-2" defaultValue={scenario} onChange={e=>{scenario=e.target.value;refresh()}}>{[...Object.keys(destinations),'Permiso denegado','Sin señal','Tiempo agotado','Respuesta pendiente','Geocodificación fallida'].map(s=><option key={s}>{s}</option>)}</select></label>
    <button className="border p-2" onClick={()=>setBookOpen(true)}>Abrir direcciones</button>
    <button className="border p-2" onClick={()=>{pending?.(position(destinations.Cedritos));pending=undefined;refresh()}}>Resolver ubicación pendiente</button>
    <output className="block" aria-label="Resultado de simulación">Consultas al dispositivo: {calls}. Confirmaciones: {confirmations}. Direcciones guardadas: {book.addresses.length}. Destino confirmado: {book.current?.address || 'Ninguno'}.</output>
    <SavedAddressesModal isOpen={bookOpen} onClose={()=>setBookOpen(false)} addresses={book.addresses} current={book.current} quote={quote} warning="" message="" onAdd={()=>open(false)} onUseCurrentLocation={()=>open(true)} onEdit={()=>open(false)} onUse={id=>{addressStore.select(id);refresh()}} onRemove={id=>{addressStore.remove(id);refresh()}} onDefault={id=>{addressStore.setDefault(id);refresh()}} onSave={(name,def)=>{const r=addressStore.saveCurrent(name,def);refresh();return r.ok}} onContinue={()=>setBookOpen(false)}/>
    <AddressConfirmationModal isOpen={formOpen} requestCurrentLocationOnOpen={auto} onClose={()=>{setFormOpen(false);setBookOpen(true)}} currentAddress="" currentDetails="" stores={INITIAL_STORES} cartItems={[]} products={[]} onConfirmAddress={(address,details,coordinates,q)=>{addressStore.confirm({address,details,coordinates,municipality:q.municipality,locality:q.locality});setQuote(q);setConfirmations(n=>n+1);return true}}/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Review/></React.StrictMode>);
