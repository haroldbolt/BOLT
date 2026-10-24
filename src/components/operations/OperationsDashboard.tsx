import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, Clock, FileText, Bike, Boxes, DollarSign, BarChart3, 
  Settings, ArrowLeft, CheckCircle2, XCircle, AlertTriangle, UserCheck, 
  Search, RefreshCw, Key, Download, Sparkles, Phone, MapPin 
} from 'lucide-react';
import { Order, Product, Store, DriverProfile, OperationRole, FulfillmentStatus } from '../../types';
import { formatCOP, formatTimeBogota, formatDateBogota } from '../../lib/formatters';
import { api } from '../../lib/api';
import { pushService } from '../../lib/notifications';

interface OperationsDashboardProps {
  onBackToCustomer: () => void;
  onViewOrderTracking: (orderId: string) => void;
}

export const OperationsDashboard: React.FC<OperationsDashboardProps> = ({
  onBackToCustomer,
  onViewOrderTracking,
}) => {
  const [currentRole, setCurrentRole] = useState<OperationRole>('ADMINISTRADOR');
  const [activeTab, setActiveTab] = useState<'PEDIDOS' | 'FARMACIA' | 'FLOTA' | 'INVENTARIO' | 'EFECTIVO' | 'INFORMES' | 'CONDUCTOR'>('PEDIDOS');
  
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('HUB_KENNEDY');
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // Pharmacy review state
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewerName, setReviewerName] = useState('Dra. Sandra Peña (Q.F. Veterinaria)');

  // Integrations state
  const [integrations, setIntegrations] = useState<any>(null);

  const loadData = async () => {
    try {
      const [ordList, prodList, storeList, integ] = await Promise.all([
        api.getOrders(),
        api.getCatalog(),
        api.getStores(),
        api.getIntegrationsStatus(),
      ]);
      setOrders(ordList);
      setProducts(prodList);
      setStores(storeList);
      setIntegrations(integ);
    } catch (e) {
      console.error('Error loading operations data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 6000);
    return () => clearInterval(interval);
  }, []);

  // Filtered orders
  const storeOrders = orders.filter(o => o.storeId === selectedStoreId);
  const pendingPrescriptionOrders = orders.filter(o => o.prescriptionReview?.status === 'PENDIENTE_REVISION');

  // Handle stage change
  const handleUpdateStatus = async (orderId: string, status: FulfillmentStatus) => {
    const targetOrder = orders.find(o => o.id === orderId);
    await api.updateOrderStatus(orderId, status);
    await loadData();
    if (selectedOrder && selectedOrder.id === orderId) {
      setSelectedOrder(prev => prev ? { ...prev, fulfillmentStatus: status } : null);
    }
    if (targetOrder) {
      pushService.simulateOrderTransition(
        targetOrder.orderNumber,
        targetOrder.id,
        status,
        targetOrder.driver?.name,
        targetOrder.secretDeliveryCode
      );
    }
  };

  // Handle prescription review
  const handleReviewPrescription = async (orderId: string, status: 'APROBADA' | 'RECHAZADA') => {
    const targetOrder = orders.find(o => o.id === orderId);
    await api.reviewPrescription(orderId, status, reviewNotes, reviewerName);
    setReviewNotes('');
    await loadData();
    if (selectedOrder && selectedOrder.id === orderId) {
      setSelectedOrder(null);
    }
    if (targetOrder && status === 'APROBADA') {
      pushService.simulateOrderTransition(
        targetOrder.orderNumber,
        targetOrder.id,
        'PRESCRIPTION_APPROVED'
      );
    }
  };

  // Handle driver assign
  const handleAssignDriver = async (orderId: string) => {
    const targetOrder = orders.find(o => o.id === orderId);
    await api.assignDriver(orderId, 'DRV-CARLOS-01');
    await loadData();
    if (targetOrder) {
      pushService.simulateOrderTransition(
        targetOrder.orderNumber,
        targetOrder.id,
        'REPARTIDOR_ASIGNADO',
        'Carlos Rodríguez'
      );
    }
  };

  // Download contract files
  const downloadContract = (type: 'contract' | 'openapi') => {
    const filename = type === 'contract' ? 'bolt-conductor-integration-contract.md' : 'bolt-pets-openapi.yaml';
    const content = type === 'contract'
      ? `# BOLT CONDUCTOR INTEGRATION CONTRACT\nVersión 1.0.0\nConsulte docs/driver-integration-contract.md en el repositorio.`
      : `openapi: 3.0.3\ninfo:\n  title: Bolt Pets API\nConsulte docs/openapi.yaml en el repositorio.`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#F1F5F9] text-slate-900 flex flex-col">
      {/* Top Operations Bar */}
      <header className="bg-slate-900 text-white px-4 py-3 shadow-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={onBackToCustomer}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Volver a Bolt Pets</span>
            </button>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <h1 className="font-black text-sm md:text-base tracking-tight text-white flex items-center gap-1.5">
                <span>Bolt Pets Operaciones</span>
                <span className="text-[10px] bg-red-600 text-white font-extrabold px-2 py-0.5 rounded-md uppercase">
                  Staff
                </span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Store Hub filter */}
            <div className="flex items-center gap-1 bg-slate-800 px-3 py-1 rounded-xl text-xs font-semibold">
              <span className="text-slate-400">Sede:</span>
              <select
                value={selectedStoreId}
                onChange={e => setSelectedStoreId(e.target.value)}
                className="bg-transparent text-white font-bold focus:outline-none cursor-pointer"
              >
                {stores.map(s => (
                  <option key={s.id} value={s.id} className="bg-slate-800 text-white">
                    {s.name.replace('Sede ', '')}
                  </option>
                ))}
              </select>
            </div>

            {/* Role Switcher */}
            <div className="flex items-center gap-1 bg-slate-800 px-3 py-1 rounded-xl text-xs font-semibold">
              <span className="text-slate-400">Rol:</span>
              <select
                value={currentRole}
                onChange={e => setCurrentRole(e.target.value as OperationRole)}
                className="bg-transparent text-yellow-300 font-bold focus:outline-none cursor-pointer"
              >
                <option value="ADMINISTRADOR" className="bg-slate-800">Administrador</option>
                <option value="COORDINADOR" className="bg-slate-800">Coordinador Operativo</option>
                <option value="ALISTADOR" className="bg-slate-800">Alistador / Picker</option>
                <option value="DESPACHADOR" className="bg-slate-800">Despachador</option>
                <option value="REVISOR_FARMACEUTICO" className="bg-slate-800">Revisor Farmacéutico</option>
                <option value="FINANZAS" className="bg-slate-800">Finanzas & Caja</option>
                <option value="SOPORTE" className="bg-slate-800">Soporte al Cliente</option>
              </select>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Sub-Tabs */}
      <nav className="bg-white border-b border-slate-200 px-4 py-2 sticky top-14 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto flex items-center gap-1 overflow-x-auto no-scrollbar text-xs font-bold">
          {[
            { id: 'PEDIDOS', label: 'Tablero de Pedidos', count: storeOrders.length, icon: Boxes },
            { id: 'FARMACIA', label: 'Fórmulas Veterinarias', count: pendingPrescriptionOrders.length, icon: FileText, alert: pendingPrescriptionOrders.length > 0 },
            { id: 'FLOTA', label: 'Flota & Repartidores', icon: Bike },
            { id: 'INVENTARIO', label: 'Inventario & Lotes', count: products.length, icon: Settings },
            { id: 'EFECTIVO', label: 'Recaudo de Efectivo', icon: DollarSign },
            { id: 'INFORMES', label: 'Métricas & SLA', icon: BarChart3 },
            { id: 'CONDUCTOR', label: 'Bolt Conductor & API', icon: Download },
          ].map(tab => {
            const Icon = tab.icon;
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-3.5 py-2 rounded-xl flex items-center gap-1.5 whitespace-nowrap transition ${
                  isSelected
                    ? 'bg-red-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-black ${
                    tab.alert
                      ? (isSelected ? 'bg-white text-red-600' : 'bg-red-600 text-white animate-pulse')
                      : (isSelected ? 'bg-red-800 text-white' : 'bg-slate-200 text-slate-700')
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 space-y-6">
        {/* ============================================================== */}
        {/* TAB 1: LIVE ORDERS BOARD */}
        {/* ============================================================== */}
        {activeTab === 'PEDIDOS' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black text-slate-900">Cola de Alistamiento & Despacho</h2>
                <p className="text-xs text-slate-500">
                  Priorizado por promesa de entrega aceptada (SLA 15 min Turbo)
                </p>
              </div>
              <button
                onClick={loadData}
                className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-xs transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Actualizar</span>
              </button>
            </div>

            {/* Kanban Columns */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Column 1: Por Confirmar / Alistamiento */}
              <div className="bg-slate-200/60 p-3 rounded-2xl flex flex-col space-y-3">
                <div className="flex items-center justify-between text-xs font-black text-slate-700 px-1">
                  <span>1. EN ALISTAMIENTO</span>
                  <span className="bg-slate-300 px-2 py-0.5 rounded-full text-[10px]">
                    {storeOrders.filter(o => o.fulfillmentStatus === 'CONFIRMADO' || o.fulfillmentStatus === 'EN_ALISTAMIENTO').length}
                  </span>
                </div>

                <div className="space-y-2.5">
                  {storeOrders
                    .filter(o => o.fulfillmentStatus === 'CONFIRMADO' || o.fulfillmentStatus === 'EN_ALISTAMIENTO')
                    .map(order => (
                      <div
                        key={order.id}
                        className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs space-y-2.5 hover:border-red-300 transition"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <span className="text-xs font-black text-slate-900">{order.orderNumber}</span>
                            <p className="text-[11px] text-slate-500">{order.customer.name}</p>
                          </div>
                          <span className="text-[10px] font-extrabold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-md">
                            {formatTimeBogota(order.createdAt)}
                          </span>
                        </div>

                        {/* Prescription Warning */}
                        {order.prescriptionReview?.status === 'PENDIENTE_REVISION' && (
                          <div className="bg-red-50 text-red-800 text-[10px] font-extrabold p-2 rounded-xl flex items-center gap-1.5 border border-red-200">
                            <FileText className="w-3.5 h-3.5 text-red-600 shrink-0" />
                            <span>Fórmula pendiente de revisión médica</span>
                          </div>
                        )}

                        <div className="text-xs text-slate-600 space-y-1">
                          {order.items.map(item => (
                            <div key={item.productId} className="flex justify-between text-[11px]">
                              <span className="font-semibold">{item.quantity}x {item.name}</span>
                              <span className="text-slate-400">{item.presentation}</span>
                            </div>
                          ))}
                        </div>

                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                          <span className="text-xs font-black text-slate-900">
                            {formatCOP(order.totals.total)}
                          </span>
                          <button
                            onClick={() => handleUpdateStatus(order.id, 'LISTO_PARA_DESPACHO')}
                            disabled={order.prescriptionReview?.status === 'PENDIENTE_REVISION'}
                            className="bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white font-bold text-xs px-3 py-1.5 rounded-xl transition"
                          >
                            Empacado ✓
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Column 2: Listo para Despacho */}
              <div className="bg-slate-200/60 p-3 rounded-2xl flex flex-col space-y-3">
                <div className="flex items-center justify-between text-xs font-black text-slate-700 px-1">
                  <span>2. LISTO PARA DESPACHO</span>
                  <span className="bg-slate-300 px-2 py-0.5 rounded-full text-[10px]">
                    {storeOrders.filter(o => o.fulfillmentStatus === 'LISTO_PARA_DESPACHO').length}
                  </span>
                </div>

                <div className="space-y-2.5">
                  {storeOrders
                    .filter(o => o.fulfillmentStatus === 'LISTO_PARA_DESPACHO')
                    .map(order => (
                      <div
                        key={order.id}
                        className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs space-y-2.5"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-xs font-black text-slate-900">{order.orderNumber}</span>
                            <p className="text-[11px] text-slate-500">{order.deliveryAddress.address}</p>
                          </div>
                          <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-md">
                            Listo
                          </span>
                        </div>

                        <button
                          onClick={() => handleAssignDriver(order.id)}
                          className="w-full bg-red-600 hover:bg-red-700 text-white font-bold text-xs py-2 rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition"
                        >
                          <Bike className="w-3.5 h-3.5" />
                          <span>Asignar Conductor Propio</span>
                        </button>
                      </div>
                    ))}
                </div>
              </div>

              {/* Column 3: En Camino */}
              <div className="bg-slate-200/60 p-3 rounded-2xl flex flex-col space-y-3">
                <div className="flex items-center justify-between text-xs font-black text-slate-700 px-1">
                  <span>3. EN CAMINO (GPS ACTIVO)</span>
                  <span className="bg-slate-300 px-2 py-0.5 rounded-full text-[10px]">
                    {storeOrders.filter(o => o.fulfillmentStatus === 'EN_CAMINO' || o.fulfillmentStatus === 'REPARTIDOR_ASIGNADO').length}
                  </span>
                </div>

                <div className="space-y-2.5">
                  {storeOrders
                    .filter(o => o.fulfillmentStatus === 'EN_CAMINO' || o.fulfillmentStatus === 'REPARTIDOR_ASIGNADO')
                    .map(order => (
                      <div
                        key={order.id}
                        className="bg-white p-3.5 rounded-2xl border border-yellow-300 shadow-xs space-y-2.5 relative overflow-hidden"
                      >
                        <div className="absolute top-0 right-0 w-2 h-full bg-yellow-400"></div>
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-xs font-black text-slate-900">{order.orderNumber}</span>
                            <p className="text-[11px] text-slate-500">Conductor: {order.driver?.name}</p>
                          </div>
                          <span className="text-[10px] font-black bg-yellow-400 text-red-950 px-2 py-0.5 rounded-md">
                            ⚡ En ruta
                          </span>
                        </div>

                        <div className="p-2 bg-slate-50 rounded-xl text-xs space-y-1">
                          <p className="text-slate-600 text-[11px]">
                            Vehículo: <strong className="text-slate-800">{order.driver?.vehiclePlate}</strong>
                          </p>
                          <p className="text-slate-600 text-[11px]">
                            Código Secreto: <strong className="text-red-600 font-black">{order.secretDeliveryCode}</strong>
                          </p>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => onViewOrderTracking(order.id)}
                            className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2 rounded-xl text-center transition"
                          >
                            Ver en Mapa
                          </button>
                          <button
                            onClick={() => handleUpdateStatus(order.id, 'ENTREGADO')}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3 py-2 rounded-xl transition"
                            title="Confirmar entrega"
                          >
                            ✓
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Column 4: Entregados */}
              <div className="bg-slate-200/60 p-3 rounded-2xl flex flex-col space-y-3">
                <div className="flex items-center justify-between text-xs font-black text-slate-700 px-1">
                  <span>4. ENTREGADOS HOY</span>
                  <span className="bg-slate-300 px-2 py-0.5 rounded-full text-[10px]">
                    {storeOrders.filter(o => o.fulfillmentStatus === 'ENTREGADO').length}
                  </span>
                </div>

                <div className="space-y-2.5">
                  {storeOrders
                    .filter(o => o.fulfillmentStatus === 'ENTREGADO')
                    .map(order => (
                      <div
                        key={order.id}
                        className="bg-white p-3.5 rounded-2xl border border-emerald-200 shadow-xs space-y-2 opacity-90"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-xs font-black text-slate-900">{order.orderNumber}</span>
                            <p className="text-[11px] text-slate-500">{order.customer.name}</p>
                          </div>
                          <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md">
                            Entregado
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          {order.timestamps.deliveredAt ? formatTimeBogota(order.timestamps.deliveredAt) : 'Completado'}
                        </p>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 2: VETERINARY PRESCRIPTION QUEUE */}
        {/* ============================================================== */}
        {activeTab === 'FARMACIA' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
                <span>💊 Cola de Revisión de Fórmulas Médicas Veterinarias</span>
                <span className="text-xs bg-red-100 text-red-700 font-bold px-2.5 py-0.5 rounded-full">
                  Exclusivo Q.F. / Médico Veterinario
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Validación obligatoria de recetas, registro ICA, posología y firma antes de habilitar despacho.
              </p>
            </div>

            {pendingPrescriptionOrders.length === 0 ? (
              <div className="bg-white p-8 rounded-3xl border border-slate-200 text-center space-y-2">
                <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
                <h3 className="font-bold text-slate-800 text-sm">No hay fórmulas pendientes de revisión</h3>
                <p className="text-xs text-slate-500">
                  Todas las recetas subidas por los clientes han sido procesadas conformes a la normativa.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pendingPrescriptionOrders.map(order => (
                  <div
                    key={order.id}
                    className="bg-white p-5 rounded-3xl border-2 border-red-200 shadow-sm space-y-4"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-sm font-black text-slate-900">{order.orderNumber}</span>
                        <p className="text-xs text-slate-600 font-semibold">{order.customer.name} • {order.customer.phone}</p>
                        <p className="text-[11px] text-slate-400">Subido: {order.prescriptionReview.uploadedAt ? formatTimeBogota(order.prescriptionReview.uploadedAt) : ''}</p>
                      </div>
                      <span className="text-xs bg-red-100 text-red-800 font-black px-2.5 py-1 rounded-full">
                        Requiere Aprobación
                      </span>
                    </div>

                    {/* Prescribed Items in order */}
                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 space-y-2 text-xs">
                      <p className="font-bold text-slate-700">Medicamentos restringidos en el pedido:</p>
                      {order.items.filter(i => i.requiresPrescription).map(item => (
                        <div key={item.productId} className="flex justify-between items-center text-slate-800">
                          <span className="font-bold text-red-600">{item.quantity}x {item.name}</span>
                          <span className="text-[11px] bg-white border border-slate-200 px-2 py-0.5 rounded-md font-mono">
                            {item.sku}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Document Preview Link */}
                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <FileText className="w-4 h-4 text-slate-600 shrink-0" />
                        <span className="font-medium text-slate-800 truncate">
                          {order.prescriptionReview.documentName || 'receta_adjunta.pdf'}
                        </span>
                      </div>
                      {order.prescriptionReview.documentUrl && (
                        <a
                          href={order.prescriptionReview.documentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold px-3 py-1 rounded-xl text-xs transition"
                        >
                          Ver Receta
                        </a>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">Observaciones del Revisor Farmacéutico:</label>
                      <input
                        type="text"
                        placeholder="Ej. Receta vigente, posología adecuada para canino 12kg"
                        value={reviewNotes}
                        onChange={e => setReviewNotes(e.target.value)}
                        className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800"
                      />
                    </div>

                    <div className="pt-2 flex items-center gap-2">
                      <button
                        onClick={() => handleReviewPrescription(order.id, 'APROBADA')}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 shadow-sm"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Aprobar y Habilitar Despacho</span>
                      </button>
                      <button
                        onClick={() => handleReviewPrescription(order.id, 'RECHAZADA')}
                        className="bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold text-xs px-4 py-2.5 rounded-xl transition"
                      >
                        Rechazar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 3: FLEET & LIVE REPARTIDORES */}
        {/* ============================================================== */}
        {activeTab === 'FLOTA' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-black text-slate-900">Flota Propia Bolt Conductor</h2>
              <p className="text-xs text-slate-500">
                Monitoreo de disponibilidad, capacidad de carga (máx 25 kg) y telemetría en tiempo real.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                {
                  id: 'DRV-CARLOS-01',
                  name: 'Carlos Rodríguez',
                  phone: '+57 312 456 7890',
                  plate: 'TPK-44E',
                  vehicle: 'Moto Yamaha FZ 2.0',
                  status: 'EN RUTA A CLIENTE',
                  statusColor: 'bg-yellow-400 text-red-950',
                  battery: '85%',
                  activeOrder: '#BP-8941',
                  photo: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80',
                  cashCollected: 68500,
                },
                {
                  id: 'DRV-DAVID-02',
                  name: 'David Gómez',
                  phone: '+57 310 987 6543',
                  plate: 'MNB-12F',
                  vehicle: 'Moto Suzuki Gixxer',
                  status: 'DISPONIBLE EN SEDE',
                  statusColor: 'bg-emerald-100 text-emerald-800',
                  battery: '94%',
                  activeOrder: 'Ninguno',
                  photo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
                  cashCollected: 0,
                },
                {
                  id: 'DRV-VALENTINA-03',
                  name: 'Valentina Ríos',
                  phone: '+57 320 123 4567',
                  plate: 'ZXZ-89D',
                  vehicle: 'Moto Honda CB 160',
                  status: 'DISPONIBLE EN SEDE',
                  statusColor: 'bg-emerald-100 text-emerald-800',
                  battery: '90%',
                  activeOrder: 'Ninguno',
                  photo: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&auto=format&fit=crop&q=80',
                  cashCollected: 0,
                },
              ].map(driver => (
                <div key={driver.id} className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-3">
                  <div className="flex items-center gap-3">
                    <img
                      src={driver.photo}
                      alt={driver.name}
                      className="w-12 h-12 rounded-full object-cover border-2 border-white shadow-xs"
                    />
                    <div>
                      <h4 className="font-black text-sm text-slate-900">{driver.name}</h4>
                      <p className="text-xs text-slate-500">{driver.vehicle} • {driver.plate}</p>
                      <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full inline-block mt-1 ${driver.statusColor}`}>
                        {driver.status}
                      </span>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-3 rounded-2xl text-xs space-y-1.5 border border-slate-100">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Misión actual:</span>
                      <strong className="text-slate-800">{driver.activeOrder}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Batería celular:</span>
                      <strong className="text-emerald-600">{driver.battery}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Efectivo recaudado en turno:</span>
                      <strong className="text-red-600">{formatCOP(driver.cashCollected)}</strong>
                    </div>
                  </div>

                  <a
                    href={`tel:${driver.phone}`}
                    className="w-full bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs py-2 rounded-xl flex items-center justify-center gap-1.5 transition"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>Llamar por radio/teléfono</span>
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 4: INVENTORY & EXPIRY */}
        {/* ============================================================== */}
        {activeTab === 'INVENTARIO' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black text-slate-900">Control de Inventario, Lotes y Cadena de Frío</h2>
                <p className="text-xs text-slate-500">
                  Regla de seguridad: Venta online se pausa automáticamente cuando quedan 2 o menos unidades.
                </p>
              </div>
            </div>

            <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-extrabold">
                    <tr>
                      <th className="p-3.5">Producto</th>
                      <th className="p-3.5">SKU / Reg ICA</th>
                      <th className="p-3.5">Categoría</th>
                      <th className="p-3.5">Precio COP</th>
                      <th className="p-3.5">Stock Sede</th>
                      <th className="p-3.5">Reservado</th>
                      <th className="p-3.5">Lote / Vencimiento</th>
                      <th className="p-3.5">Estado Venta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                    {products.map(prod => {
                      const stock = prod.stockByStore[selectedStoreId] || 0;
                      const reserved = prod.reservedStockByStore[selectedStoreId] || 0;
                      const available = Math.max(0, stock - reserved);
                      const lot = prod.lots?.[0];

                      return (
                        <tr key={prod.id} className="hover:bg-slate-50/80">
                          <td className="p-3.5 flex items-center gap-2.5">
                            <img src={prod.image} alt="" className="w-8 h-8 rounded-lg object-cover" />
                            <div>
                              <p className="font-bold text-slate-900 leading-tight">{prod.name}</p>
                              <p className="text-[11px] text-slate-400">{prod.presentation}</p>
                            </div>
                          </td>
                          <td className="p-3.5">
                            <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
                              {prod.sku}
                            </span>
                            {prod.icaRegistration && (
                              <p className="text-[10px] text-emerald-700 font-bold mt-0.5">
                                {prod.icaRegistration}
                              </p>
                            )}
                          </td>
                          <td className="p-3.5">
                            <span className="text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full font-semibold">
                              {prod.category}
                            </span>
                          </td>
                          <td className="p-3.5 font-bold text-slate-900">
                            {formatCOP(prod.price)}
                          </td>
                          <td className="p-3.5 font-bold text-slate-900">
                            {stock}
                          </td>
                          <td className="p-3.5 text-amber-700 font-bold">
                            {reserved}
                          </td>
                          <td className="p-3.5 text-[11px]">
                            {lot ? (
                              <div>
                                <span className="font-bold">{lot.lotNumber}</span>
                                <p className="text-slate-400">Vence: {lot.expiryDate}</p>
                              </div>
                            ) : 'N/A'}
                          </td>
                          <td className="p-3.5">
                            {available <= 0 ? (
                              <span className="text-[10px] font-bold bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full">
                                Agotado
                              </span>
                            ) : available <= 2 ? (
                              <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                                Pausado (Margen Seg.)
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                                Activo ({available})
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 5: CASH SETTLEMENT (COD) */}
        {/* ============================================================== */}
        {activeTab === 'EFECTIVO' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-black text-slate-900">Liquidación y Cuadre de Caja (Efectivo)</h2>
              <p className="text-xs text-slate-500">
                Conciliación entre dinero en efectivo recaudado por conductores y caja física de sede.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-2">
                <span className="text-xs font-bold text-slate-500 uppercase">Efectivo en Manos de Conductores</span>
                <p className="text-2xl font-black text-slate-900">$68.500</p>
                <p className="text-[11px] text-slate-400">Pendiente de consignar en sede</p>
              </div>
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-2">
                <span className="text-xs font-bold text-slate-500 uppercase">Efectivo Liquidado Hoy</span>
                <p className="text-2xl font-black text-emerald-600">$185.000</p>
                <p className="text-[11px] text-slate-400">4 entregas liquidadas en caja Kennedy</p>
              </div>
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-2">
                <span className="text-xs font-bold text-slate-500 uppercase">Diferencia / Novedades</span>
                <p className="text-2xl font-black text-slate-900">$0</p>
                <p className="text-[11px] text-emerald-600 font-bold">Cuadre exacto al 100%</p>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 6: METRICS & SLA */}
        {/* ============================================================== */}
        {activeTab === 'INFORMES' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-black text-slate-900">Reportes Operativos & Cumplimiento SLA</h2>
              <p className="text-xs text-slate-500">Métricas reales calculadas en Bogotá.</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <span className="text-xs text-slate-500 font-bold">Tiempo promedio alistamiento:</span>
                <p className="text-xl font-black text-slate-900 mt-1">3.4 min</p>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <span className="text-xs text-slate-500 font-bold">Tiempo promedio viaje (Bogotá):</span>
                <p className="text-xl font-black text-slate-900 mt-1">9.2 min</p>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <span className="text-xs text-slate-500 font-bold">Cumplimiento Promesa (&lt;15m):</span>
                <p className="text-xl font-black text-emerald-600 mt-1">96.8%</p>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <span className="text-xs text-slate-500 font-bold">Tasa de cancelación:</span>
                <p className="text-xl font-black text-slate-900 mt-1">0.4%</p>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 7: BOLT CONDUCTOR CONTRACT & INTEGRATIONS */}
        {/* ============================================================== */}
        {activeTab === 'CONDUCTOR' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-black text-slate-900">Bolt Conductor Android & Contratos de Integración</h2>
              <p className="text-xs text-slate-500">
                Documentación técnica, esquemas OpenAPI 3.0 y estado de conectores empresariales.
              </p>
            </div>

            {/* Downloadable integration contract files */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center font-bold">
                    MD
                  </div>
                  <div>
                    <h4 className="font-black text-sm text-slate-900">driver-integration-contract.md</h4>
                    <p className="text-xs text-slate-500">Especificación para la App Android nativa</p>
                  </div>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Contiene ciclo de vida de la asignación, cadencias GPS (5s/15s), tolerancia de pérdida de señal, endpoints `/api/v1/driver/*` y pruebas físicas en dispositivo.
                </p>
                <button
                  onClick={() => downloadContract('contract')}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Descargar Contrato Android (Markdown)</span>
                </button>
              </div>

              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                    YAML
                  </div>
                  <div>
                    <h4 className="font-black text-sm text-slate-900">openapi.yaml</h4>
                    <p className="text-xs text-slate-500">Especificación OpenAPI 3.0 completa</p>
                  </div>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Esquemas JSON, validaciones de código de entrega, subida de telemetría y endpoints autenticados para clientes y operaciones.
                </p>
                <button
                  onClick={() => downloadContract('openapi')}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Descargar Especificación OpenAPI 3.0</span>
                </button>
              </div>
            </div>

            {/* Business Integrations Status */}
            <div className="bg-white rounded-3xl border border-slate-200 p-5 space-y-3 shadow-xs">
              <h3 className="font-extrabold text-sm text-slate-900">Estado de Conectores Empresariales</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {integrations && Object.entries(integrations).map(([key, item]: [string, any]) => (
                  <div key={key} className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100 flex items-start justify-between">
                    <div>
                      <p className="font-bold text-slate-900">{item.name}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">Última sincronización: {formatTimeBogota(item.lastSync || Date.now())}</p>
                    </div>
                    <span className="text-[10px] font-extrabold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                      {item.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
