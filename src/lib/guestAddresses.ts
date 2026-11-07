import { validDestinationCoordinates } from './addressGeography';

export const GUEST_ADDRESSES_KEY = 'bolt_pets_guest_addresses_v1';
export const DEVICE_ADDRESSES_NOTICE = 'Direcciones guardadas en este dispositivo';
export interface AddressDestination {
  address: string;
  details: string;
  coordinates: {lat:number;lng:number};
  municipality?: string;
  locality?: string;
  neighborhood?: string;
}
export interface SavedAddress extends AddressDestination { id:string; name:string; isDefault:boolean }
export interface AddressSelection extends AddressDestination { savedId?:string }
export interface AddressBookData { addresses:SavedAddress[]; current:AddressSelection|null }
export interface AddressBookSnapshot extends AddressBookData { warning:string; selectionRevision:number }
type AddressStorage = Pick<Storage,'getItem'|'setItem'>;
const memoryWarning = 'No se pudieron guardar las direcciones en este navegador. Los cambios durarán solo mientras esta página siga abierta.';
const text = (value:unknown,max=500): value is string => typeof value==='string' && value.trim().length>0 && value.length<=max;

// Whitelist destination fields only: never persist coverage, warehouse, prices, modes or slots.
export function cleanDestination(value:any): AddressDestination | null {
  if(!value || !text(value.address) || !validDestinationCoordinates(value.coordinates) || (value.details!==undefined && (typeof value.details!=='string' || value.details.length>1000))) return null;
  const result:AddressDestination={address:value.address.trim(),details:value.details?.trim() || '',coordinates:{lat:value.coordinates.lat,lng:value.coordinates.lng}};
  for(const key of ['municipality','locality','neighborhood'] as const) if(text(value[key],150)) result[key]=value[key].trim();
  return result;
}
const normalized=(value:string)=>value.trim().replace(/\s+/g,' ').toLocaleLowerCase('es-CO');
export const addressIdentity=(d:AddressDestination)=>JSON.stringify([normalized(d.address),normalized(d.details),d.coordinates.lat,d.coordinates.lng]);
export const selectionIdentity=(d:AddressSelection|null)=>d ? addressIdentity(d) : 'null';

export function readGuestAddresses(storage?:AddressStorage): Omit<AddressBookSnapshot,'selectionRevision'> {
  const empty={addresses:[],current:null};
  if(!storage) return {...empty,warning:memoryWarning};
  try {
    const raw=storage.getItem(GUEST_ADDRESSES_KEY);
    if(raw===null) return {...empty,warning:''};
    const parsed=JSON.parse(raw);
    if(parsed?.version!==1 || !Array.isArray(parsed.addresses) || parsed.addresses.length>1000) throw Error('Invalid address book');
    const addresses:SavedAddress[]=[];let invalid=false;
    for(const row of parsed.addresses) {
      const clean=cleanDestination(row);
      if(!clean || !text(row.id,128) || !text(row.name,60) || addresses.some(a=>a.id===row.id || addressIdentity(a)===addressIdentity(clean))) {invalid=true;continue;}
      addresses.push({...clean,id:row.id,name:row.name.trim(),isDefault:row.isDefault===true && !addresses.some(a=>a.isDefault)});
    }
    let current:AddressSelection|null=null;
    if(parsed.current?.savedId) {
      const saved=addresses.find(a=>a.id===parsed.current.savedId);
      if(saved) current={...cleanDestination(saved)!,savedId:saved.id};else invalid=true;
    } else if(parsed.current!==null && parsed.current!==undefined) {
      current=cleanDestination(parsed.current);if(!current) invalid=true;
    }
    return {addresses,current,warning:invalid?'Algunos datos guardados no son válidos. Revisa tus direcciones.':''};
  } catch {return {...empty,warning:'No se pudieron recuperar las direcciones guardadas. El almacenamiento original se conserva.'};}
}

// Guest-only storage. No admin tokens, customer-account IDs, orders or inventory access.
export class GuestAddressStore {
  private snapshot:AddressBookSnapshot;
  private listeners=new Set<()=>void>();
  constructor(private storage?:AddressStorage) {this.snapshot={...readGuestAddresses(storage),selectionRevision:0};}
  getSnapshot=()=>this.snapshot;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return ()=>{this.listeners.delete(fn)}};
  private latest():AddressBookData {
    try {if(this.storage) {this.storage.getItem(GUEST_ADDRESSES_KEY);const loaded=readGuestAddresses(this.storage);if(!loaded.warning) return loaded;}}catch{}
    return this.snapshot;
  }
  private commit(data:AddressBookData,forceSelection=false) {
    // Naming/default changes do not change the destination or invalidate a valid quote.
    if(data.current && this.snapshot.current && selectionIdentity(data.current)===selectionIdentity(this.snapshot.current)) data={...data,current:{...data.current,coordinates:this.snapshot.current.coordinates}};
    let warning='';
    try {if(!this.storage)throw Error('Storage unavailable');this.storage.setItem(GUEST_ADDRESSES_KEY,JSON.stringify({version:1,addresses:data.addresses,current:data.current}));}catch{warning=memoryWarning;}
    this.snapshot={addresses:data.addresses,current:data.current,warning,selectionRevision:this.snapshot.selectionRevision+(forceSelection || selectionIdentity(data.current)!==selectionIdentity(this.snapshot.current)?1:0)};
    this.listeners.forEach(fn=>fn());
  }
  reload=()=>{
    const data=readGuestAddresses(this.storage);
    if(JSON.stringify({...data,selectionRevision:this.snapshot.selectionRevision})===JSON.stringify(this.snapshot)) return;
    this.snapshot={...data,selectionRevision:this.snapshot.selectionRevision+(selectionIdentity(data.current)!==selectionIdentity(this.snapshot.current)?1:0)};
    this.listeners.forEach(fn=>fn());
  };
  confirm(destination:AddressDestination) {
    const clean=cleanDestination(destination);if(!clean)return false;
    const data=this.latest(),existing=data.addresses.find(a=>addressIdentity(a)===addressIdentity(clean));
    this.commit({...data,current:{...clean,...(existing?{savedId:existing.id}:{})}},true);return true;
  }
  select(id:string) {
    const data=this.latest(),saved=data.addresses.find(a=>a.id===id);if(!saved)return false;
    this.commit({...data,current:{...cleanDestination(saved)!,savedId:id}},true);return true;
  }
  saveCurrent(name:string,isDefault=false):{ok:boolean;message:string} {
    if(!text(name,60))return {ok:false,message:'Escribe un nombre para la dirección (máximo 60 caracteres).'};
    const expected=selectionIdentity(this.snapshot.current);
    const data=this.latest();if(!data.current)return {ok:false,message:'Confirma una dirección antes de guardarla.'};
    if(selectionIdentity(data.current)!==expected){this.reload();return {ok:false,message:'La dirección activa cambió en otra pestaña. Revisa el destino antes de guardarlo.'};}
    const duplicate=data.addresses.find(a=>addressIdentity(a)===addressIdentity(data.current!));
    if(duplicate) {this.commit({...data,current:{...cleanDestination(duplicate)!,savedId:duplicate.id}});return {ok:true,message:`Esta dirección ya está guardada como ${duplicate.name}.`};}
    const saved:SavedAddress={...cleanDestination(data.current)!,id:crypto.randomUUID(),name:name.trim(),isDefault};
    this.commit({addresses:[...data.addresses.map(a=>isDefault?{...a,isDefault:false}:a),saved],current:{...cleanDestination(saved)!,savedId:saved.id}});
    return {ok:true,message:'Dirección guardada.'};
  }
  update(id:string,destination:AddressDestination,name:string,isDefault:boolean) {
    const clean=cleanDestination(destination),data=this.latest();
    if(!clean || !text(name,60))return {ok:false,message:'Revisa los datos y el nombre de la dirección.'};
    if(!data.addresses.some(a=>a.id===id))return {ok:false,message:'Esta dirección ya no está guardada. Actualiza la lista.'};
    if(data.addresses.some(a=>a.id!==id && addressIdentity(a)===addressIdentity(clean)))return {ok:false,message:'Ya tienes guardada esa dirección. Se conservaron ambas entradas sin cambios.'};
    const saved:SavedAddress={...clean,id,name:name.trim(),isDefault};
    this.commit({addresses:data.addresses.map(a=>a.id===id?saved:isDefault?{...a,isDefault:false}:a),current:data.current?.savedId===id?{...clean,savedId:id}:data.current});
    return {ok:true,message:'Dirección actualizada.'};
  }
  remove(id:string) {
    const data=this.latest(),wasActive=data.current?.savedId===id;
    this.commit({addresses:data.addresses.filter(a=>a.id!==id),current:wasActive?null:data.current},wasActive);
    return wasActive;
  }
  setDefault(id:string) {
    const data=this.latest();if(!data.addresses.some(a=>a.id===id))return;
    this.commit({...data,addresses:data.addresses.map(a=>({...a,isDefault:a.id===id}))});
  }
}
