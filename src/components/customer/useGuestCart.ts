import {useCustomer,guestStorage} from '../../customer/client';
import { useMemo, useState, useSyncExternalStore } from 'react';
import type { Product } from '../../types';
import { GuestCartStore, resolveGuestCart } from '../../lib/guestCart';

export function useGuestCart(catalog: Product[] | null) {
  const {storage}=useCustomer();
  const store=useMemo(()=>new GuestCartStore(storage || guestStorage()),[storage]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const resolved = useMemo(() => resolveGuestCart(snapshot.references, catalog), [snapshot.references, catalog]);
  return { ...resolved, ...snapshot, store };
}
