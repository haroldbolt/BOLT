import React, { useState } from 'react';
import { Search, MapPin, ChevronDown, User, ShoppingBag, ShieldCheck, HelpCircle, Heart, Clock, Menu, X, ArrowLeft, Bell, Navigation, Calendar, Compass, Bookmark } from 'lucide-react';
import { MainCategory, Store, DeliveryMode, ScheduledDeliveryWindow } from '../../types';
import { DeliveryQuote } from '../../lib/deliveryService';

interface HeaderProps {
  currentStore: Store;
  allStores: Store[];
  onSelectStore: (store: Store) => void;
  selectedCategory: MainCategory;
  onSelectCategory: (cat: MainCategory) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  activeOrdersCount: number;
  onOpenActiveOrders: () => void;
  onNavigateToOperacion: () => void;
  onOpenOrderHistory: () => void;
  onOpenProfile: () => void;
  onOpenNotifications: () => void;
  unreadNotificationsCount?: number;
  totalOrdersCount?: number;
  isCompact?: boolean;
  customerAddress?: string;
  customerAddressDetails?: string;
  deliveryQuote?: DeliveryQuote | null;
  onOpenAddressModal?: () => void;
  selectedDeliveryMode?: DeliveryMode;
  selectedScheduledWindow?: ScheduledDeliveryWindow | null;
  onOpenScheduledModal?: () => void;
  onOpenTour?: () => void;
  onOpenWishlist?: () => void;
  wishlistCollectionsCount?: number;
}

const CATEGORIES: MainCategory[] = [
  'Todo',
  'Perros',
  'Gatos',
  'Alimentos',
  'Arenas',
  'Snacks',
  'Farmacia',
  'Antipulgas',
  'Higiene',
  'Accesorios',
];

export const Header: React.FC<HeaderProps> = ({
  currentStore,
  allStores,
  onSelectStore,
  selectedCategory,
  onSelectCategory,
  searchQuery,
  onSearchChange,
  activeOrdersCount,
  onOpenActiveOrders,
  onNavigateToOperacion,
  onOpenOrderHistory,
  onOpenProfile,
  onOpenNotifications,
  unreadNotificationsCount = 0,
  totalOrdersCount = 0,
  isCompact = false,
  customerAddress,
  customerAddressDetails,
  deliveryQuote,
  onOpenAddressModal,
  selectedDeliveryMode,
  selectedScheduledWindow,
  onOpenScheduledModal,
  onOpenTour,
  onOpenWishlist,
  wishlistCollectionsCount = 0,
}) => {
  const [showStoreModal, setShowStoreModal] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  // Determinar si aplica la modalidad de Envío Programado
  const isScheduledDelivery =
    selectedDeliveryMode === 'PROGRAMADO' ||
    (!!deliveryQuote && !deliveryQuote.availableModes.turbo && !deliveryQuote.availableModes.turboDividido && !!deliveryQuote.availableModes.scheduled);

  const formatHeaderWindow = (win: ScheduledDeliveryWindow): string => {
    let day = 'Hoy';
    if (win.dateLabel?.includes('Mañana')) {
      day = 'Mañana';
    } else if (win.dateLabel && !win.dateLabel.includes('Hoy')) {
      day = win.dateLabel.split(',')[0].trim();
    }

    let interval = win.displayWindowShort;
    if (!interval) {
      if (win.startTime === '09:00' && win.endTime === '14:00') interval = '9:00–2:00 p. m.';
      else if (win.startTime === '14:00' && win.endTime === '18:00') interval = '2:00–6:00 p. m.';
      else if (win.startTime === '18:00' && win.endTime === '22:00') interval = '6:00–10:00 p. m.';
      else interval = `${win.startTime}–${win.endTime}`;
    }

    return `${day}, ${interval}`;
  };

  return (
    <>
      <header className={`bg-[#DC2626] text-white transition-all duration-200 z-40 sticky top-0 shadow-md pt-safe pl-safe pr-safe ${isCompact ? 'py-2 px-3' : 'pt-3 pb-2.5 px-3 sm:px-4'}`}>
        <div className="max-w-7xl mx-auto space-y-2.5">
          {/* ROW 1: TOP BAR WITH CENTERED BOLT PETS LOGO & ACTIONS */}
          <div className="relative flex items-center justify-between">
            {/* Left side: Active Order Shortcut if running, or spacer */}
            <div className="flex items-center gap-1.5 w-1/4">
              {activeOrdersCount > 0 ? (
                <button
                  onClick={onOpenActiveOrders}
                  className="bg-white text-red-600 hover:bg-red-50 text-[11px] font-bold px-2.5 py-1.5 rounded-full flex items-center gap-1 shadow-sm transition animate-bounce"
                  title="Ver pedido en curso"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">En camino</span>
                  <span className="bg-red-600 text-white text-[10px] w-4 h-4 rounded-full inline-flex items-center justify-center font-bold">
                    {activeOrdersCount}
                  </span>
                </button>
              ) : (
                <div className="w-8 h-8" />
              )}
            </div>

            {/* CENTER: Prominent Bolt Pets Logo with visually highlighted yellow lightning */}
            <div
              className="flex flex-col items-center justify-center cursor-pointer group"
              onClick={() => onSelectCategory('Todo')}
              title="Bolt Pets - Inicio"
            >
              <div className="relative p-1 rounded-2xl bg-linear-to-tr from-yellow-400 via-amber-300 to-yellow-500 shadow-lg shadow-yellow-500/30 ring-2 ring-yellow-300 transition-transform group-hover:scale-105 active:scale-95">
                <img
                  src="/assets/aistudio/Bolt_Pets_logo_original__1__ce47c0d5.jpg"
                  alt="Bolt Pets"
                  className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl object-cover"
                />
                <div className="absolute -bottom-1 -right-1 bg-yellow-400 text-red-950 w-5 h-5 rounded-full shadow-md text-xs font-black flex items-center justify-center border-2 border-white animate-pulse">
                  ⚡
                </div>
              </div>
            </div>

            {/* Right side: Notifications & Account Menu */}
            <div className="flex items-center justify-end gap-2 w-1/4">
              {/* Notifications Bell */}
              <button
                onClick={onOpenNotifications}
                className="relative w-8 h-8 rounded-full bg-red-700 hover:bg-red-800 text-white flex items-center justify-center border border-red-500/60 shadow-sm transition"
                title="Centro de notificaciones push"
              >
                <Bell className="w-4 h-4" />
                {unreadNotificationsCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-400 text-red-950 text-[10px] font-black rounded-full flex items-center justify-center shadow-xs animate-pulse">
                    {unreadNotificationsCount}
                  </span>
                )}
              </button>

              {/* Account / Overflow Menu */}
              <div className="relative">
                <button
                  onClick={() => setShowAccountMenu(!showAccountMenu)}
                  className="w-8 h-8 rounded-full bg-red-700 hover:bg-red-800 text-white flex items-center justify-center border border-red-500/60 shadow-sm transition"
                  title="Mi cuenta y opciones"
                >
                  <User className="w-4 h-4" />
                </button>

                {showAccountMenu && (
                  <div className="absolute right-0 mt-2 w-60 bg-white text-slate-800 rounded-3xl shadow-2xl border border-slate-100 py-2.5 z-50 text-sm">
                    <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
                      <div>
                        <p className="font-extrabold text-slate-900 leading-tight">Juan David Gómez</p>
                        <p className="text-[11px] text-slate-500">juan.gomez@ejemplo.com</p>
                      </div>
                      <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">
                        Cliente VIP
                      </span>
                    </div>

                    <button
                      onClick={() => { setShowAccountMenu(false); onOpenNotifications(); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center justify-between text-slate-700 font-semibold transition"
                    >
                      <div className="flex items-center gap-2.5">
                        <Bell className="w-4 h-4 text-red-600" />
                        <span>Notificaciones Push</span>
                      </div>
                      {unreadNotificationsCount > 0 && (
                        <span className="text-[10px] bg-yellow-400 text-red-950 px-2 py-0.5 rounded-full font-black">
                          {unreadNotificationsCount} nuevas
                        </span>
                      )}
                    </button>

                    <button
                      onClick={() => { setShowAccountMenu(false); onOpenOrderHistory(); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center justify-between text-slate-700 font-semibold transition"
                    >
                      <div className="flex items-center gap-2.5">
                        <ShoppingBag className="w-4 h-4 text-red-600" />
                        <span>Historial de Pedidos</span>
                      </div>
                      <span className="text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full font-bold">
                        {totalOrdersCount}
                      </span>
                    </button>

                    <button
                      onClick={() => { setShowAccountMenu(false); onOpenProfile(); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center gap-2.5 text-slate-700 font-semibold transition"
                    >
                      <User className="w-4 h-4 text-red-600" />
                      <span>Mi Perfil & Datos</span>
                    </button>

                    <button
                      onClick={() => { setShowAccountMenu(false); setShowStoreModal(true); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center gap-2.5 text-slate-700 font-semibold transition"
                    >
                      <MapPin className="w-4 h-4 text-red-600" />
                      <span>Direcciones & Sedes</span>
                    </button>

                    <button
                      onClick={() => { setShowAccountMenu(false); onSelectCategory('Todo'); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center gap-2.5 text-slate-700 font-semibold transition"
                    >
                      <Heart className="w-4 h-4 text-red-600" />
                      <span>Mis Favoritos</span>
                    </button>

                    {onOpenWishlist && (
                      <button
                        onClick={() => { setShowAccountMenu(false); onOpenWishlist(); }}
                        className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center justify-between text-slate-700 font-semibold transition"
                      >
                        <div className="flex items-center gap-2.5">
                          <Bookmark className="w-4 h-4 text-amber-500 fill-amber-500" />
                          <span>Mis Listas de Deseos</span>
                        </div>
                        {wishlistCollectionsCount > 0 && (
                          <span className="text-[11px] bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full font-bold">
                            {wishlistCollectionsCount} {wishlistCollectionsCount === 1 ? 'lista' : 'listas'}
                          </span>
                        )}
                      </button>
                    )}

                    {onOpenTour && (
                      <button
                        onClick={() => { setShowAccountMenu(false); onOpenTour(); }}
                        className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center gap-2.5 text-slate-700 font-semibold transition"
                      >
                        <Compass className="w-4 h-4 text-red-600" />
                        <span>Ver tour de bienvenida</span>
                      </button>
                    )}

                    <div className="border-t border-slate-100 my-1"></div>

                    <button
                      onClick={() => { setShowAccountMenu(false); onNavigateToOperacion(); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-red-50 flex items-center gap-2.5 text-red-700 font-bold transition"
                    >
                      <ShieldCheck className="w-4 h-4 text-red-600" />
                      <span>Panel Operativo (/operacion)</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ROW 2: PROMINENT DELIVERY-TIME CAPSULE (INSPIRED BY RAPPI TURBO) */}
          <div className="flex justify-center">
            <button
              onClick={() => {
                if (isScheduledDelivery && onOpenScheduledModal) {
                  onOpenScheduledModal();
                } else if (onOpenAddressModal) {
                  onOpenAddressModal();
                } else {
                  setShowStoreModal(true);
                }
              }}
              className={`inline-flex items-center gap-2 px-5 py-1.5 rounded-full font-black text-xs sm:text-sm shadow-md transition-transform hover:scale-[1.02] active:scale-95 border ${
                isScheduledDelivery
                  ? 'bg-blue-900/95 hover:bg-blue-900 text-blue-100 border-blue-400/50 shadow-blue-950/20'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400/50 shadow-emerald-950/25'
              }`}
              title={isScheduledDelivery ? 'Modalidad: Envío Programado. Haz clic para cambiar franja.' : 'Entrega ultra-rápida Turbo en Bogotá'}
            >
              {isScheduledDelivery ? (
                <>
                  <Calendar className="w-4 h-4 text-yellow-300 shrink-0" />
                  <span className="font-bold">
                    {selectedScheduledWindow ? (
                      `Envío programado · ${formatHeaderWindow(selectedScheduledWindow)}`
                    ) : (
                      'Envío programado · Elige día y horario'
                    )}
                  </span>
                  {deliveryQuote?.detectedLocalityName && (
                    <span className="text-[10px] bg-yellow-400 text-blue-950 font-black px-1.5 py-0.5 rounded-full ml-0.5">
                      {deliveryQuote.detectedLocalityName}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-yellow-300 text-xs font-black shrink-0">
                    ⚡
                  </span>
                  <span className="tracking-wide">
                    Turbo <span className="font-black text-white text-sm sm:text-base">{deliveryQuote?.estimatedMinutes || 25} min</span>
                  </span>
                  {deliveryQuote?.detectedLocalityName && (
                    <span className="text-[10px] bg-emerald-800 text-emerald-100 font-bold px-1.5 py-0.5 rounded-full ml-0.5">
                      {deliveryQuote.detectedLocalityName}
                    </span>
                  )}
                </>
              )}
            </button>
          </div>

          {/* ROW 3: WIDER, CLEANER CUSTOMER DELIVERY-ADDRESS BAR */}
          {/* Displays the customer's address, not the warehouse address */}
          <div className="flex justify-center">
            <button
              onClick={() => (onOpenAddressModal ? onOpenAddressModal() : setShowStoreModal(true))}
              className="w-full max-w-xl flex items-center justify-between bg-red-800/85 hover:bg-red-800 text-white rounded-full px-4 py-2 text-left border border-red-500/60 shadow-inner transition group"
            >
              <div className="flex items-center gap-2 overflow-hidden flex-1">
                <MapPin className="w-4 h-4 text-yellow-300 shrink-0" />
                <div className="truncate text-xs sm:text-sm font-semibold flex-1">
                  {customerAddress ? (
                    <span className="font-bold text-white tracking-wide">
                      {customerAddress}
                      {deliveryQuote?.detectedLocalityName && (
                        <span className="text-red-200 text-xs font-normal ml-1">
                          · {deliveryQuote.detectedLocalityName}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="font-extrabold text-white/95">¿Dónde entregamos tu pedido? Ingresa tu dirección</span>
                  )}
                </div>
              </div>
              <ChevronDown className="w-4 h-4 text-red-200 shrink-0 ml-2 group-hover:translate-y-0.5 transition" />
            </button>
          </div>

          {/* ROW 4: SEARCH BAR */}
          <div className="relative" id="tour-search-bar">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Busca en Bolt Pets (alimentos, farmacia, marcas)..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full bg-white text-slate-900 placeholder-slate-400 text-xs sm:text-sm font-medium rounded-full pl-10 pr-10 py-2.5 shadow-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* ROW 5: HORIZONTALLY SCROLLABLE PRODUCT CATEGORIES */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
            {CATEGORIES.map((cat) => {
              const isSelected = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => onSelectCategory(cat)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all shadow-sm ${
                    isSelected
                      ? 'bg-white text-red-600 scale-105 shadow-md'
                      : 'bg-red-700/70 hover:bg-red-700 text-white'
                  }`}
                >
                  {cat === 'Farmacia' ? '💊 Farmacia' : cat}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Store selection modal */}
      {showStoreModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-5 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-extrabold text-slate-900 text-lg">Selecciona tu sede en Bogotá</h3>
                <p className="text-xs text-slate-500">Elige la sede más cercana para entrega rápida</p>
              </div>
              <button
                onClick={() => setShowStoreModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-2.5">
              {allStores.map((store) => {
                const isSelected = store.id === currentStore.id;
                const isInactive = !store.isActive;
                return (
                  <div
                    key={store.id}
                    onClick={() => {
                      if (isInactive) return;
                      onSelectStore(store);
                      setShowStoreModal(false);
                    }}
                    className={`p-3.5 rounded-2xl border-2 transition flex items-start justify-between ${
                      isInactive
                        ? 'opacity-60 bg-slate-50 border-slate-200 cursor-not-allowed'
                        : isSelected
                        ? 'border-red-600 bg-red-50/50 cursor-pointer'
                        : 'border-slate-100 hover:border-slate-200 bg-white cursor-pointer'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">{store.name}</span>
                        {isInactive ? (
                          <span className="text-[10px] font-bold bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">
                            🚫 Inactiva
                          </span>
                        ) : store.turboEnabled ? (
                          <span className="text-[10px] font-extrabold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                            ⚡ Turbo 15m
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                            Estándar
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5">{store.address}</p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        {isInactive ? 'Sede temporalmente deshabilitada' : `Horario: ${store.schedule}`}
                      </p>
                    </div>
                    {isSelected && !isInactive && (
                      <span className="w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center text-xs font-bold shrink-0 mt-1">
                        ✓
                      </span>
                    )}
                  </div>
                );
              })}

              <div className="mt-3 p-3 bg-slate-50 rounded-xl text-xs text-slate-500 flex items-center gap-2">
                <span className="font-bold text-slate-700">Nota:</span>
                <span>Usaquén se encuentra excluida de cobertura temporalmente.</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
