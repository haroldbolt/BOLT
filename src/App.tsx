import {DriverPanel} from './components/dispatch/DriverPanel';
import {DispatchSimulation} from './components/dispatch/DispatchSimulation';
import {SimulationBanner} from './components/dispatch/DispatchUi';
import { useGuestAddresses } from './components/customer/useGuestAddresses';
import { SavedAddressesModal } from './components/customer/SavedAddressesModal';
import type { AddressDestination, SavedAddress } from './lib/guestAddresses';
import { COVERAGE_NOTICE } from './data/coverageConfig';
import {PresentationProvider} from './components/customer/PresentationContext';
import { saleVariant, salesCatalog } from './lib/variantCommerce';
import { useGuestCart } from './components/customer/useGuestCart';
import { productReference } from './lib/guestCart';
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import { INITIAL_PRODUCTS, INITIAL_STORES, INITIAL_ORDERS } from './data/seedData';
import { api } from './lib/api';
import { pushService } from './lib/notifications';
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
  const [stores, setStores] = useState<Store[]>(INITIAL_STORES);
  const [products, setProducts] = useState<Product[]>(INITIAL_PRODUCTS);
  const [orders, setOrders] = useState<Order[]>(INITIAL_ORDERS);

  // Customer UI state
  const [selectedCategory, setSelectedCategory] = useState<MainCategory>('Todo');
  const [currentTab, setCurrentTab] = useState<CustomerNavTab>('turbo');
  const [searchQuery, setSearchQuery] = useState('');
  const [productFilters, setProductFilters] = useState<ProductFilterState>(INITIAL_FILTER_STATE);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);
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
    const col = wishlistCollections.find(c => c.id === collectionId);
    if (!col || col.items.length === 0) return;

    let addedCount = 0;
    col.items.forEach(item => {
      const prod = products.find(p => p.id === item.productId);
      if (prod) {
        handleAddToCart(prod);
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
  const [cartCatalog, setCartCatalog] = useState<Product[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const catalogRequest = useRef(0);
  const { items: cartItems, unavailable: unavailableCartItems, references: cartReferences, warning: cartStorageWarning, store: guestCart } = useGuestCart(cartCatalog);
  const cartBlockReason = catalogLoading ? 'Actualizando tu carrito con el catálogo vigente…' : catalogError ||
    (unavailableCartItems.length ? 'Revisa las presentaciones que ya no están disponibles antes de continuar.' :
    cartItems.some(item => !Number.isFinite(item.product.price) || item.product.price <= 0) ? 'Hay una presentación con precio pendiente de confirmar.' : '');
  const refreshCatalog = useCallback(async () => {
    const requestId = ++catalogRequest.current;
    setCatalogLoading(true); setCatalogError('');
    try {
      const loaded = await api.getCatalog(undefined, { requireServer: true });
      if (requestId !== catalogRequest.current) return false;
      setProducts(loaded); setCartCatalog(loaded);
      return true;
    } catch {
      if (requestId === catalogRequest.current) setCatalogError('No se pudo actualizar el catálogo. Tus selecciones siguen guardadas; reintenta para validar precio y disponibilidad.');
      return false;
    } finally {
      if (requestId === catalogRequest.current) setCatalogLoading(false);
    }
  }, []);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isOrderHistoryOpen, setIsOrderHistoryOpen] = useState(false);
  const [orderHistoryInitialTab, setOrderHistoryInitialTab] = useState<'history' | 'profile'>('history');
  const [isNotificationCenterOpen, setIsNotificationCenterOpen] = useState(false);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState<number>(() => pushService.getUnreadCount());

  // Delivery Address & Authoritative Delivery Quote context
  const [coverageAlert,setCoverageAlert]=useState(false);
  const addressBook = useGuestAddresses();
  const addressStore = addressBook.store;
  const customerAddress = addressBook.current?.address || '';
  const customerAddressDetails = addressBook.current?.details || '';
  const customerCoordinates = addressBook.current?.coordinates;
  const customerTerritory = useMemo(()=>({municipality:addressBook.current?.municipality,locality:addressBook.current?.locality,neighborhood:addressBook.current?.neighborhood}),[addressBook.current?.municipality,addressBook.current?.locality,addressBook.current?.neighborhood]);
  const [quoteState,setQuoteState]=useState<{quote:DeliveryQuote;revision:number}|null>(null);
  const deliveryQuote=quoteState?.revision===addressBook.selectionRevision ? quoteState.quote : null;
  const setDeliveryQuote=useCallback((quote:DeliveryQuote|null)=>setQuoteState(quote?{quote,revision:addressBook.selectionRevision}:null),[addressBook.selectionRevision]);
  const currentStore=deliveryQuote ? stores.find(s=>s.id===deliveryQuote.assignedStoreId) || null : null;
  const [isAddressBookOpen,setIsAddressBookOpen]=useState(false);
  const [addressBookMessage,setAddressBookMessage]=useState('');
  const [addressDraft,setAddressDraft]=useState<AddressDestination|null>(null);
  const [editingAddress,setEditingAddress]=useState<SavedAddress|null>(null);
  const deliveryRequest=useRef(0);
  const announcedAddress=useRef(-1);
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
        deliveryQuote.effectiveMode === 'PROGRAMADO' ||
        deliveryQuote.autoSwitchedToScheduled ||
        deliveryQuote.recommendedMode === 'PROGRAMADO' ||
        (!deliveryQuote.availableModes.turbo && !deliveryQuote.availableModes.turboDividido && deliveryQuote.availableModes.scheduled);

      if (shouldBeScheduled) {
        setSelectedDeliveryMode('PROGRAMADO');

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

  // Restore references only against a successful, current server catalog response.
  useEffect(() => {
    let cancelled = false;
    void refreshCatalog();
    void Promise.all([api.getStores(), api.getOrders()]).then(([loadedStores, loadedOrders]) => {
      if (cancelled) return;
      if (loadedStores.length) setStores(loadedStores);
      setOrders(loadedOrders);
    }).catch(error => console.error('Error fetching initial app data:', error));
    return () => { cancelled = true; catalogRequest.current++; };
  }, [refreshCatalog]);

  const invalidateDestination = () => {
    ++deliveryRequest.current;
    setDeliveryQuote(null);
    setSelectedScheduledWindow(null);
    setSelectedDeliveryMode('TURBO');
    setCoverageAlert(false);
    setIsScheduledModalOpen(false);
    setIsCheckoutOpen(false);
  };
  // This also handles restoration and changes made in another tab, without touching the cart.
  useEffect(()=>{invalidateDestination()},[addressBook.selectionRevision]);

  useEffect(() => {
    let cancelled = false;
    const seq=++deliveryRequest.current, revision=addressBook.selectionRevision;
    setDeliveryQuote(null);
    if (!customerAddress.trim() || !customerCoordinates || catalogLoading || catalogError || unavailableCartItems.length) return;
    api.getDeliveryQuote({
      destination: {address:customerAddress,details:customerAddressDetails,coordinates:customerCoordinates,...customerTerritory},
      items:cartItems.map(i=>({productId:i.product.id,quantity:i.quantity})),
      requestedMode:selectedDeliveryMode,
      scheduledWindow:selectedDeliveryMode==='PROGRAMADO'?selectedScheduledWindow || undefined:undefined,
    },stores,products).then(q=>{
      if(cancelled || seq!==deliveryRequest.current || revision!==addressStore.getSnapshot().selectionRevision) return;
      setDeliveryQuote(q);
      if(selectedScheduledWindow && !q.scheduledSlots.some(s=>s.slotId===selectedScheduledWindow.slotId && s.date===selectedScheduledWindow.date && !s.cutoffPassed && s.availableCapacity>0)) setSelectedScheduledWindow(null);
      if(announcedAddress.current!==revision) {
        announcedAddress.current=revision;
        setCoverageAlert(q.eligibilityStatus==='OUT_OF_COVERAGE');
      }
    }).catch(()=>{
      if(!cancelled && seq===deliveryRequest.current) setAddressBookMessage('No se pudo validar esta dirección. Vuelve a seleccionarla para reintentar.');
    });
    return ()=>{cancelled=true};
  },[customerAddress,customerAddressDetails,customerCoordinates,customerTerritory,addressBook.selectionRevision,stores,products,cartItems,selectedDeliveryMode,selectedScheduledWindow,catalogLoading,catalogError,unavailableCartItems]);

  const openAddressBook = () => {setAddressBookMessage('');setIsAddressBookOpen(true)};
  const editDeliveryAddress = (saved?:SavedAddress) => {
    setEditingAddress(saved || null);
    setAddressDraft(saved || null);
    setAddressBookMessage('');
    setIsAddressBookOpen(false);
    setIsAddressModalOpen(true);
  };
  const handleConfirmAddress = (address:string,details:string,coordinates:LatLng,q:DeliveryQuote,metadata?:{name:string;isDefault:boolean}) => {
    const destination:AddressDestination={address,details,coordinates,municipality:q.municipality,locality:q.locality,neighborhood:q.destination.neighborhood};
    if(editingAddress) {
      const result=addressStore.update(editingAddress.id,destination,metadata?.name || editingAddress.name,metadata?.isDefault ?? editingAddress.isDefault);
      setAddressBookMessage(result.message);
      if(!result.ok)return false;
    } else {
      invalidateDestination();
      addressStore.confirm(destination);
      setAddressBookMessage('Dirección confirmada. Puedes guardarla con un nombre o continuar.');
    }
    setIsAddressBookOpen(true);
    return true;
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
    return cartReferences.reduce((acc, item) => acc + item.quantity, 0);
  }, [cartReferences]);

  const handleAddToCart = (product: Product) => {
    if (!cartCatalog || catalogLoading || catalogError) return;
    if (!product.variantId && (product.presentaciones?.length || 0)>1) { setDetailProduct(product); return; }
    if(!product.variantId) product = saleVariant(product);
    if(!Number.isFinite(product.price) || product.price<=0) return;
    setDeliveryQuote(null);
    guestCart.add(product);
  };

  const handleUpdateQuantity = (product: Product, newQuantity: number) => {
    setDeliveryQuote(null);
    guestCart.setQuantity(productReference(product, newQuantity), Math.max(0, newQuantity));
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
    const current = salesCatalog(cartCatalog || []);
    for (const item of order.items) {
      const product = current.find(p => p.id === item.productId);
      // Missing historical references remain visible as unavailable; never substitute a variant.
      guestCart.add(product || ({ id: item.productId } as Product), item.quantity);
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

    // 4. Para clientes muestra productos ACTIVE
    list = list.filter(p => !p.status || p.status === 'ACTIVE');

    // 3. Organiza los productos según bodegaIds. Una lista vacía no significa disponibilidad en todas las bodegas.
    if (currentStore) {
      const targetGid = currentStore.shopifyLocationGid;
      list = list.filter(p => {
        if (!p.bodegaIds) return true;
        if (p.bodegaIds.length === 0) return false; // Una lista vacía no significa disponibilidad en todas las bodegas
        return (targetGid && p.bodegaIds.includes(targetGid)) || p.bodegaIds.includes(currentStore.id);
      });
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.activeIngredient && p.activeIngredient.toLowerCase().includes(q)) ||
        (p.tags && p.tags.some(t => t.toLowerCase().includes(q)))
      );
    } else if (currentTab === 'favoritos') {
      list = list.filter(p => !!favorites[p.id]);
    } else if (currentTab === 'ofertas') {
      list = list.filter(p => (p.discountPercent || 0) > 0);
    } else if (selectedCategory !== 'Todo') {
      list = list.filter(p => p.category === selectedCategory || (p.pharmacySubcategory as any) === selectedCategory);
    }
    return list;
  }, [products, currentStore, searchQuery, currentTab, selectedCategory, favorites]);

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

  // Keep image-heavy catalogs responsive without hiding products from search or counts.
  const [visibleProductCount,setVisibleProductCount]=useState(48);
  useEffect(()=>setVisibleProductCount(48),[searchQuery,selectedCategory,currentTab,productFilters,currentStore?.id]);

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
  if(currentPath==='/conductor')return <DriverPanel/>;
  if(currentPath==='/simulacion')return <DispatchSimulation/>;
  if(currentPath.startsWith('/simulacion/cliente/'))return <><SimulationBanner/><OrderTracking orderId={currentPath.split('/')[3]} guestOnly onBack={()=>window.location.assign('/simulacion')}/><PushNotificationBanner onNavigateToOrder={id=>window.location.assign("/simulacion/cliente/"+id)}/></>;

  if (currentPath.startsWith('/pedido') && trackingOrderId) {
    return (
      <>
      <OrderTracking
        orderId={trackingOrderId}
        onBack={() => navigateTo('/')}
      />
      <PushNotificationBanner onNavigateToOrder={(id)=>navigateTo('/pedido/'+id)} />
      </>
    );
  }

  // -------------------------------------------------------------
  // RENDER: OPERATIONS DASHBOARD & CATALOG ADMIN (/operacion, /admin)
  // -------------------------------------------------------------
  if (currentPath === '/operacion' || currentPath === '/admin') {
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
    <PresentationProvider deliveryQuote={deliveryQuote} quantities={cartQuantities} request={{destination:{address:customerAddress,details:customerAddressDetails,coordinates:customerCoordinates,...customerTerritory},items:cartItems.map(i=>({productId:i.product.id,quantity:i.quantity})),requestedMode:selectedDeliveryMode,scheduledWindow:selectedDeliveryMode==='PROGRAMADO' ? selectedScheduledWindow || undefined : undefined}}>
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
        onSelectStore={openAddressBook}
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
        onOpenAddressModal={openAddressBook}
        onOpenSavedAddresses={openAddressBook}
        savedAddressCount={addressBook.addresses.length}
        activeAddressName={addressBook.addresses.find(a=>a.id===addressBook.current?.savedId)?.name}
        canSaveAddress={!!addressBook.current && !addressBook.current.savedId && !!deliveryQuote && deliveryQuote.eligibilityStatus!=='ADDRESS_NEEDS_CONFIRMATION'}
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
      {(cartStorageWarning || catalogError || (catalogLoading && cartCount > 0) || unavailableCartItems.length > 0) && (
        <div role="status" className="mx-3 my-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          {cartStorageWarning && <p>{cartStorageWarning}</p>}
          {(catalogError || (catalogLoading && cartCount > 0) || unavailableCartItems.length > 0) && <p>{cartBlockReason}</p>}
          {catalogError && <button className="mt-2 font-bold underline" onClick={() => void refreshCatalog()}>Reintentar carga del catálogo</button>}
          {unavailableCartItems.length > 0 && <button className="mt-2 font-bold underline" onClick={() => setIsCartOpen(true)}>Revisar carrito</button>}
        </div>
      )}
      <main className="max-w-7xl mx-auto px-3 sm:px-4 pl-safe pr-safe pt-3 space-y-4 pb-28 sm:pb-32">
        {/* If user selected Listas de Deseos tab */}
        {currentTab === 'deseos' ? (
          <WishlistView
            collections={wishlistCollections}
            products={products}
            selectedStoreId={currentStore?.id || ''}
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
            selectedStoreId={currentStore?.id || ''}
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
                    {filteredProducts.slice(0,visibleProductCount).map(prod => (
                      <ProductCard
                        key={prod.id}
                        product={prod}
                        quantityInCart={cartQuantities[prod.id] || 0}
                        onAddToCart={handleAddToCart}
                        onUpdateQuantity={handleUpdateQuantity}
                        isFavorite={!!favorites[prod.id]}
                        onToggleFavorite={handleToggleFavorite}
                        onOpenDetails={(p) => setDetailProduct(p)}
                        selectedStoreId={currentStore?.id || ''}
                        isCompared={compareProducts.some(p => p.id === prod.id)}
                        onToggleCompare={handleToggleCompare}
                        isInWishlist={wishlistProductIds.has(prod.id)}
                        onOpenSaveToWishlist={handleOpenSaveToWishlist}
                      />
                    ))}
                    {filteredProducts.length > visibleProductCount && <button type="button" onClick={()=>setVisibleProductCount(count=>count+48)} className="col-span-full rounded-xl border border-slate-200 bg-white p-3 font-bold text-sm text-red-700 hover:bg-red-50">Ver más productos ({Math.min(visibleProductCount,filteredProducts.length)} de {filteredProducts.length})</button>}
                  </div>
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
                {lightningDeals.slice(0,12).map(prod => (
                  <div key={prod.id} className="min-w-[170px] sm:min-w-[200px] snap-start">
                    <ProductCard
                      product={prod}
                      quantityInCart={cartQuantities[prod.id] || 0}
                      onAddToCart={handleAddToCart}
                      onUpdateQuantity={handleUpdateQuantity}
                      isFavorite={!!favorites[prod.id]}
                      onToggleFavorite={handleToggleFavorite}
                      onOpenDetails={(p) => setDetailProduct(p)}
                      selectedStoreId={currentStore?.id || ''}
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
                  {favoriteProducts.slice(0,12).map(prod => (
                    <div key={prod.id} className="min-w-[170px] sm:min-w-[200px] snap-start">
                      <ProductCard
                        product={prod}
                        quantityInCart={cartQuantities[prod.id] || 0}
                        onAddToCart={handleAddToCart}
                        onUpdateQuantity={handleUpdateQuantity}
                        isFavorite={!!favorites[prod.id]}
                        onToggleFavorite={handleToggleFavorite}
                        onOpenDetails={(p) => setDetailProduct(p)}
                        selectedStoreId={currentStore?.id || ''}
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
                  {reorderProducts.slice(0,12).map(prod => (
                    <div key={prod.id} className="min-w-[170px] sm:min-w-[200px] snap-start">
                      <ProductCard
                        product={prod}
                        quantityInCart={cartQuantities[prod.id] || 0}
                        onAddToCart={handleAddToCart}
                        onUpdateQuantity={handleUpdateQuantity}
                        isFavorite={!!favorites[prod.id]}
                        onToggleFavorite={handleToggleFavorite}
                        onOpenDetails={(p) => setDetailProduct(p)}
                        selectedStoreId={currentStore?.id || ''}
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
                {recommendedProducts.slice(0,12).map(prod => (
                  <div key={prod.id} className="min-w-[170px] sm:min-w-[200px] snap-start">
                    <ProductCard
                      product={prod}
                      quantityInCart={cartQuantities[prod.id] || 0}
                      onAddToCart={handleAddToCart}
                      onUpdateQuantity={handleUpdateQuantity}
                      isFavorite={!!favorites[prod.id]}
                      onToggleFavorite={handleToggleFavorite}
                      onOpenDetails={(p) => setDetailProduct(p)}
                      selectedStoreId={currentStore?.id || ''}
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
                {newProducts.slice(0,12).map(prod => (
                  <div key={prod.id} className="min-w-[170px] sm:min-w-[200px] snap-start">
                    <ProductCard
                      product={prod}
                      quantityInCart={cartQuantities[prod.id] || 0}
                      onAddToCart={handleAddToCart}
                      onUpdateQuantity={handleUpdateQuantity}
                      isFavorite={!!favorites[prod.id]}
                      onToggleFavorite={handleToggleFavorite}
                      onOpenDetails={(p) => setDetailProduct(p)}
                      selectedStoreId={currentStore?.id || ''}
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
        cartQuantities={cartQuantities}
        product={detailProduct}
        onClose={() => setDetailProduct(null)}
        quantityInCart={detailProduct ? (cartQuantities[detailProduct.id] || 0) : 0}
        onAddToCart={handleAddToCart}
        onUpdateQuantity={handleUpdateQuantity}
        isFavorite={detailProduct ? !!favorites[detailProduct.id] : false}
        onToggleFavorite={handleToggleFavorite}
        selectedStoreId={currentStore?.id || ''}
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
        selectedStoreId={currentStore?.id || ''}
      />

      {/* Compare Limit Toast Notification */}
      {compareLimitWarning && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-xs font-bold px-4 py-2.5 rounded-2xl shadow-xl border border-slate-700 animate-in fade-in duration-200">
          ⚠️ {compareLimitWarning}
        </div>
      )}

      {/* Cart Drawer */}
      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cartItems={cartItems}
        onUpdateQuantity={handleUpdateQuantity}
        onClearCart={guestCart.clear}
        unavailableItems={unavailableCartItems}
        onRemoveUnavailable={ref => guestCart.setQuantity(ref, 0)}
        pendingCount={catalogLoading || catalogError ? cartCount : undefined}
        blockReason={cartBlockReason}
        deliveryQuote={deliveryQuote}
        deliveryMessage={cartItems.length > 0 && deliveryQuote && !deliveryQuote.basketValidated ? deliveryQuote.message : undefined}
        onRefreshCatalog={() => void refreshCatalog()}
        onProceedToCheckout={async () => {
          if (cartBlockReason || !cartItems.length) return;
          if (!customerAddress.trim() || !customerCoordinates) { setIsCartOpen(false); openAddressBook(); return; }
          if (await refreshCatalog()) { setIsCartOpen(false); setIsCheckoutOpen(true); }
        }}
        currentStore={currentStore}
      />

      {/* Checkout Modal */}
      <CheckoutModal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        cartItems={cartItems}
        cartBlockReason={cartBlockReason}
        onRefreshCatalog={() => void refreshCatalog()}
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
          openAddressBook();
        }}
        onOrderSuccess={(orderId) => {
          setIsCheckoutOpen(false);
          guestCart.clear();

          navigateTo(`/pedido/${orderId}`);
        }}
      />

      <SavedAddressesModal isOpen={isAddressBookOpen} onClose={()=>setIsAddressBookOpen(false)}
        addresses={addressBook.addresses} current={addressBook.current} quote={deliveryQuote}
        warning={addressBook.warning} message={addressBookMessage}
        onAdd={()=>editDeliveryAddress()} onEdit={editDeliveryAddress}
        onUse={id=>{invalidateDestination();setAddressBookMessage('');if(!addressStore.select(id))setAddressBookMessage('Esta dirección ya no está guardada. Selecciona otra.')}}
        onRemove={id=>{const active=addressStore.remove(id);if(active){invalidateDestination();setAddressBookMessage('Eliminaste la dirección en uso. Selecciona otra antes de confirmar el pedido.')}else setAddressBookMessage('Dirección eliminada.')}}
        onDefault={id=>{addressStore.setDefault(id);setAddressBookMessage('Dirección predeterminada actualizada. La dirección de esta compra se conserva hasta que elijas otra.')}}
        onSave={(name,isDefault)=>{const result=addressStore.saveCurrent(name,isDefault);setAddressBookMessage(result.message);return result.ok}}
        onContinue={()=>{setIsAddressBookOpen(false);if(deliveryQuote?.territoryInfo?.isCovered && deliveryQuote.effectiveMode==='PROGRAMADO')setIsScheduledModalOpen(true)}}
      />

      {/* Address Confirmation & Coverage Modal */}
      <AddressConfirmationModal
        isOpen={isAddressModalOpen}
        onClose={() => {setIsAddressModalOpen(false);setIsAddressBookOpen(true)}}
        currentAddress={addressDraft?.address || ''}
        currentDetails={addressDraft?.details || ''}
        currentCoordinates={addressDraft?.coordinates}
        currentTerritory={addressDraft || undefined}
        savedAddressOptions={editingAddress || undefined}
        saveError={editingAddress ? addressBookMessage : undefined}
        onConfirmAddress={handleConfirmAddress}
        stores={stores}
        cartItems={cartItems}
        products={products}
      />

      {/* Scheduled Delivery Date and Slot Selection Modal */}
      <ScheduledDeliveryModal
        key={`${customerAddress}|${customerCoordinates?.lat}|${customerCoordinates?.lng}`}
        quote={deliveryQuote}
        loading={!deliveryQuote}
        isOpen={isScheduledModalOpen}
        onClose={() => setIsScheduledModalOpen(false)}
        scheduledSlots={deliveryQuote?.scheduledSlots || []}
        selectedSlotId={selectedScheduledWindow?.slotId}
        onSelectSlot={(slot) => {
          setSelectedScheduledWindow(slot);
          setSelectedDeliveryMode('PROGRAMADO');
          pushService.triggerNotification(
            'Franja seleccionada',
            `${slot.dateLabel}, horario ${slot.displayWindowShort || slot.displayWindow}. Validaremos disponibilidad y costo al confirmar tu pedido.`
          );
        }}
        localityName={deliveryQuote?.locality || deliveryQuote?.municipality || 'Destino pendiente de identificar'}
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
        notice={coverageAlert && deliveryQuote?.eligibilityStatus==='OUT_OF_COVERAGE' ? {...COVERAGE_NOTICE,onDismiss:()=>setCoverageAlert(false),onAction:()=>{setCoverageAlert(false);openAddressBook()}} : undefined}
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
        cartTotalPending={!!cartBlockReason}
        onOpenCart={() => setIsCartOpen(true)}
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
    </PresentationProvider>
  );
}
