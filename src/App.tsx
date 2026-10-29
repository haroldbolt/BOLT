import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Header } from './components/customer/Header';
import { CampaignBanner } from './components/customer/CampaignBanner';
import { ProductCard } from './components/customer/ProductCard';
import { CategoryCollageCard } from './components/customer/CategoryCollageCard';
import { FarmaciaView } from './components/customer/FarmaciaView';
import { ProductDetailModal } from './components/customer/ProductDetailModal';
import { FloatingNav, CustomerNavTab } from './components/customer/FloatingNav';
import { CartDrawer } from './components/customer/CartDrawer';
import { CheckoutModal } from './components/customer/CheckoutModal';
import { OrderTracking } from './components/customer/OrderTracking';
import { OperationsDashboard } from './components/operations/OperationsDashboard';
import { OrderHistoryModal } from './components/customer/OrderHistoryModal';
import { PushNotificationBanner } from './components/notifications/PushNotificationBanner';
import { NotificationCenterModal } from './components/notifications/NotificationCenterModal';
import { AddressConfirmationModal } from './components/customer/AddressConfirmationModal';
import { SearchFilters, ActiveFilterChips, INITIAL_FILTER_STATE } from './components/catalog/SearchFilters';
import { ProductCompareBar } from './components/customer/ProductCompareBar';
import { ProductCompareModal } from './components/customer/ProductCompareModal';
import { CoachMarkTour } from './components/customer/CoachMarkTour';
import { WishlistView } from './components/customer/WishlistView';
import { SaveToWishlistModal } from './components/customer/SaveToWishlistModal';
import { ScheduledDeliveryModal } from './components/customer/ScheduledDeliveryModal';

import { Product, Store, CartItem, MainCategory, Order, DeliveryMode, ScheduledDeliveryWindow, ProductFilterState, WishlistCollection, WishlistItem } from './types';
import { DeliveryQuote, LatLng } from './lib/deliveryService';
import { INITIAL_ORDERS } from './data/seedData';
import { api } from './lib/api';
import { pushService } from './lib/notifications';
import { getProductPurchaseBlock, getProductSellableQuantity } from './lib/productAvailability';
import { filterCustomerCatalog, reconcileCartForCatalog } from './lib/catalogAvailability';
const UNCONFIRMED_STORE: Store = {
  id: 'UNCONFIRMED', name: 'Por confirmar', address: '', coordinates: { lat: 4.65, lng: -74.10 },
  turboEnabled: false, isActive: false, schedule: '', maxDeliveryRadiusKm: 0, vehicleMaxWeightKg: 25,
};
const INITIAL_WISHLIST_COLLECTIONS: WishlistCollection[] = [
  {
    id: 'col-comida-mensual',
    name: 'Alimento Mensual Max',
    description: 'Dieta regular y concentrado mensual para entrega Turbo',
    icon: '🐶',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: [
      { productId: 'prod-rc-maxi-15k', addedAt: new Date().toISOString(), notes: 'Comprar bulto de 15 kg antes del día 25' },
      { productId: 'prod-proplan-adult-15k', addedAt: new Date().toISOString(), notes: 'Alternativa si no hay Royal Canin' },
    ],
  },
  {
    id: 'col-farmacia-cuidado',
    name: 'Farmacia & Prevención',
    description: 'Antipulgas y desparasitantes trimestrales',
    icon: '💊',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: [
      { productId: 'prod-nexgard-spectra-m', addedAt: new Date().toISOString(), notes: 'Dosis para Max (10 a 20 kg)' },
      { productId: 'prod-bravecto-10-20k', addedAt: new Date().toISOString(), notes: 'Protección para 12 semanas' },
    ],
  },
  {
    id: 'col-snacks-premios',
    name: 'Snacks & Premios',
    description: 'Premios de entrenamiento y golosinas húmedas',
    icon: '🍖',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: [
      { productId: 'prod-churu-pollo-4u', addedAt: new Date().toISOString(), notes: 'Churu favorito para consentir a Luna' },
    ],
  },
];

export default function App() {
  // Navigation / Routing
  const [currentPath, setCurrentPath] = useState<string>(() => window.location.pathname);
  const [trackingOrderId, setTrackingOrderId] = useState<string | null>(() => {
    const match = window.location.pathname.match(/\/pedido\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  });

  // Quota Defense state required by Google Maps skill
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  // App data state
  const [stores, setStores] = useState<Store[]>([]);
  const [currentStore, setCurrentStore] = useState<Store>(UNCONFIRMED_STORE);
  const [confirmedStoreId, setConfirmedStoreId] = useState<string | null>(null);
  const [loadedCatalogStoreId, setLoadedCatalogStoreId] = useState<string | null>(null);
  const [catalogProducts, setProducts] = useState<Product[]>([]);
  const products = useMemo(() => loadedCatalogStoreId === confirmedStoreId
    ? filterCustomerCatalog(catalogProducts, confirmedStoreId) : [], [catalogProducts, confirmedStoreId, loadedCatalogStoreId]);
  const [inventoryStatus, setInventoryStatus] = useState<Awaited<ReturnType<typeof api.getInventoryStatus>> | null>(null);
  const [cartFeedback, setCartFeedback] = useState<string | null>(null);
  const catalogRequestSequence = useRef(0);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>(INITIAL_ORDERS);

  // Customer UI state
  const [selectedCategory, setSelectedCategory] = useState<MainCategory>('Todo');
  const [currentTab, setCurrentTab] = useState<CustomerNavTab>('turbo');
  const [searchQuery, setSearchQuery] = useState('');
  const [productFilters, setProductFilters] = useState<ProductFilterState>(INITIAL_FILTER_STATE);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);
  const [visibleProductCount, setVisibleProductCount] = useState(48);
  const [favorites, setFavorites] = useState<Record<string, boolean>>({
    'prod-nexgard-spectra-m': true,
    'prod-rc-maxi-15k': true,
  });

  // Product comparison state (max 3 products)
  const [compareProducts, setCompareProducts] = useState<Product[]>([]);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [compareLimitWarning, setCompareLimitWarning] = useState<string | null>(null);

  // Wishlist & Custom Collections state
  const [wishlistCollections, setWishlistCollections] = useState<WishlistCollection[]>(() => {
    try {
      const stored = localStorage.getItem('bolt_pets_wishlist_collections');
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Error reading stored wishlist collections:', e);
    }
    return INITIAL_WISHLIST_COLLECTIONS;
  });

  const [saveModalProduct, setSaveModalProduct] = useState<Product | null>(null);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);

  // Sync collections to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('bolt_pets_wishlist_collections', JSON.stringify(wishlistCollections));
    } catch (e) {
      console.warn('Error saving wishlist collections:', e);
    }
  }, [wishlistCollections]);

  // Set of all product IDs currently present in at least one wishlist collection
  const wishlistProductIds = useMemo(() => {
    const set = new Set<string>();
    wishlistCollections.forEach(c => {
      c.items.forEach(i => set.add(i.productId));
    });
    return set;
  }, [wishlistCollections]);

  const totalWishlistItemsCount = useMemo(() => {
    return wishlistProductIds.size;
  }, [wishlistProductIds]);

  const handleOpenSaveToWishlist = (product: Product) => {
    setSaveModalProduct(product);
    setIsSaveModalOpen(true);
  };

  const handleToggleProductInCollection = (collectionId: string, productId: string) => {
    setWishlistCollections(prev => {
      return prev.map(col => {
        if (col.id !== collectionId) return col;
        const exists = col.items.some(i => i.productId === productId);
        let updatedItems: WishlistItem[];
        if (exists) {
          updatedItems = col.items.filter(i => i.productId !== productId);
        } else {
          updatedItems = [...col.items, { productId, addedAt: new Date().toISOString() }];
          const targetProd = products.find(p => p.id === productId);
          pushService.triggerNotification(
            'Guardado en Lista de Deseos',
            `"${targetProd?.name || 'Producto'}" guardado en "${col.name}".`
          );
        }
        return {
          ...col,
          items: updatedItems,
          updatedAt: new Date().toISOString(),
        };
      });
    });
  };

  const handleCreateCollection = (name: string, icon?: string, initialProductId?: string) => {
    const newId = `col-${Date.now().toString(36)}`;
    const newCol: WishlistCollection = {
      id: newId,
      name,
      icon: icon || '📦',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: initialProductId ? [{ productId: initialProductId, addedAt: new Date().toISOString() }] : [],
    };

    setWishlistCollections(prev => [newCol, ...prev]);

    pushService.triggerNotification(
      'Colección Creada',
      `Has creado la lista "${name}".`
    );
  };

  const handleDeleteCollection = (collectionId: string) => {
    const target = wishlistCollections.find(c => c.id === collectionId);
    if (!target) return;
    setWishlistCollections(prev => prev.filter(c => c.id !== collectionId));
    pushService.triggerNotification(
      'Colección Eliminada',
      `Se eliminó la lista "${target.name}".`
    );
  };

  const handleUpdateItemNote = (collectionId: string, productId: string, notes: string) => {
    setWishlistCollections(prev => {
      return prev.map(col => {
        if (col.id !== collectionId) return col;
        return {
          ...col,
          items: col.items.map(item => {
            if (item.productId !== productId) return item;
            return { ...item, notes };
          }),
          updatedAt: new Date().toISOString(),
        };
      });
    });
  };

  const handleMoveCollectionToCart = (collectionId: string) => {
    if (!confirmedStoreId) { setIsAddressModalOpen(true); return; }
    const col = wishlistCollections.find(c => c.id === collectionId);
    if (!col || col.items.length === 0) return;

    let addedCount = 0;
    col.items.forEach(item => {
      const prod = products.find(p => p.id === item.productId);
      if (prod && handleAddToCart(prod)) {
        addedCount++;
      }
    });

    pushService.triggerNotification(
      'Colección añadida al Carrito',
      `Se agregaron ${addedCount} productos de "${col.name}" a tu carrito.`
    );
    setIsCartOpen(true);
  };

  // Cart state
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isOrderHistoryOpen, setIsOrderHistoryOpen] = useState(false);
  const [orderHistoryInitialTab, setOrderHistoryInitialTab] = useState<'history' | 'profile'>('history');
  const [isNotificationCenterOpen, setIsNotificationCenterOpen] = useState(false);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState<number>(() => pushService.getUnreadCount());

  // Delivery Address & Authoritative Delivery Quote context
  const [customerAddress, setCustomerAddress] = useState<string>('');
  const [customerAddressDetails, setCustomerAddressDetails] = useState<string>('');
  const [customerCoordinates, setCustomerCoordinates] = useState<LatLng>({ lat: 4.65, lng: -74.10 });
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [selectedDeliveryMode, setSelectedDeliveryMode] = useState<DeliveryMode>('TURBO');
  const [selectedScheduledWindow, setSelectedScheduledWindow] = useState<ScheduledDeliveryWindow | null>(null);
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [isScheduledModalOpen, setIsScheduledModalOpen] = useState(false);

  // Guided Onboarding Coach Mark Tour state (activates on first visit)
  const [isTourOpen, setIsTourOpen] = useState(false);

  useEffect(() => {
    const tourDone = localStorage.getItem('bolt_pets_tour_completed');
    if (!tourDone) {
      const timer = setTimeout(() => {
        setIsTourOpen(true);
      }, 700);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleDismissTour = () => {
    localStorage.setItem('bolt_pets_tour_completed', 'true');
    setIsTourOpen(false);
  };

  const handleRestartTour = () => {
    setIsTourOpen(true);
  };

  // Sincronizar modalidad con cotización cuando aplica cambio automático a envío programado
  useEffect(() => {
    if (deliveryQuote) {
      const shouldBeScheduled =
        deliveryQuote.autoSwitchedToScheduled ||
        deliveryQuote.recommendedMode === 'PROGRAMADO' ||
        (!deliveryQuote.availableModes.turbo && !deliveryQuote.availableModes.turboDividido && deliveryQuote.availableModes.scheduled);

      if (shouldBeScheduled) {
        setSelectedDeliveryMode('PROGRAMADO');
        if (!selectedScheduledWindow && deliveryQuote.scheduledSlots?.length) {
          const firstValid = deliveryQuote.scheduledSlots.find(s => !s.cutoffPassed);
          if (firstValid) {
            setSelectedScheduledWindow(firstValid);
          }
        }
      } else if (deliveryQuote.recommendedMode) {
        setSelectedDeliveryMode(deliveryQuote.recommendedMode);
      }
    }
  }, [deliveryQuote]);

  // Selected product detail modal
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);

  // Sync path changes
  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
    const match = path.match(/\/pedido\/([a-zA-Z0-9_-]+)/);
    setTrackingOrderId(match ? match[1] : null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const onPopState = () => {
      setCurrentPath(window.location.pathname);
      const match = window.location.pathname.match(/\/pedido\/([a-zA-Z0-9_-]+)/);
      setTrackingOrderId(match ? match[1] : null);
    };
    window.addEventListener('popstate', onPopState);

    // Google Maps Quota Listener
    const onQuotaExceeded = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);

    // Push notification unread count listener
    const unsubscribePush = pushService.subscribe(() => {
      setUnreadNotificationsCount(pushService.getUnreadCount());
    });

    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
      unsubscribePush();
    };
  }, []);

  // Load warehouse metadata only. The customer catalog needs a confirmed address.
  useEffect(() => {
    let active = true;
    const fetchInitial = async () => {
      try {
        const [loadedStores, loadedOrders] = await Promise.all([
          api.getStores(),
          api.getOrders(),
        ]);
        if (!active) return;
        setStores(loadedStores);
        if (loadedOrders.length) setOrders(loadedOrders);
      } catch (e) {
        if (active) setCatalogError('No pudimos consultar las bodegas. Vuelve a cargar la página para intentarlo de nuevo.');
        console.error('Error fetching initial app data:', e);
      }
    };
    fetchInitial();
    return () => { active = false; };
  }, []);

  // Poll lightweight metadata; download the catalog only when its version or warehouse changes.
  useEffect(() => {
    let active = true;
    let inFlight = false;
    const readStatus = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const status = await api.getInventoryStatus();
        if (active) setInventoryStatus(status);
      } catch (e) {
        if (active) setInventoryStatus(previous => ({ ...previous, isStale: true, errorMessage: 'No pudimos verificar la actualización del inventario. Conservamos la última lectura disponible.' }));
      } finally {
        inFlight = false;
      }
    };
    readStatus();
    const interval = window.setInterval(readStatus, 20000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  const inventoryVersion = inventoryStatus?.version ?? inventoryStatus?.fetchedAt ?? inventoryStatus?.lastSuccessfulSync ?? '';
  useEffect(() => {
    const sequence = ++catalogRequestSequence.current;
    if (!confirmedStoreId || currentPath !== '/') return;
    const controller = new AbortController();
    const loadCatalog = async () => {
      try {
        const [catalogResult, storesResult] = await Promise.allSettled([
          api.getCatalog({ storeId: confirmedStoreId, scope: 'customer' }, controller.signal),
          api.getStores(),
        ]);
        if (controller.signal.aborted || sequence !== catalogRequestSequence.current) return;
        if (storesResult.status !== 'fulfilled') throw storesResult.reason;
        const latestStores = storesResult.value;
        const assigned = latestStores.find(store => store.id === confirmedStoreId && store.isActive);
        if (!assigned) {
          setConfirmedStoreId(null);
          setLoadedCatalogStoreId(null);
          setProducts([]);
          setCatalogError('Necesitamos confirmar de nuevo tu dirección para encontrar una bodega disponible.');
          return;
        }
        if (catalogResult.status !== 'fulfilled') throw catalogResult.reason;
        setStores(latestStores);
        setCurrentStore(assigned);
        setProducts(catalogResult.value);
        setLoadedCatalogStoreId(confirmedStoreId);
        setCatalogError(null);
      } catch (error) {
        if (!controller.signal.aborted && sequence === catalogRequestSequence.current) {
          setCatalogError('No pudimos actualizar los productos de tu bodega. Conservamos la última lectura; vuelve a intentarlo.');
        }
      }
    };
    loadCatalog();
    return () => { controller.abort(); };
  }, [confirmedStoreId, inventoryVersion, currentPath]);

  useEffect(() => {
    if (!confirmedStoreId || loadedCatalogStoreId !== confirmedStoreId) return;
    const result = reconcileCartForCatalog(cartItems, catalogProducts, confirmedStoreId);
    if (result.changed) setCartItems(result.items);
    if (result.notices.length) {
      const message = result.notices.join(' ');
      setCartFeedback(message);
      pushService.triggerNotification('Disponibilidad actualizada', message);
    }
  }, [catalogProducts, loadedCatalogStoreId, confirmedStoreId, cartItems]);

  useEffect(() => {
    const byId = new Map(products.map(product => [product.id, product]));
    setCompareProducts(previous => previous.flatMap(product => byId.has(product.id) ? [byId.get(product.id)!] : []));
    setDetailProduct(previous => previous ? byId.get(previous.id) || null : null);
  }, [products]);

  const handleConfirmAddress = (
    newAddress: string,
    newDetails: string,
    newCoords: LatLng,
    newQuote: DeliveryQuote
  ) => {
    setCustomerAddress(newAddress);
    setCustomerAddressDetails(newDetails);
    setCustomerCoordinates(newCoords);
    setDeliveryQuote(newQuote);

    // Automatic store assignment based on quote
    const targetStore = stores.find(s => s.id === newQuote.assignedStoreId && s.isActive);
    if (!targetStore || !(newQuote.availableModes.turbo || newQuote.availableModes.turboDividido || newQuote.availableModes.scheduled)) {
      setConfirmedStoreId(null);
      setCatalogError('No pudimos asignar una bodega para esa dirección. Revisa el punto de entrega.');
      return;
    }
    setCurrentStore(targetStore);
    setConfirmedStoreId(targetStore.id);

    const shouldAutoSwitchToScheduled =
      newQuote.autoSwitchedToScheduled ||
      newQuote.recommendedMode === 'PROGRAMADO' ||
      (!newQuote.availableModes.turbo && !newQuote.availableModes.turboDividido && newQuote.availableModes.scheduled);

    if (shouldAutoSwitchToScheduled) {
      setSelectedDeliveryMode('PROGRAMADO');
      if (newQuote.scheduledSlots && newQuote.scheduledSlots.length > 0) {
        const firstValid = newQuote.scheduledSlots.find(s => !s.cutoffPassed) || newQuote.scheduledSlots[0];
        setSelectedScheduledWindow(firstValid);
      }
      setIsScheduledModalOpen(true);
      pushService.triggerNotification(
        'Envío Programado Seleccionado',
        'Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido'
      );
    } else {
      setSelectedDeliveryMode(newQuote.recommendedMode || 'TURBO');
      pushService.triggerNotification(
        'Ubicación y Sede Confirmadas',
        `Entregaremos en ${newAddress}. Atendido desde ${targetStore.name}.${newQuote.estimatedMinutes ? ` Tiempo estimado: ${newQuote.estimatedMinutes} min.` : ''}`
      );
    }
  };

  // Cart operations
  const cartQuantities = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of cartItems) {
      map[item.product.id] = item.quantity;
    }
    return map;
  }, [cartItems]);

  const cartTotal = useMemo(() => {
    return cartItems.reduce((acc, item) => acc + (item.product.price * item.quantity), 0);
  }, [cartItems]);

  const cartCount = useMemo(() => {
    return cartItems.reduce((acc, item) => acc + item.quantity, 0);
  }, [cartItems]);

  const handleAddToCart = (product: Product, quantity: number = 1): boolean => {
    if (!confirmedStoreId || loadedCatalogStoreId !== confirmedStoreId || inventoryStatus?.isStale || catalogError) {
      setCartFeedback('Confirma tu dirección y espera la revisión de disponibilidad antes de agregar productos.');
      return false;
    }
    const currentProduct = products.find(item => item.id === product.id);
    if (!currentProduct || !Number.isSafeInteger(quantity) || quantity <= 0) return false;
    const blocked = getProductPurchaseBlock(currentProduct);
    const available = getProductSellableQuantity(currentProduct, currentStore.id);
    if (blocked || (cartQuantities[currentProduct.id] || 0) + quantity > available) return false;
    setCartItems(prev => {
      const existing = prev.find(i => i.product.id === currentProduct.id);
      // Recheck against the current cart so simultaneous wishlist additions cannot exceed stock.
      if ((existing?.quantity || 0) + quantity > available) return prev;
      if (existing) {
        return prev.map(i => i.product.id === currentProduct.id ? { product: currentProduct, quantity: i.quantity + quantity } : i);
      }
      return [...prev, { product: currentProduct, quantity }];
    });
    return true;
  };

  const handleUpdateQuantity = (product: Product, newQuantity: number) => {
    if (!Number.isSafeInteger(newQuantity)) return;
    if (newQuantity <= 0) {
      setCartItems(prev => prev.filter(i => i.product.id !== product.id));
    } else {
      const currentProduct = products.find(item => item.id === product.id);
      setCartItems(prev => {
        const existing = prev.find(item => item.product.id === product.id);
        if (!existing) return prev;
        // A customer can always reduce or remove an existing item while a refresh is pending.
        if (newQuantity <= existing.quantity) return prev.map(item => item.product.id === product.id ? { ...item, quantity: newQuantity } : item);
        if (!currentProduct || getProductPurchaseBlock(currentProduct) || newQuantity > getProductSellableQuantity(currentProduct, currentStore.id)) return prev;
        return prev.map(item => item.product.id === product.id ? { product: currentProduct, quantity: newQuantity } : item);
      });
    }
  };

  const handleToggleFavorite = (product: Product) => {
    setFavorites(prev => ({
      ...prev,
      [product.id]: !prev[product.id],
    }));
  };

  const handleToggleCompare = (product: Product) => {
    setCompareProducts(prev => {
      const exists = prev.some(p => p.id === product.id);
      if (exists) {
        return prev.filter(p => p.id !== product.id);
      }
      if (prev.length >= 3) {
        setCompareLimitWarning('Puedes comparar hasta un máximo de 3 productos simultáneamente');
        setTimeout(() => setCompareLimitWarning(null), 3500);
        return prev;
      }
      return [...prev, product];
    });
  };

  const handleRemoveCompare = (productId: string) => {
    setCompareProducts(prev => prev.filter(p => p.id !== productId));
  };

  const handleClearCompare = () => {
    setCompareProducts([]);
  };

  const handleReorder = (order: Order) => {
    if (!confirmedStoreId) { setIsAddressModalOpen(true); return; }
    for (const item of order.items) {
      const prod = products.find(p => p.id === item.productId);
      if (!prod) continue;

      handleAddToCart(prod, item.quantity);
    }
    setIsCartOpen(true);
  };

  // Active customer orders
  const activeOrders = useMemo(() => {
    return orders.filter(o => o.fulfillmentStatus !== 'ENTREGADO' && o.fulfillmentStatus !== 'CANCELADO');
  }, [orders]);

  // Base products matching search query or selected tab/category
  const baseCategoryOrSearchProducts = useMemo(() => {
    let list = [...products];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.presentation.toLowerCase().includes(q) ||
        (p.activeIngredient && p.activeIngredient.toLowerCase().includes(q))
      );
    } else if (currentTab === 'favoritos') {
      list = list.filter(p => !!favorites[p.id]);
    } else if (currentTab === 'ofertas') {
      list = list.filter(p => (p.discountPercent || 0) > 0);
    } else if (selectedCategory !== 'Todo') {
      list = list.filter(p => p.category === selectedCategory || (p.pharmacySubcategory as any) === selectedCategory);
    }
    return list;
  }, [products, searchQuery, currentTab, selectedCategory, favorites]);

  // Apply advanced filters: price range, brands, weight range
  const filteredProducts = useMemo(() => {
    let list = baseCategoryOrSearchProducts;

    // Filter by price range (COP)
    if (productFilters.minPrice !== null) {
      list = list.filter(p => p.price >= (productFilters.minPrice as number));
    }
    if (productFilters.maxPrice !== null) {
      list = list.filter(p => p.price <= (productFilters.maxPrice as number));
    }

    // Filter by specific brands (multi-select)
    if (productFilters.brands.length > 0) {
      const brandSet = new Set(productFilters.brands);
      list = list.filter(p => brandSet.has(p.brand));
    }

    // Filter by weight range (kg)
    if (productFilters.minWeightKg !== null) {
      list = list.filter(p => (p.weightKg || 0) >= (productFilters.minWeightKg as number));
    }
    if (productFilters.maxWeightKg !== null) {
      list = list.filter(p => (p.weightKg || 0) <= (productFilters.maxWeightKg as number));
    }

    return list;
  }, [baseCategoryOrSearchProducts, productFilters]);

  useEffect(() => {
    setVisibleProductCount(48);
  }, [searchQuery, selectedCategory, currentTab, productFilters, currentStore.id]);

  // Rails data
  const lightningDeals = useMemo(() => products.filter(p => p.isLightningDeal || (p.discountPercent || 0) > 10), [products]);
  const favoriteProducts = useMemo(() => products.filter(p => !!favorites[p.id]), [products, favorites]);
  const recommendedProducts = useMemo(() => products.filter(p => p.rating >= 4.8), [products]);
  const newProducts = useMemo(() => products.filter(p => p.isNew || p.category === 'Accesorios'), [products]);
  const reorderProducts = useMemo(() => {
    const previousProductIds = new Set(orders.flatMap(o => o.items.map(i => i.productId)));
    return products.filter(p => previousProductIds.has(p.id));
  }, [orders, products]);

  // -------------------------------------------------------------
  // RENDER: ORDER TRACKING PAGE (/pedido/:orderId)
  // -------------------------------------------------------------
  if (currentPath.startsWith('/pedido') && trackingOrderId) {
    return (
      <OrderTracking
        orderId={trackingOrderId}
        onBack={() => navigateTo('/')}
      />
    );
  }

  // -------------------------------------------------------------
  // RENDER: OPERATIONS DASHBOARD (/operacion)
  // -------------------------------------------------------------
  if (currentPath === '/operacion') {
    return (
      <OperationsDashboard
        onBackToCustomer={() => navigateTo('/')}
        onViewOrderTracking={(orderId) => navigateTo(`/pedido/${orderId}`)}
      />
    );
  }

  // -------------------------------------------------------------
  // RENDER: MAIN CUSTOMER SHOPPING EXPERIENCE (/)
  // -------------------------------------------------------------
  return (
    <div className="min-h-screen bg-[#F8F9FA] text-slate-900 pb-28">
      {/* Google Maps Quota Defense Banner as required by GMP skill */}
      {quotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* Header */}
      <Header
        currentStore={currentStore}
        allStores={stores}
        onSelectStore={() => setIsAddressModalOpen(true)}
        addressConfirmed={!!confirmedStoreId}
        selectedCategory={selectedCategory}
        onSelectCategory={(cat) => {
          setSelectedCategory(cat);
          setSearchQuery('');
          if (cat === 'Farmacia') {
            setCurrentTab('turbo');
          }
        }}
        searchQuery={searchQuery}
        onSearchChange={(q) => setSearchQuery(q)}
        activeOrdersCount={activeOrders.length}
        onOpenActiveOrders={() => {
          if (activeOrders.length > 0) {
            navigateTo(`/pedido/${activeOrders[0].id}`);
          }
        }}
        onNavigateToOperacion={() => navigateTo('/operacion')}
        onOpenOrderHistory={() => {
          setOrderHistoryInitialTab('history');
          setIsOrderHistoryOpen(true);
        }}
        onOpenProfile={() => {
          setOrderHistoryInitialTab('profile');
          setIsOrderHistoryOpen(true);
        }}
        onOpenNotifications={() => setIsNotificationCenterOpen(true)}
        unreadNotificationsCount={unreadNotificationsCount}
        totalOrdersCount={orders.length}
        customerAddress={customerAddress}
        customerAddressDetails={customerAddressDetails}
        deliveryQuote={deliveryQuote}
        onOpenAddressModal={() => setIsAddressModalOpen(true)}
        selectedDeliveryMode={selectedDeliveryMode}
        selectedScheduledWindow={selectedScheduledWindow}
        onOpenScheduledModal={() => setIsScheduledModalOpen(true)}
        onOpenTour={handleRestartTour}
        onOpenWishlist={() => {
          setCurrentTab('deseos');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        wishlistCollectionsCount={wishlistCollections.length}
      />

      {/* Main Content Container */}
      <main className="max-w-7xl mx-auto px-3 sm:px-4 pl-safe pr-safe pt-3 space-y-4 pb-28 sm:pb-32">
        {!confirmedStoreId && <button onClick={() => setIsAddressModalOpen(true)} className="bg-white rounded-3xl p-4 text-sm text-slate-600 border border-slate-100 w-full text-left">Confirma tu dirección para ver los productos disponibles para tu entrega.</button>}
        {!!confirmedStoreId && loadedCatalogStoreId !== confirmedStoreId && !catalogError && <p role="status" className="bg-white rounded-3xl p-4 text-sm text-slate-600 border border-slate-100">Consultando los productos disponibles para tu dirección...</p>}
        {catalogError && <p role="alert" className="bg-white rounded-3xl p-4 text-sm text-slate-600 border border-slate-100">{catalogError}</p>}
        {inventoryStatus?.isStale && <p role="status" className="bg-white rounded-3xl p-4 text-sm text-slate-600 border border-slate-100">{inventoryStatus.errorMessage || 'La última lectura del inventario está pendiente de actualización.'}</p>}
        {cartFeedback && <div role="status" className="bg-white rounded-3xl p-4 text-sm text-slate-600 border border-slate-100">{cartFeedback}<button className="ml-3 text-xs font-bold text-red-600" onClick={() => setCartFeedback(null)}>Cerrar</button></div>}
        {/* If user selected Listas de Deseos tab */}
        {currentTab === 'deseos' ? (
          <WishlistView
            collections={wishlistCollections}
            products={products}
            selectedStoreId={currentStore.id}
            cartQuantities={cartQuantities}
            onAddToCart={handleAddToCart}
            onAddCollectionToCart={handleMoveCollectionToCart}
            onRemoveItemFromCollection={handleToggleProductInCollection}
            onUpdateItemNote={handleUpdateItemNote}
            onCreateCollection={handleCreateCollection}
            onDeleteCollection={handleDeleteCollection}
            onOpenProductDetails={(p) => setDetailProduct(p)}
            onNavigateToCatalog={() => {
              setCurrentTab('turbo');
              setSelectedCategory('Todo');
            }}
          />
        ) : selectedCategory === 'Farmacia' ? (
          <FarmaciaView
            products={products}
            selectedStoreId={currentStore.id}
            cartQuantities={cartQuantities}
            onAddToCart={handleAddToCart}
            onUpdateQuantity={handleUpdateQuantity}
            favorites={favorites}
            onToggleFavorite={handleToggleFavorite}
            onOpenDetails={(p) => setDetailProduct(p)}
            onBackToHome={() => setSelectedCategory('Todo')}
            compareProducts={compareProducts}
            onToggleCompare={handleToggleCompare}
            wishlistProductIds={wishlistProductIds}
            onOpenSaveToWishlist={handleOpenSaveToWishlist}
          />
        ) : searchQuery.trim() || currentTab === 'favoritos' || currentTab === 'ofertas' || selectedCategory !== 'Todo' ? (
          /* Filtered Results / Search Results View */
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold text-slate-900">
                {searchQuery.trim()
                  ? `Resultados para "${searchQuery}"`
                  : currentTab === 'favoritos'
                  ? 'Tus Productos Favoritos'
                  : currentTab === 'ofertas'
                  ? 'Ofertas Relámpago y Promociones'
                  : `Categoría: ${selectedCategory}`}
              </h2>
              <span className="text-xs text-slate-500 font-semibold tabular-nums">
                {filteredProducts.length} {filteredProducts.length === 1 ? 'producto' : 'productos'}
              </span>
            </div>

            {/* Barra de chips de filtros activos y disparador móvil */}
            <ActiveFilterChips
              filters={productFilters}
              onChange={setProductFilters}
              onReset={() => setProductFilters(INITIAL_FILTER_STATE)}
              onOpenMobileFilters={() => setIsMobileFiltersOpen(true)}
              totalFilteredCount={filteredProducts.length}
            />

            {/* Distribución responsive: Barra lateral izquierda en escritorio + Cuadrícula de productos */}
            <div className="flex items-start gap-5">
              <SearchFilters
                filters={productFilters}
                onChange={setProductFilters}
                onReset={() => setProductFilters(INITIAL_FILTER_STATE)}
                products={baseCategoryOrSearchProducts}
                totalFilteredCount={filteredProducts.length}
                isMobileModalOpen={isMobileFiltersOpen}
                onCloseMobileModal={() => setIsMobileFiltersOpen(false)}
              />

              <div className="flex-1 min-w-0">
                {filteredProducts.length === 0 ? (
                  <div className="bg-white rounded-3xl p-8 text-center text-slate-500 border border-slate-100 space-y-3">
                    <p className="font-bold text-sm text-slate-700">No encontramos productos coincidentes con los filtros seleccionados</p>
                    <p className="text-xs text-slate-400">Prueba ajustando el rango de precio, deseleccionando alguna marca o ampliando el rango de peso.</p>
                    <button
                      type="button"
                      onClick={() => setProductFilters(INITIAL_FILTER_STATE)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
                    >
                      Restablecer filtros
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {filteredProducts.slice(0, visibleProductCount).map(prod => (
                      <ProductCard
                        key={prod.id}
                        product={prod}
                        quantityInCart={cartQuantities[prod.id] || 0}
                        onAddToCart={handleAddToCart}
                        onUpdateQuantity={handleUpdateQuantity}
                        isFavorite={!!favorites[prod.id]}
                        onToggleFavorite={handleToggleFavorite}
                        onOpenDetails={(p) => setDetailProduct(p)}
                        selectedStoreId={currentStore.id}
                        isCompared={compareProducts.some(p => p.id === prod.id)}
                        onToggleCompare={handleToggleCompare}
                        isInWishlist={wishlistProductIds.has(prod.id)}
                        onOpenSaveToWishlist={handleOpenSaveToWishlist}
                      />
                    ))}
                  </div>
                )}
                {filteredProducts.length > visibleProductCount && (
                  <button type="button" onClick={() => setVisibleProductCount(count => count + 48)} className="mt-4 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition">
                    Ver más productos ({visibleProductCount} de {filteredProducts.length})
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : currentTab === 'categorias' ? (
          /* Categorías Tab View */
          <div className="space-y-4">
            <h2 className="text-lg font-black text-slate-900">Todas las Categorías</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              <CategoryCollageCard
                title="Farmacia Veterinaria"
                category="Farmacia"
                count={products.filter(p => p.category === 'Farmacia' || p.category === 'Antipulgas').length}
                products={products.filter(p => p.category === 'Farmacia' || p.category === 'Antipulgas')}
                onSelectCategory={(cat) => setSelectedCategory(cat)}
                isSpecial={true}
              />
              <CategoryCollageCard
                title="Alimentos Premium"
                category="Alimentos"
                count={products.filter(p => p.category === 'Alimentos').length}
                products={products.filter(p => p.category === 'Alimentos')}
                onSelectCategory={(cat) => setSelectedCategory(cat)}
              />
              <CategoryCollageCard
                title="Arenas Sanitarias"
                category="Arenas"
                count={products.filter(p => p.category === 'Arenas').length}
                products={products.filter(p => p.category === 'Arenas')}
                onSelectCategory={(cat) => setSelectedCategory(cat)}
              />
              <CategoryCollageCard
                title="Snacks & Golosinas"
                category="Snacks"
                count={products.filter(p => p.category === 'Snacks').length}
                products={products.filter(p => p.category === 'Snacks')}
                onSelectCategory={(cat) => setSelectedCategory(cat)}
              />
              <CategoryCollageCard
                title="Higiene & Cuidado"
                category="Higiene"
                count={products.filter(p => p.category === 'Higiene').length}
                products={products.filter(p => p.category === 'Higiene')}
                onSelectCategory={(cat) => setSelectedCategory(cat)}
              />
              <CategoryCollageCard
                title="Accesorios & Paseo"
                category="Accesorios"
                count={products.filter(p => p.category === 'Accesorios').length}
                products={products.filter(p => p.category === 'Accesorios')}
                onSelectCategory={(cat) => setSelectedCategory(cat)}
              />
            </div>
          </div>
        ) : (
          /* Turbo Home Default Feed with Horizontal Rails */
          <div className="min-[669px]:flex min-[669px]:items-start gap-5">
            {/* Panel izquierdo en iPhone Duo desplegado (>= 669px / 951px) */}
            <aside className="hidden min-[669px]:block w-60 lg:w-72 shrink-0 self-start sticky top-24 space-y-3.5">
              {/* Selector Rápido de Categorías */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2.5">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <h3 className="font-extrabold text-xs text-slate-900 uppercase tracking-wider">
                    Categorías
                  </h3>
                  <button
                    onClick={() => setCurrentTab('categorias')}
                    className="text-[11px] text-red-600 font-bold hover:underline cursor-pointer"
                  >
                    Ver todas
                  </button>
                </div>
                <div className="space-y-1">
                  {[
                    { cat: 'Farmacia', label: 'Farmacia Veterinaria', icon: '💊', count: products.filter(p => p.category === 'Farmacia' || p.category === 'Antipulgas').length },
                    { cat: 'Alimentos', label: 'Alimentos Premium', icon: '🍖', count: products.filter(p => p.category === 'Alimentos').length },
                    { cat: 'Arenas', label: 'Arenas Sanitarias', icon: '📦', count: products.filter(p => p.category === 'Arenas').length },
                    { cat: 'Snacks', label: 'Snacks & Churu', icon: '🦴', count: products.filter(p => p.category === 'Snacks').length },
                    { cat: 'Higiene', label: 'Higiene & Cuidado', icon: '🛁', count: products.filter(p => p.category === 'Higiene').length },
                    { cat: 'Accesorios', label: 'Accesorios & Paseo', icon: '🦮', count: products.filter(p => p.category === 'Accesorios').length },
                  ].map(item => (
                    <button
                      key={item.cat}
                      onClick={() => setSelectedCategory(item.cat as MainCategory)}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs font-semibold text-slate-700 hover:bg-red-50 hover:text-red-700 transition cursor-pointer text-left"
                    >
                      <span className="flex items-center gap-2 truncate">
                        <span>{item.icon}</span>
                        <span className="truncate">{item.label}</span>
                      </span>
                      <span className="text-[10px] bg-slate-100 text-slate-500 font-bold px-1.5 py-0.5 rounded-md shrink-0">
                        {item.count}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Filtros avanzados en barra lateral */}
              <SearchFilters
                filters={productFilters}
                onChange={setProductFilters}
                onReset={() => setProductFilters(INITIAL_FILTER_STATE)}
                products={products}
                totalFilteredCount={filteredProducts.length}
                isMobileModalOpen={isMobileFiltersOpen}
                onCloseMobileModal={() => setIsMobileFiltersOpen(false)}
              />
            </aside>

            {/* Panel derecho: Banner, categorías en tarjetas y rails de productos */}
            <div className="flex-1 min-w-0 space-y-4">
              {/* Promotional Campaign Banner */}
              <CampaignBanner onSelectCategory={(cat) => setSelectedCategory(cat)} />

            {/* Category Cards Collage Grid matching Rappi Turbo IMG_2743 */}
            <div className="space-y-2.5 pt-2">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-black text-slate-900 tracking-tight">
                  Encuentra todo en Bolt Pets
                </h3>
                <button
                  onClick={() => setCurrentTab('categorias')}
                  className="text-xs text-red-600 font-extrabold hover:underline"
                >
                  Ver todas
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <CategoryCollageCard
                  title="Farmacia Veterinaria"
                  category="Farmacia"
                  count={products.filter(p => p.category === 'Farmacia' || p.category === 'Antipulgas').length}
                  products={products.filter(p => p.category === 'Farmacia' || p.category === 'Antipulgas')}
                  onSelectCategory={(cat) => setSelectedCategory(cat)}
                  isSpecial={true}
                />
                <CategoryCollageCard
                  title="Alimentos Perro & Gato"
                  category="Alimentos"
                  count={products.filter(p => p.category === 'Alimentos').length}
                  products={products.filter(p => p.category === 'Alimentos')}
                  onSelectCategory={(cat) => setSelectedCategory(cat)}
                />
                <CategoryCollageCard
                  title="Arenas Sanitarias"
                  category="Arenas"
                  count={products.filter(p => p.category === 'Arenas').length}
                  products={products.filter(p => p.category === 'Arenas')}
                  onSelectCategory={(cat) => setSelectedCategory(cat)}
                />
                <CategoryCollageCard
                  title="Snacks & Churu"
                  category="Snacks"
                  count={products.filter(p => p.category === 'Snacks').length}
                  products={products.filter(p => p.category === 'Snacks')}
                  onSelectCategory={(cat) => setSelectedCategory(cat)}
                />
              </div>
            </div>

            {/* Rail 1: Ofertas Relámpago */}
            <div className="space-y-2.5 pt-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-amber-500 font-black">⚡</span>
                  <h3 className="text-base font-black text-slate-900 tracking-tight">
                    Ofertas Relámpago
                  </h3>
                </div>
                <button
                  onClick={() => setCurrentTab('ofertas')}
                  className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1 rounded-full font-bold transition"
                >
                  Ver más
                </button>
              </div>

              <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2 snap-x">
                {lightningDeals.slice(0, 48).map(prod => (
                  <div key={prod.id} className="min-w-[170px] sm:min-w-[200px] snap-start">
                    <ProductCard
                      product={prod}
                      quantityInCart={cartQuantities[prod.id] || 0}
                      onAddToCart={handleAddToCart}
                      onUpdateQuantity={handleUpdateQuantity}
                      isFavorite={!!favorites[prod.id]}
                      onToggleFavorite={handleToggleFavorite}
                      onOpenDetails={(p) => setDetailProduct(p)}
                      selectedStoreId={currentStore.id}
                      isCompared={compareProducts.some(p => p.id === prod.id)}
                      onToggleCompare={handleToggleCompare}
                      isInWishlist={wishlistProductIds.has(prod.id)}
                      onOpenSaveToWishlist={handleOpenSaveToWishlist}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Rail 2: Favoritos */}
            {favoriteProducts.length > 0 && (
              <div className="space-y-2.5 pt-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-red-600 font-black">♥</span>
                    <h3 className="text-base font-black text-slate-900 tracking-tight">
                      Tus Favoritos
                    </h3>
                  </div>
                  <button
                    onClick={() => setCurrentTab('favoritos')}
                    className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1 rounded-full font-bold transition"
                  >
                    Ver más
                  </button>
                </div>

                <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2 snap-x">
                  {favoriteProducts.slice(0, 48).map(prod => (
                    <div key={prod.id} className="min-w-[170px] sm:min-w-[200px] snap-start">
                      <ProductCard
                        product={prod}
                        quantityInCart={cartQuantities[prod.id] || 0}
                        onAddToCart={handleAddToCart}
                        onUpdateQuantity={handleUpdateQuantity}
                        isFavorite={!!favorites[prod.id]}
                        onToggleFavorite={handleToggleFavorite}
                        onOpenDetails={(p) => setDetailProduct(p)}
                        selectedStoreId={currentStore.id}
                        isCompared={compareProducts.some(p => p.id === prod.id)}
                        onToggleCompare={handleToggleCompare}
                        isInWishlist={wishlistProductIds.has(prod.id)}
                        onOpenSaveToWishlist={handleOpenSaveToWishlist}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Rail 3: Compra de nuevo (Only when user has previous purchases) */}
            {reorderProducts.length > 0 && (
              <div className="space-y-2.5 pt-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-red-600 font-black">↺</span>
                    <h3 className="text-base font-black text-slate-900 tracking-tight">
                      Compra de nuevo
                    </h3>
                  </div>
                  <button
                    onClick={() => {
                      setOrderHistoryInitialTab('history');
                      setIsOrderHistoryOpen(true);
                    }}
                    className="text-xs bg-red-50 hover:bg-red-100 text-red-700 px-3 py-1 rounded-full font-bold transition flex items-center gap-1"
                  >
                    <span>Ver historial</span>
                    <span>➔</span>
                  </button>
                </div>

                <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2 snap-x">
                  {reorderProducts.slice(0, 48).map(prod => (
                    <div key={prod.id} className="min-w-[170px] sm:min-w-[200px] snap-start">
                      <ProductCard
                        product={prod}
                        quantityInCart={cartQuantities[prod.id] || 0}
                        onAddToCart={handleAddToCart}
                        onUpdateQuantity={handleUpdateQuantity}
                        isFavorite={!!favorites[prod.id]}
                        onToggleFavorite={handleToggleFavorite}
                        onOpenDetails={(p) => setDetailProduct(p)}
                        selectedStoreId={currentStore.id}
                        isCompared={compareProducts.some(p => p.id === prod.id)}
                        onToggleCompare={handleToggleCompare}
                        isInWishlist={wishlistProductIds.has(prod.id)}
                        onOpenSaveToWishlist={handleOpenSaveToWishlist}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Rail 4: Recomendados para ti */}
            <div className="space-y-2.5 pt-2">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-black text-slate-900 tracking-tight">
                  Recomendados para ti
                </h3>
                <button
                  onClick={() => setSelectedCategory('Alimentos')}
                  className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1 rounded-full font-bold transition"
                >
                  Ver más
                </button>
              </div>

              <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2 snap-x">
                {recommendedProducts.slice(0, 48).map(prod => (
                  <div key={prod.id} className="min-w-[170px] sm:min-w-[200px] snap-start">
                    <ProductCard
                      product={prod}
                      quantityInCart={cartQuantities[prod.id] || 0}
                      onAddToCart={handleAddToCart}
                      onUpdateQuantity={handleUpdateQuantity}
                      isFavorite={!!favorites[prod.id]}
                      onToggleFavorite={handleToggleFavorite}
                      onOpenDetails={(p) => setDetailProduct(p)}
                      selectedStoreId={currentStore.id}
                      isCompared={compareProducts.some(p => p.id === prod.id)}
                      onToggleCompare={handleToggleCompare}
                      isInWishlist={wishlistProductIds.has(prod.id)}
                      onOpenSaveToWishlist={handleOpenSaveToWishlist}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Rail 4: Novedades */}
            <div className="space-y-2.5 pt-2">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-black text-slate-900 tracking-tight">
                  Novedades en Bolt Pets
                </h3>
                <button
                  onClick={() => setSelectedCategory('Accesorios')}
                  className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1 rounded-full font-bold transition"
                >
                  Ver más
                </button>
              </div>

              <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2 snap-x">
                {newProducts.slice(0, 48).map(prod => (
                  <div key={prod.id} className="min-w-[170px] sm:min-w-[200px] snap-start">
                    <ProductCard
                      product={prod}
                      quantityInCart={cartQuantities[prod.id] || 0}
                      onAddToCart={handleAddToCart}
                      onUpdateQuantity={handleUpdateQuantity}
                      isFavorite={!!favorites[prod.id]}
                      onToggleFavorite={handleToggleFavorite}
                      onOpenDetails={(p) => setDetailProduct(p)}
                      selectedStoreId={currentStore.id}
                      isCompared={compareProducts.some(p => p.id === prod.id)}
                      onToggleCompare={handleToggleCompare}
                      isInWishlist={wishlistProductIds.has(prod.id)}
                      onOpenSaveToWishlist={handleOpenSaveToWishlist}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      </main>

      {/* Product Detail Modal */}
      <ProductDetailModal
        product={detailProduct}
        onClose={() => setDetailProduct(null)}
        quantityInCart={detailProduct ? (cartQuantities[detailProduct.id] || 0) : 0}
        onAddToCart={handleAddToCart}
        onUpdateQuantity={handleUpdateQuantity}
        isFavorite={detailProduct ? !!favorites[detailProduct.id] : false}
        onToggleFavorite={handleToggleFavorite}
        selectedStoreId={currentStore.id}
        isCompared={detailProduct ? compareProducts.some(p => p.id === detailProduct.id) : false}
        onToggleCompare={handleToggleCompare}
        isInWishlist={detailProduct ? wishlistProductIds.has(detailProduct.id) : false}
        onOpenSaveToWishlist={handleOpenSaveToWishlist}
      />

      {/* Product Compare Floating Dock */}
      <ProductCompareBar
        compareProducts={compareProducts}
        onRemoveProduct={handleRemoveCompare}
        onClearAll={handleClearCompare}
        onOpenModal={() => setIsCompareModalOpen(true)}
      />

      {/* Product Compare Matrix Modal */}
      <ProductCompareModal
        isOpen={isCompareModalOpen}
        onClose={() => setIsCompareModalOpen(false)}
        compareProducts={compareProducts}
        onRemoveProduct={handleRemoveCompare}
        onClearAll={handleClearCompare}
        cartQuantities={cartQuantities}
        onAddToCart={handleAddToCart}
        onUpdateQuantity={handleUpdateQuantity}
        selectedStoreId={currentStore.id}
      />

      {/* Compare Limit Toast Notification */}
      {compareLimitWarning && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-xs font-bold px-4 py-2.5 rounded-2xl shadow-xl border border-slate-700 animate-in fade-in duration-200">
          ⚠️ {compareLimitWarning}
        </div>
      )}

      {/* Cart Drawer */}
      <CartDrawer
        isOpen={isCartOpen && !!confirmedStoreId}
        onClose={() => setIsCartOpen(false)}
        cartItems={cartItems}
        onUpdateQuantity={handleUpdateQuantity}
        onClearCart={() => setCartItems([])}
        onProceedToCheckout={() => {
          if (!confirmedStoreId || loadedCatalogStoreId !== confirmedStoreId) {
            setIsCartOpen(false);
            setIsAddressModalOpen(true);
            return;
          }
          if (inventoryStatus?.isStale || catalogError) {
            setCartFeedback('Estamos verificando las existencias. Espera una actualización antes de continuar con el pago.');
            return;
          }
          setIsCartOpen(false);
          setIsCheckoutOpen(true);
        }}
        currentStore={currentStore}
      />

      {/* Checkout Modal */}
      <CheckoutModal
        isOpen={isCheckoutOpen && !!confirmedStoreId}
        onClose={() => setIsCheckoutOpen(false)}
        cartItems={cartItems}
        currentStore={currentStore}
        customerAddress={customerAddress}
        customerAddressDetails={customerAddressDetails}
        customerCoordinates={customerCoordinates}
        deliveryQuote={deliveryQuote}
        selectedMode={selectedDeliveryMode}
        onSelectMode={setSelectedDeliveryMode}
        selectedScheduledWindow={selectedScheduledWindow}
        onSelectScheduledWindow={setSelectedScheduledWindow}
        onChangeAddress={() => {
          setIsCheckoutOpen(false);
          setIsAddressModalOpen(true);
        }}
        onOrderSuccess={(orderId) => {
          setIsCheckoutOpen(false);
          setCartItems([]);
          pushService.simulateOrderTransition('#BP-NUEVO', orderId, 'CONFIRMADO');
          navigateTo(`/pedido/${orderId}`);
        }}
      />

      {/* Address Confirmation & Coverage Modal */}
      <AddressConfirmationModal
        isOpen={isAddressModalOpen}
        onClose={() => setIsAddressModalOpen(false)}
        currentAddress={customerAddress}
        currentDetails={customerAddressDetails}
        currentCoordinates={customerCoordinates}
        onConfirmAddress={handleConfirmAddress}
        stores={stores}
        cartItems={cartItems}
        products={products}
      />

      {/* Scheduled Delivery Date and Slot Selection Modal */}
      <ScheduledDeliveryModal
        isOpen={isScheduledModalOpen}
        onClose={() => setIsScheduledModalOpen(false)}
        scheduledSlots={deliveryQuote?.scheduledSlots || []}
        selectedSlotId={selectedScheduledWindow?.slotId}
        onSelectSlot={(slot) => {
          setSelectedScheduledWindow(slot);
          setSelectedDeliveryMode('PROGRAMADO');
          pushService.triggerNotification(
            'Franja de Entrega Confirmada',
            `Tu pedido llegará ${slot.dateLabel}, horario ${slot.displayWindowShort || slot.displayWindow}.`
          );
        }}
        localityName={deliveryQuote?.detectedLocalityName || 'Bogotá'}
        isAutoSwitched={deliveryQuote?.autoSwitchedToScheduled}
        address={customerAddress}
      />

      {/* Order History & Profile Modal */}
      <OrderHistoryModal
        isOpen={isOrderHistoryOpen}
        onClose={() => setIsOrderHistoryOpen(false)}
        orders={orders}
        products={products}
        onViewOrderTracking={(orderId) => navigateTo(`/pedido/${orderId}`)}
        onReorder={handleReorder}
        initialTab={orderHistoryInitialTab}
      />

      {/* Push Notification Real-Time Toast Banner */}
      <PushNotificationBanner
        onNavigateToOrder={(orderId) => navigateTo(`/pedido/${orderId}`)}
      />

      {/* Notification Center Modal */}
      <NotificationCenterModal
        isOpen={isNotificationCenterOpen}
        onClose={() => setIsNotificationCenterOpen(false)}
        onNavigateToOrder={(orderId) => navigateTo(`/pedido/${orderId}`)}
      />

      {/* Floating 5-Destination Bottom Navigation Bar + Circular Search */}
      <FloatingNav
        currentTab={currentTab}
        onSelectTab={(tab) => {
          setCurrentTab(tab);
          setSearchQuery('');
          if (tab === 'turbo') setSelectedCategory('Todo');
        }}
        onTriggerSearch={() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          const searchInput = document.querySelector('input[type="text"]') as HTMLInputElement;
          if (searchInput) searchInput.focus();
        }}
        cartCount={cartCount}
        cartTotal={cartTotal}
        onOpenCart={() => confirmedStoreId ? setIsCartOpen(true) : setIsAddressModalOpen(true)}
        wishlistCount={totalWishlistItemsCount}
      />

      {/* Save to Wishlist Modal */}
      <SaveToWishlistModal
        isOpen={isSaveModalOpen}
        onClose={() => setIsSaveModalOpen(false)}
        product={saveModalProduct}
        collections={wishlistCollections}
        onToggleProductInCollection={handleToggleProductInCollection}
        onCreateCollection={handleCreateCollection}
      />

      {/* Guided Onboarding Coach Mark Tour */}
      <CoachMarkTour
        isOpen={isTourOpen}
        onClose={handleDismissTour}
        onComplete={handleDismissTour}
      />
    </div>
  );
}
