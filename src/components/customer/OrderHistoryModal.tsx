import React, { useState, useMemo } from 'react';
import { 
  X, ShoppingBag, Clock, ArrowRight, RotateCcw, 
  MapPin, CheckCircle2, ChevronRight, User, Phone, 
  Mail, CreditCard, ShieldCheck, Sparkles, Search, 
  Filter, AlertCircle, XCircle 
} from 'lucide-react';
import { Order, Product } from '../../types';
import { formatCOP, formatDateBogota, formatTimeBogota } from '../../lib/formatters';

interface OrderHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  orders: Order[];
  products: Product[];
  onViewOrderTracking: (orderId: string) => void;
  onReorder: (order: Order) => void;
  initialTab?: 'history' | 'profile';
}

export type OrderStatusFilter = 'ALL' | 'PENDING' | 'COMPLETED' | 'CANCELLED';

export const OrderHistoryModal: React.FC<OrderHistoryModalProps> = ({
  isOpen,
  onClose,
  orders,
  products,
  onViewOrderTracking,
  onReorder,
  initialTab = 'history',
}) => {
  const [activeTab, setActiveTab] = useState<'history' | 'profile'>(initialTab);
  const [statusFilter, setStatusFilter] = useState<OrderStatusFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [reorderedOrderId, setReorderedOrderId] = useState<string | null>(null);

  if (!isOpen) return null;

  // Counts for filters
  const pendingOrdersCount = orders.filter(
    o => o.fulfillmentStatus !== 'ENTREGADO' && o.fulfillmentStatus !== 'CANCELADO'
  ).length;

  const completedOrdersCount = orders.filter(
    o => o.fulfillmentStatus === 'ENTREGADO'
  ).length;

  const cancelledOrdersCount = orders.filter(
    o => o.fulfillmentStatus === 'CANCELADO' || o.fulfillmentStatus === 'CON_INCIDENCIA'
  ).length;

  // Filter and search orders
  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      // 1. Status Filter
      if (statusFilter === 'PENDING') {
        if (order.fulfillmentStatus === 'ENTREGADO' || order.fulfillmentStatus === 'CANCELADO') {
          return false;
        }
      } else if (statusFilter === 'COMPLETED') {
        if (order.fulfillmentStatus !== 'ENTREGADO') {
          return false;
        }
      } else if (statusFilter === 'CANCELLED') {
        if (order.fulfillmentStatus !== 'CANCELADO' && order.fulfillmentStatus !== 'CON_INCIDENCIA') {
          return false;
        }
      }

      // 2. Search Query Filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesNumber = order.orderNumber.toLowerCase().includes(query);
        const matchesStore = order.storeName.toLowerCase().includes(query);
        const matchesAddress = order.deliveryAddress.address.toLowerCase().includes(query) ||
          (order.deliveryAddress.details && order.deliveryAddress.details.toLowerCase().includes(query));
        const matchesItems = order.items.some(
          item =>
            item.name.toLowerCase().includes(query) ||
            item.brand.toLowerCase().includes(query) ||
            item.sku.toLowerCase().includes(query) ||
            item.presentation.toLowerCase().includes(query)
        );

        return matchesNumber || matchesStore || matchesAddress || matchesItems;
      }

      return true;
    });
  }, [orders, statusFilter, searchQuery]);

  const handleReorderClick = (order: Order) => {
    setReorderedOrderId(order.id);
    onReorder(order);
    setTimeout(() => {
      setReorderedOrderId(null);
    }, 2000);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'EN_CAMINO':
        return {
          text: '⚡ En camino',
          classes: 'bg-yellow-400 text-red-950 font-black',
        };
      case 'ENTREGADO':
        return {
          text: '✓ Completado',
          classes: 'bg-emerald-100 text-emerald-800 font-bold',
        };
      case 'EN_ALISTAMIENTO':
        return {
          text: '📦 Pendiente (En alistamiento)',
          classes: 'bg-blue-100 text-blue-800 font-bold',
        };
      case 'LISTO_PARA_DESPACHO':
        return {
          text: '🛵 Pendiente (Listo despacho)',
          classes: 'bg-amber-100 text-amber-800 font-bold',
        };
      case 'REPARTIDOR_ASIGNADO':
        return {
          text: '🛵 Pendiente (Repartidor asignado)',
          classes: 'bg-amber-100 text-amber-800 font-bold',
        };
      case 'CANCELADO':
        return {
          text: '✕ Cancelado',
          classes: 'bg-rose-100 text-rose-800 font-bold',
        };
      case 'CON_INCIDENCIA':
        return {
          text: '⚠ Con incidencia',
          classes: 'bg-rose-100 text-rose-800 font-bold',
        };
      default:
        return {
          text: 'Pendiente (Confirmado)',
          classes: 'bg-slate-100 text-slate-800 font-bold',
        };
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('ALL');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95">
        {/* Header with Navigation Tabs */}
        <div className="p-4 border-b border-slate-100 bg-white sticky top-0 z-10 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center font-bold">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-black text-slate-900 text-lg leading-tight">
                  {activeTab === 'history' ? 'Historial de Pedidos' : 'Mi Perfil de Usuario'}
                </h3>
                <p className="text-xs text-slate-500">
                  {activeTab === 'history'
                    ? `${orders.length} pedidos registrados en Bolt Pets`
                    : 'Datos de contacto y preferencias'}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition"
              title="Cerrar modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Sub-Tabs: Historial vs Perfil */}
          <div className="grid grid-cols-2 gap-1.5 bg-slate-100 p-1 rounded-2xl text-xs font-bold">
            <button
              onClick={() => setActiveTab('history')}
              className={`py-2 rounded-xl transition flex items-center justify-center gap-1.5 ${
                activeTab === 'history'
                  ? 'bg-white text-red-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Mis Pedidos ({orders.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('profile')}
              className={`py-2 rounded-xl transition flex items-center justify-center gap-1.5 ${
                activeTab === 'profile'
                  ? 'bg-white text-red-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>Mi Perfil</span>
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* ============================================================== */}
          {/* TAB 1: ORDER HISTORY */}
          {/* ============================================================== */}
          {activeTab === 'history' && (
            <>
              {/* Search Field */}
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar por # de pedido, producto, sede o dirección..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-2xl pl-10 pr-9 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500 transition placeholder-slate-400"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                    title="Limpiar búsqueda"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Status Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 text-xs font-semibold">
                <button
                  onClick={() => setStatusFilter('ALL')}
                  className={`px-3 py-1.5 rounded-full whitespace-nowrap transition flex items-center gap-1.5 ${
                    statusFilter === 'ALL'
                      ? 'bg-slate-900 text-white font-bold'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <span>Todos</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    statusFilter === 'ALL' ? 'bg-slate-700 text-white' : 'bg-slate-200 text-slate-700 font-bold'
                  }`}>
                    {orders.length}
                  </span>
                </button>

                <button
                  onClick={() => setStatusFilter('PENDING')}
                  className={`px-3 py-1.5 rounded-full whitespace-nowrap transition flex items-center gap-1.5 ${
                    statusFilter === 'PENDING'
                      ? 'bg-amber-500 text-slate-950 font-black'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <span>Pendientes</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    statusFilter === 'PENDING' ? 'bg-amber-600 text-white font-black' : 'bg-slate-200 text-slate-700 font-bold'
                  }`}>
                    {pendingOrdersCount}
                  </span>
                </button>

                <button
                  onClick={() => setStatusFilter('COMPLETED')}
                  className={`px-3 py-1.5 rounded-full whitespace-nowrap transition flex items-center gap-1.5 ${
                    statusFilter === 'COMPLETED'
                      ? 'bg-emerald-600 text-white font-bold'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <span>Completados</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    statusFilter === 'COMPLETED' ? 'bg-emerald-700 text-white font-bold' : 'bg-slate-200 text-slate-700 font-bold'
                  }`}>
                    {completedOrdersCount}
                  </span>
                </button>

                <button
                  onClick={() => setStatusFilter('CANCELLED')}
                  className={`px-3 py-1.5 rounded-full whitespace-nowrap transition flex items-center gap-1.5 ${
                    statusFilter === 'CANCELLED'
                      ? 'bg-rose-600 text-white font-bold'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <span>Cancelados</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    statusFilter === 'CANCELLED' ? 'bg-rose-700 text-white font-bold' : 'bg-slate-200 text-slate-700 font-bold'
                  }`}>
                    {cancelledOrdersCount}
                  </span>
                </button>
              </div>

              {/* Active Filter Indicators & Reset Action */}
              {(statusFilter !== 'ALL' || searchQuery) && (
                <div className="flex items-center justify-between text-xs px-1 text-slate-500">
                  <span>
                    Mostrando <strong>{filteredOrders.length}</strong> de {orders.length} pedidos
                  </span>
                  <button
                    onClick={clearFilters}
                    className="text-red-600 font-bold hover:underline flex items-center gap-1 text-[11px]"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Limpiar filtros</span>
                  </button>
                </div>
              )}

              {/* Orders List or Empty Results */}
              {filteredOrders.length === 0 ? (
                <div className="py-12 text-center text-slate-400 space-y-3">
                  <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                    <Search className="w-6 h-6" />
                  </div>
                  <p className="font-bold text-slate-700 text-sm">
                    {searchQuery
                      ? `No encontramos pedidos que coincidan con "${searchQuery}"`
                      : 'No hay pedidos en esta sección'}
                  </p>
                  <p className="text-xs text-slate-500 max-w-xs mx-auto">
                    Intenta cambiar los filtros de estado o buscar con otros términos como el nombre de tu mascota o producto.
                  </p>
                  <button
                    onClick={clearFilters}
                    className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2 rounded-xl transition"
                  >
                    Ver todos los pedidos
                  </button>
                </div>
              ) : (
                <div className="space-y-3.5">
                  {filteredOrders.map(order => {
                    const status = getStatusBadge(order.fulfillmentStatus);
                    const isReordered = reorderedOrderId === order.id;

                    return (
                      <div
                        key={order.id}
                        className="bg-white p-4 rounded-3xl border border-slate-200/90 shadow-xs hover:border-slate-300 transition space-y-3"
                      >
                        {/* Order Header */}
                        <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-100">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-black text-slate-900 text-sm">
                                {order.orderNumber}
                              </span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full ${status.classes}`}>
                                {status.text}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {formatDateBogota(order.createdAt)} • {formatTimeBogota(order.createdAt)} • {order.storeName}
                            </p>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="text-sm font-black text-slate-900">
                              {formatCOP(order.totals.total)}
                            </span>
                            <p className="text-[10px] text-slate-400">
                              {order.items.reduce((a, b) => a + b.quantity, 0)} {order.items.length === 1 ? 'producto' : 'productos'}
                            </p>
                          </div>
                        </div>

                        {/* Items thumbnail rail / list */}
                        <div className="space-y-2">
                          {order.items.map(item => (
                            <div key={item.productId} className="flex items-center gap-2.5">
                              <img
                                src={item.image}
                                alt={item.name}
                                className="w-10 h-10 rounded-xl object-cover bg-slate-50 border border-slate-100 shrink-0"
                              />
                              <div className="flex-1 min-w-0 text-xs">
                                <p className="font-bold text-slate-800 truncate">
                                  {item.quantity}x {item.name}
                                </p>
                                <p className="text-[11px] text-slate-400">
                                  {item.presentation} • {formatCOP(item.price)} c/u
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Delivery Address summary */}
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate">{order.deliveryAddress.address} ({order.deliveryAddress.details})</span>
                        </div>

                        {/* Action Buttons: Tracking & Reorder */}
                        <div className="pt-1 flex items-center gap-2">
                          {/* Real-time Tracking Button */}
                          <button
                            onClick={() => {
                              onClose();
                              onViewOrderTracking(order.id);
                            }}
                            className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2.5 px-3 rounded-2xl flex items-center justify-center gap-1.5 shadow-xs transition"
                          >
                            <span>Ver seguimiento</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>

                          {/* Reorder Button */}
                          <button
                            onClick={() => handleReorderClick(order)}
                            disabled={isReordered}
                            className={`flex-1 font-bold text-xs py-2.5 px-3 rounded-2xl flex items-center justify-center gap-1.5 transition ${
                              isReordered
                                ? 'bg-emerald-600 text-white'
                                : 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'
                            }`}
                            title="Agregar todos los productos de este pedido al carrito"
                          >
                            {isReordered ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>¡Agregado al carrito!</span>
                              </>
                            ) : (
                              <>
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Pedir de nuevo</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ============================================================== */}
          {/* TAB 2: USER PROFILE & ADDRESSES */}
          {/* ============================================================== */}
          {activeTab === 'profile' && (
            <div className="space-y-4">
              {/* Profile Card */}
              <div className="bg-slate-50 p-4 rounded-3xl border border-slate-200/80 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-full bg-red-600 text-white font-black text-xl flex items-center justify-center shadow-md shadow-red-500/20">
                    JG
                  </div>
                  <div>
                    <h4 className="font-black text-slate-900 text-base">Juan David Gómez</h4>
                    <p className="text-xs text-slate-500">Cliente Frecuente Bolt Pets</p>
                    <span className="inline-flex items-center gap-1 bg-yellow-400 text-red-950 font-black text-[10px] px-2 py-0.5 rounded-full mt-1">
                      <Sparkles className="w-3 h-3" />
                      Membresía Turbo VIP
                    </span>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-200 text-xs text-slate-700">
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-slate-400" />
                    <span>+57 312 890 1234</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-slate-400" />
                    <span>juan.gomez@ejemplo.com</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-slate-400" />
                    <span>Bogotá D.C., Colombia (Zona Kennedy)</span>
                  </div>
                </div>
              </div>

              {/* Saved Addresses */}
              <div className="space-y-2">
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-red-600" />
                  Direcciones Guardadas
                </h4>

                <div className="space-y-2 text-xs">
                  <div className="p-3 bg-white rounded-2xl border-2 border-red-200 flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <strong className="text-slate-900">Casa (Predeterminada)</strong>
                        <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.2 rounded font-bold">Principal</span>
                      </div>
                      <p className="text-slate-600 mt-0.5">Calle 3 #78-20, Apto 502, Torre 2</p>
                      <p className="text-[11px] text-slate-400">Kennedy Central, Bogotá</p>
                    </div>
                    <CheckCircle2 className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  </div>

                  <div className="p-3 bg-white rounded-2xl border border-slate-200 flex items-start justify-between text-slate-600">
                    <div>
                      <strong className="text-slate-800">Oficina / Trabajo</strong>
                      <p className="text-slate-600 mt-0.5">Carrera 79A #2-05, Piso 3</p>
                      <p className="text-[11px] text-slate-400">Kennedy, Bogotá</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Payment Methods */}
              <div className="space-y-2">
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-red-600" />
                  Métodos de Pago
                </h4>

                <div className="space-y-2 text-xs">
                  <div className="p-3 bg-white rounded-2xl border border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <CreditCard className="w-4 h-4 text-slate-500" />
                      <div>
                        <p className="font-bold text-slate-800">Visa terminada en •••• 4242</p>
                        <p className="text-[11px] text-slate-400">Vence 09/28 • Wompi Colombia</p>
                      </div>
                    </div>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                      Activa
                    </span>
                  </div>

                  <div className="p-3 bg-white rounded-2xl border border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      <div>
                        <p className="font-bold text-slate-800">Bancolombia PSE</p>
                        <p className="text-[11px] text-slate-400">Cuenta de Ahorros Vinculada</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
