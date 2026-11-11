import {useCustomer,guestStorage} from '../../customer/client';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { GuestAddressStore, GUEST_ADDRESSES_KEY } from '../../lib/guestAddresses';
export function useGuestAddresses() {
  const {storage}=useCustomer();
  const store=useMemo(()=>new GuestAddressStore(storage || guestStorage()),[storage]);
  const snapshot=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
  useEffect(()=>{const refresh=(event:StorageEvent)=>{if(event.key===GUEST_ADDRESSES_KEY)store.reload()};window.addEventListener('storage',refresh);return ()=>window.removeEventListener('storage',refresh)},[store]);
  return {...snapshot,store};
}
