import { useMemo, useState, useSyncExternalStore } from 'react';
import type { Product } from '../../types';
import { GuestCartStore, resolveGuestCart } from '../../lib/guestCart';

export function useGuestCart(catalog: Product[] | null) {
  const [store] = useState(() => {
    try { return new GuestCartStore(window.localStorage); }
    catch { return new GuestCartStore(); }
  });
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const resolved = useMemo(() => resolveGuestCart(snapshot.references, catalog), [snapshot.references, catalog]);
  return { ...resolved, ...snapshot, store };
}
