import React, { useState, useEffect, useMemo } from 'react';
import { Header } from './components/customer/Header';
import { BenefitProgressBar } from './components/customer/BenefitProgressBar';
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

import { Product, Store, CartItem, MainCategory, Order } from './types';
import { INITIAL_PRODUCTS, INITIAL_STORES, INITIAL_ORDERS } from './data/seedData';
import { api } from './lib/api';
import { pushService } from './lib/notifications';

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
  const [currentStore, setCurrentStore] = useState<Store>(INITIAL_STORES[0]);
  const [products, setProducts] = useState<Product[]>(INITIAL_PRODUCTS);
  const [orders, setOrders] = useState<Order[]>(INITIAL_ORDERS);

  // Customer UI state
  const [selectedCategory, setSelectedCategory] = useState<MainCategory>('Todo');
  const [currentTab, setCurrentTab] = useState<CustomerNavTab>('turbo');
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState<Record<string, boolean>>({
    'prod-nexgard-spectra-m': true,
    'prod-rc-maxi-15k': true,
  });

  // Cart state
  const [cartItems, setCartItems] = useState<CartItem[]>([
    { product: INITIAL_PRODUCTS[4], quantity: 1 }, // NexGard
    { product: INITIAL_PRODUCTS[8], quantity: 1 }, // Churu
  ]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isOrderHistoryOpen, setIsOrderHistoryOpen] = useState(false);
  const [orderHistoryInitialTab, setOrderHistoryInitialTab] = useState<'history' | 'profile'>('history');
  const [isNotificationCenterOpen, setIsNotificationCenterOpen] = useState(false);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState<number>(() => pushService.getUnreadCount());

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

  // Fetch initial data
  useEffect(() => {
    const fetchInitial = async () => {
      try {
        const [loadedStores, loadedProducts, loadedOrders] = await Promise.all([
          api.getStores(),
          api.getCatalog(),
          api.getOrders(),
        ]);
        if (loadedStores.length) setStores(loadedStores);
        if (loadedProducts.length) setProducts(loadedProducts);
        if (loadedOrders.length) setOrders(loadedOrders);
      } catch (e) {
        console.error('Error fetching initial app data:', e);
      }
    };
    fetchInitial();
  }, []);

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

  const handleAddToCart = (product: Product) => {
    setCartItems(prev => {
      const existing = prev.find(i => i.product.id === product.id);
      if (existing) {
        return prev.map(i => i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const handleUpdateQuantity = (product: Product, newQuantity: number) => {
    if (newQuantity <= 0) {
      setCartItems(prev => prev.filter(i => i.product.id !== product.id));
    } else {
      setCartItems(prev => prev.map(i => i.product.id === product.id ? { ...i, quantity: newQuantity } : i));
    }
  };

  const handleToggleFavorite = (product: Product) => {
    setFavorites(prev => ({
      ...prev,
      [product.id]: !prev[product.id],
    }));
  };

  const handleReorder = (order: Order) => {
    for (const item of order.items) {
      const prod = products.find(p => p.id === item.productId) || {
        id: item.productId,
        sku: item.sku,
        name: item.name,
        brand: item.brand,
        species: 'Perro',
        category: 'Alimentos',
        requiresPrescription: item.requiresPrescription,
        storageCondition: 'TEMPERATURA_AMBIENTE',
        temperatureColdChain: false,
        price: item.price,
        presentation: item.presentation,
        weightKg: item.weightKg,
        image: item.image,
        description: item.name,
        stockByStore: { [currentStore.id]: 20 },
        reservedStockByStore: { [currentStore.id]: 0 },
        rating: 5,
        reviewsCount: 10,
        tags: [],
      };

      setCartItems(prev => {
        const existing = prev.find(i => i.product.id === prod.id);
        if (existing) {
          return prev.map(i => i.product.id === prod.id ? { ...i, quantity: i.quantity + item.quantity } : i);
        }
        return [...prev, { product: prod as Product, quantity: item.quantity }];
      });
    }
    setIsCartOpen(true);
  };

  // Active customer orders
  const activeOrders = useMemo(() => {
    return orders.filter(o => o.fulfillmentStatus !== 'ENTREGADO' && o.fulfillmentStatus !== 'CANCELADO');
  }, [orders]);

  // Filter products by search and tab
  const filteredProducts = useMemo(() => {
    let list = [...products];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
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
        onSelectStore={(st) => setCurrentStore(st)}
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
      />

      {/* Main Content Container */}
      <main className="max-w-7xl mx-auto px-4 pt-3 space-y-4">
        {/* Dynamic Benefit Progress Bar for Free Shipping */}
        <BenefitProgressBar subtotal={cartTotal} threshold={70000} />

        {/* If user selected Farmacia category or clicked pharmacy view */}
        {selectedCategory === 'Farmacia' ? (
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
              <span className="text-xs text-slate-500 font-semibold">
                {filteredProducts.length} productos
              </span>
            </div>

            {filteredProducts.length === 0 ? (
              <div className="bg-white rounded-3xl p-8 text-center text-slate-500 border border-slate-100 space-y-2">
                <p className="font-bold text-sm text-slate-700">No encontramos productos coincidentes</p>
                <p className="text-xs text-slate-400">Intenta buscar por marca, especie o categoría.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {filteredProducts.map(prod => (
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
                  />
                ))}
              </div>
            )}
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
          <>
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
                {lightningDeals.map(prod => (
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
                  {favoriteProducts.map(prod => (
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
                  {reorderProducts.map(prod => (
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
                {recommendedProducts.map(prod => (
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
                {newProducts.map(prod => (
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
                    />
                  </div>
                ))}
              </div>
            </div>
          </>
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
      />

      {/* Cart Drawer */}
      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cartItems={cartItems}
        onUpdateQuantity={handleUpdateQuantity}
        onClearCart={() => setCartItems([])}
        onProceedToCheckout={() => {
          setIsCartOpen(false);
          setIsCheckoutOpen(true);
        }}
        currentStore={currentStore}
      />

      {/* Checkout Modal */}
      <CheckoutModal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        cartItems={cartItems}
        currentStore={currentStore}
        onOrderSuccess={(orderId) => {
          setIsCheckoutOpen(false);
          setCartItems([]);
          pushService.simulateOrderTransition('#BP-NUEVO', orderId, 'CONFIRMADO');
          navigateTo(`/pedido/${orderId}`);
        }}
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

      {/* Floating 4-Destination Bottom Navigation Bar + Circular Search */}
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
        onOpenCart={() => setIsCartOpen(true)}
      />
    </div>
  );
}
