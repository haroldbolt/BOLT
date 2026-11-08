import { useEffect, useState, useSyncExternalStore } from 'react';
import { GuestAddressStore, GUEST_ADDRESSES_KEY } from '../../lib/guestAddresses';
export function useGuestAddresses() {
  const [store]=useState(()=>{try{return new GuestAddressStore(window.localStorage)}catch{return new GuestAddressStore()}});
  const snapshot=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
  useEffect(()=>{const refresh=(event:StorageEvent)=>{if(event.key===GUEST_ADDRESSES_KEY)store.reload()};window.addEventListener('storage',refresh);return ()=>window.removeEventListener('storage',refresh)},[store]);
  return {...snapshot,store};
}
