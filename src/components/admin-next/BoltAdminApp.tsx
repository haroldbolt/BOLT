import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Box, Building2, CalendarDays, ChartNoAxesCombined, CheckCircle2, ChevronLeft,
  ChevronRight, CircleAlert, ClipboardList, Clock3, FlaskConical, ImagePlus, LayoutDashboard, LoaderCircle,
  LogOut, PackageSearch, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Store, Truck, Wrench, X, Zap,
} from 'lucide-react';
import type { FulfillmentStatus } from '../../types';
import { formatCOP, formatDateBogota, formatTimeBogota } from '../../lib/formatters';
import { api } from '../../lib/api';
import { ProductImage } from '../common/ProductImage';
import { boltAdmin, readAdminToken, storeAdminToken, type AdminActor, type AdminOrder, type AdminSession, type InventoryAdjustment, type InventoryItem, type InventoryPhotoUpdate, type InventoryScope, type PriceAdjustment, type PriceItem } from './adminClient';
import { DeliveryReviewPanel, deliveryModeLabel } from './DeliveryReviewPanel';
import { InventoryAdjustments } from './InventoryAdjustments';
import { InventoryPhotoEditor } from './InventoryPhotoEditor';
import { formatAdminPrice, PriceEditor } from './PriceManagement';
import { SalesDashboard } from './SalesDashboard';
import { LiveAdminTools, liveOperationTools, type LiveOperationTool } from './LiveAdminTools';
import './boltAdmin.css';

const tabs = [
  { id: 'home', title: 'Inicio', icon: LayoutDashboard },
  { id: 'turbo', title: 'Turbo', icon: Zap },
  { id: 'scheduled', title: 'Programados', icon: CalendarDays },
  { id: 'dispatch', title: 'Despachos', icon: Truck },
  { id: 'inventory', title: 'Inventario', icon: Box },
  { id: 'sales', title: 'Ventas', icon: ChartNoAxesCombined },
  { id: 'tools', title: 'Herramientas', icon: Wrench },
  { id: 'permissions', title: 'Permisos', icon: ShieldCheck },
] as const;
type Tab = typeof tabs[number]['id'] | 'orders';
type AdminLanding = { tab: Tab; storeId?: string; orderRef?: string; tool?: LiveOperationTool };
type OrderTab = 'orders' | 'turbo' | 'scheduled';
type OrderFilters = { search: string; status: string };
type InventoryPage = Awaited<ReturnType<typeof boltAdmin.inventory>>;
type InventoryEditor =
  | { mode: 'stock'; item: InventoryItem | null }
  | { mode: 'price' | 'photo'; item: InventoryItem };

const orderTitles: Record<OrderTab, string> = { orders: 'Todos los pedidos', turbo: 'Pedidos Turbo', scheduled: 'Envíos programados' };
const defaultOrderFilters: OrderFilters = { search: '', status: 'all' };

function landingFromUrl(): AdminLanding {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  const tool = params.get('tool');
  return {
    tab: view === 'orders' ? view : tabs.find(item => item.id === view)?.id ?? 'home',
    storeId: params.get('sede') || undefined,
    orderRef: params.get('pedido') || undefined,
    tool: liveOperationTools.find(item => item.id === tool)?.id,
  };
}

const statusLabels: Record<FulfillmentStatus, string> = {
  PENDIENTE_CONFIRMACION: 'Pendiente de confirmar', CONFIRMADO: 'Confirmado', EN_ALISTAMIENTO: 'En alistamiento',
  LISTO_PARA_DESPACHO: 'Listo para despacho', REPARTIDOR_ASIGNADO: 'Repartidor asignado', EN_CAMINO: 'En camino',
  ENTREGADO: 'Entregado', CON_INCIDENCIA: 'Con incidencia', CANCELADO: 'Cancelado',
};
const isPending = (order: AdminOrder) => order.fulfillmentStatus === 'PENDIENTE_CONFIRMACION';
const isClosed = (order: AdminOrder) => order.fulfillmentStatus === 'ENTREGADO' || order.fulfillmentStatus === 'CANCELADO';
const orderLabel = (order: AdminOrder) => order.purchaseCode || order.orderNumber || order.id;
const orderMode = (order: AdminOrder) => order.deliveryMode ?? order.deliveryReview?.requestedMode;

function orderTab(order: AdminOrder): OrderTab {
  const mode = orderMode(order);
  if (mode === 'PROGRAMADO') return 'scheduled';
  if (mode === 'TURBO' || mode === 'TURBO_DIVIDIDO') return 'turbo';
  return 'orders';
}

const roleLabel = (actor: AdminActor) => actor.role === 'COORDINACION' ? 'Coordinación' : 'Operación de sede';
const normalize = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLocaleLowerCase('es');
const errorText = (error: unknown) => error instanceof Error ? error.message : 'No pudimos completar la operación.';
const timeLabel = (date?: string) => date && Number.isFinite(Date.parse(date))
  ? `${formatDateBogota(date)} · ${formatTimeBogota(date)}` : 'Fecha no registrada';
const number = new Intl.NumberFormat('es-CO');
const sameVariant = (item: PriceItem, other: Pick<PriceItem, 'productId' | 'variantId'>) =>
  item.productId === other.productId && item.variantId === other.variantId;

function DeliverySchedule({ window, showLabel = false }: { window: AdminOrder['scheduledWindow']; showLabel?: boolean }) {
  if (!window) return <>Franja por confirmar</>;
  const date = `${window.date}T12:00:00-05:00`;
  const hours = window.startTime && window.endTime ? `${window.startTime}–${window.endTime}` : window.displayWindow;
  if (!Number.isFinite(Date.parse(date)) || !hours) return <>Franja por confirmar</>;
  return <>{showLabel && 'Entrega · '}{formatDateBogota(date)} · <span className="ba-schedule-hours">{hours}</span></>;
}

function Brand() {
  return <div className="ba-brand"><span className="ba-brand-icon"><Zap size={23} fill="currentColor" aria-hidden="true" /></span><span>BOLT<small>ADMIN</small></span></div>;
}

function Status({ status }: { status: FulfillmentStatus }) {
  const tone = status === 'PENDIENTE_CONFIRMACION' ? 'warning' : status === 'CON_INCIDENCIA' ? 'danger'
    : status === 'ENTREGADO' || status === 'CONFIRMADO' ? 'success' : 'neutral';
  return <span className={`ba-status ba-status-${tone}`}>{statusLabels[status] || status}</span>;
}

function Empty({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="ba-empty">{icon}<h3>{title}</h3><p>{text}</p></div>;
}

export function BoltAdminApp() {
  const [token, setToken] = useState(readAdminToken);
  const [session, setSession] = useState<AdminSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [landing, setLanding] = useState(landingFromUrl);
  const [setupRequired, setSetupRequired] = useState(false);
  const [adminName, setAdminName] = useState('');
  const [setupToken, setSetupToken] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setSession(null); setError('');
    void boltAdmin.session(token, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setSession(result);
      if (!result.actor) storeAdminToken(null);
    }).catch(error => { if (!controller.signal.aborted) setError(errorText(error)); });
    return () => controller.abort();
  }, [token, attempt]);

  useEffect(() => {
    if (session?.mode !== 'live' || session.actor) return;
    const controller = new AbortController();
    void boltAdmin.authStatus(controller.signal).then(result => {
      if (!controller.signal.aborted) setSetupRequired(result.isSetupRequired);
    }).catch(() => {});
    return () => controller.abort();
  }, [session]);

  async function signIn(profileId?: string, destination = landing) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const next = profileId ? await boltAdmin.demoLogin(profileId)
        : setupRequired ? await boltAdmin.setup(adminName.trim(), email.trim(), password, setupToken.trim())
        : await boltAdmin.login(email.trim(), password);
      if (session?.actor && token && token !== next.token) void boltAdmin.logout(token).catch(() => {});
      setLanding(destination);
      storeAdminToken(next.token); setSession(null); setToken(next.token); setPassword(''); setSetupToken('');
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }

  const signOut = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await boltAdmin.logout(token); }
    catch (failure) { setError(errorText(failure)); setBusy(false); return; }
    storeAdminToken(null); setSession(null); setToken(null); setAttempt(n => n + 1); setBusy(false);
  };

  if (session?.actor) return <AdminWorkspace key={`${session.actor.id}:${token}`} session={session} actor={session.actor} token={token} landing={landing}
    switchProfile={(id, destination) => void signIn(id, destination)} signOut={() => void signOut()} busy={busy} sessionError={error} />;

  return <main className="bolt-admin ba-login">
    <div className="ba-login-content">
      <Brand />
      <h1>Operación por sede</h1>
      {!session && !error && <p className="ba-loading" role="status"><LoaderCircle size={18} className="ba-spin" />Comprobando el acceso…</p>}
      {session?.mode === 'demo' && <>
        <p>Elige un perfil de prueba para consultar pedidos e inventario.</p>
        <div className="ba-profiles">
          {session.profiles.map(profile => <button key={profile.id} className="ba-profile" type="button" disabled={busy}
            onClick={() => void signIn(profile.id)}><span className="ba-symbol">{profile.role === 'COORDINACION' ? <ShieldCheck size={19} /> : <Building2 size={19} />}</span>
            <span><strong>{profile.name}</strong><small>{profile.role === 'COORDINACION' ? 'Todas las sedes' : 'Acceso de sede'}</small></span><ArrowRight size={16} /></button>)}
        </div>
      </>}
      {session?.mode === 'live' && <form onSubmit={event => { event.preventDefault(); void signIn(); }} className="ba-login-form">
        <p>{setupRequired ? 'Configura la primera cuenta administrativa de esta instalación.' : 'Ingresa con tu cuenta administrativa.'}</p>
        {setupRequired && <label className="ba-field">Nombre<input autoComplete="name" required value={adminName} onChange={event => setAdminName(event.target.value)} /></label>}
        <label className="ba-field">Correo<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label className="ba-field">Contraseña<input type="password" autoComplete={setupRequired ? 'new-password' : 'current-password'} minLength={setupRequired ? 8 : undefined} required value={password} onChange={event => setPassword(event.target.value)} /></label>
        {setupRequired && <label className="ba-field">Código de instalación<input type="password" autoComplete="off" required value={setupToken} onChange={event => setSetupToken(event.target.value)} /></label>}
        <button className="ba-btn ba-btn-primary" disabled={busy}>{busy ? 'Validando…' : setupRequired ? 'Configurar administrador' : 'Ingresar'}</button>
      </form>}
      {error && <p className="ba-error" role="alert"><CircleAlert size={16} />{error}</p>}
      {!session && error && <button className="ba-btn ba-btn-secondary" type="button" onClick={() => setAttempt(n => n + 1)}>Reintentar</button>}
      <a className="ba-text-link" href="/"><ArrowLeft size={15} /> BOLT Cliente</a>
    </div>
  </main>;
}

function AdminWorkspace({ session, actor, token, landing, switchProfile, signOut, busy, sessionError }: {
  session: AdminSession; actor: AdminActor; token: string | null; landing: AdminLanding; switchProfile: (id: string, destination?: AdminLanding) => void;
  signOut: () => void; busy: boolean; sessionError: string;
}) {
  const isDemo = session.mode === 'demo';
  const [tab, setTab] = useState<Tab>(landing.tab === 'tools' && isDemo ? 'home' : landing.tab);
  const [dispatchOrderRef, setDispatchOrderRef] = useState(landing.tab === 'dispatch' ? landing.orderRef : undefined);
  const [liveTool, setLiveTool] = useState<LiveOperationTool>(landing.tool ?? 'PEDIDOS');
  const [storeChoice, setStoreChoice] = useState(landing.storeId ?? '');
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [inventoryResult, setInventory] = useState<(InventoryPage & { scope: InventoryScope }) | null>(null);
  const [selectedOrder, setSelectedOrder] = useState('');
  const [inventoryOrder, setInventoryOrder] = useState<{ id: string; tab: OrderTab | 'dispatch' }>();
  const pendingOrderRef = useRef(landing.orderRef);
  const [orderFilters, setOrderFilters] = useState<Partial<Record<OrderTab, OrderFilters>>>({});
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryQuery, setInventoryQuery] = useState('');
  const [inventoryScope, setInventoryScope] = useState<InventoryScope>(actor.canAdjustPrices && session.stores.length === 0 ? 'catalog' : 'store');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [inboxRevision, setInboxRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const [ordersError, setOrdersError] = useState('');
  const [inventoryError, setInventoryError] = useState('');
  const [inventoryEditor, setInventoryEditor] = useState<InventoryEditor | null>(landing.tab === 'inventory' ? { mode: 'stock', item: null } : null);
  const [priceSaving, setPriceSaving] = useState(false);

  const store = session.stores.find(item => item.id === storeChoice)
    || session.stores.find(item => item.id === 'HUB_SUBA') || session.stores[0];
  const storeId = store?.id;
  const requestedStoreUnavailable = landing.storeId && !session.stores.some(item => item.id === landing.storeId);
  const activeStore = useRef(storeId);
  activeStore.current = storeId;
  const refresh = () => setRevision(value => value + 1);
  const pending = orders?.filter(isPending) ?? [];
  const active = orders?.filter(order => !isPending(order) && !isClosed(order)) ?? [];
  const orderView = tab === 'orders' || tab === 'turbo' || tab === 'scheduled' ? tab : null;
  const orderFiltersForView = orderFilters[orderView ?? 'orders'] ?? defaultOrderFilters;
  const scopedOrders = orderView && orders ? (orderView === 'orders' ? orders : orders.filter(order => orderTab(order) === orderView)) : null;
  const detail = scopedOrders?.find(order => order.id === selectedOrder);
  const reviewingDelivery = !!detail && !detail.demoReadOnly && isPending(detail) && actor.canConfirm;
  const demoTrackingPath = detail && isDemo ? trackingPathFor(detail) : undefined;
  const demoCheckoutPath = '/demo/pedido-suba';
  const demoDispatchOrders = isDemo ? orders?.filter(order => order.dispatch || order.demoCustomerCheckout) : undefined;
  const selectedDemoDispatchOrder = demoDispatchOrders?.find(order => order.id === selectedOrder);
  const inventoryScopeForView = tab === 'inventory' ? inventoryScope : 'store';
  const inventory = inventoryResult?.scope === inventoryScopeForView ? inventoryResult : null;
  const showInventoryAdjustments = inventoryEditor?.mode === 'stock';
  const inventoryPageStart = inventory && inventory.total > 0 ? inventory.offset + 1 : 0;

  useEffect(() => {
    if (!storeId) return;
    const controller = new AbortController();
    setOrdersError('');
    void boltAdmin.orders(token, storeId, controller.signal).then(result => {
      if (!controller.signal.aborted) setOrders(result.orders);
    }).catch(failure => { if (!controller.signal.aborted) setOrdersError(errorText(failure)); });
    return () => controller.abort();
  }, [storeId, token, revision, inboxRevision]);

  useEffect(() => {
    if (!pendingOrderRef.current || !orders) return;
    const ref = normalize(pendingOrderRef.current);
    const order = orders.find(item => [item.id, item.purchaseCode, item.orderNumber]
      .some(value => value && normalize(value) === ref));
    if (!order) return;
    pendingOrderRef.current = undefined;
    setSelectedOrder(order.id);
    if (tab !== 'dispatch' && orderView !== 'orders') setTab(orderTab(order));
  }, [orders, orderView, tab]);

  useEffect(() => {
    if ((tab !== 'home' && tab !== 'dispatch' && !orderView) || reviewingDelivery || !storeId) return;
    const refreshInbox = () => { if (document.visibilityState === 'visible') setInboxRevision(n => n + 1); };
    const timer = window.setInterval(refreshInbox, 18_000);
    document.addEventListener('visibilitychange', refreshInbox);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshInbox); };
  }, [tab, orderView, reviewingDelivery, storeId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setInventoryQuery(inventorySearch.trim()); setOffset(0); }, 200);
    return () => window.clearTimeout(timer);
  }, [inventorySearch]);

  useEffect(() => {
    if (!storeId && inventoryScopeForView !== 'catalog') return;
    const controller = new AbortController();
    setInventoryError('');
    void boltAdmin.inventory(token, storeId, inventoryQuery, offset, inventoryScopeForView, controller.signal).then(result => {
      if (!controller.signal.aborted) setInventory({ ...result, scope: inventoryScopeForView });
    }).catch(failure => { if (!controller.signal.aborted) setInventoryError(errorText(failure)); });
    return () => controller.abort();
  }, [storeId, token, revision, inventoryQuery, offset, inventoryScopeForView]);

  function changeStore(id: string) {
    activeStore.current = id;
    pendingOrderRef.current = undefined;
    setDispatchOrderRef(undefined);
    setInventoryOrder(undefined);
    setStoreChoice(id); setOrders(null); setInventory(null); setOffset(0);
    setInventoryEditor(current => current?.mode === 'stock' ? { mode: 'stock', item: null } : null);
    setSelectedOrder(''); setNotice('');
  }

  function navigate(next: Tab) {
    pendingOrderRef.current = undefined;
    if (next !== tab) setSelectedOrder('');
    setTab(next);
    if (next !== 'inventory') {
      setInventoryEditor(null);
      setInventoryOrder(undefined);
    }
  }

  function openInventoryAdjustments(item?: InventoryItem) {
    setInventoryEditor({ mode: 'stock', item: item ?? null });
  }

  function closeInventoryEditor() {
    setInventoryEditor(null);
  }

  function changeInventoryScope(scope: InventoryScope) {
    setInventoryScope(scope);
    setOffset(0);
    setInventory(null);
    closeInventoryEditor();
  }

  function changeInventoryPage(next: number) {
    setOffset(next);
    setInventoryEditor(current => current?.mode === 'stock' ? { mode: 'stock', item: null } : null);
  }

  function inventoryAdjusted(updated: InventoryItem) {
    if (updated.storeId !== activeStore.current) return;
    setInventory(page => page && { ...page, items: page.items.map(item => sameVariant(item, updated) ? updated : item) });
    setInventoryEditor(current => current?.mode === 'stock' && current.item && sameVariant(current.item, updated)
      ? { mode: 'stock', item: updated } : current);
    setNotice('Ajuste registrado con su motivo y responsable.');
    refresh();
  }

  async function saveInventoryPrice(adjustment: PriceAdjustment) {
    setPriceSaving(true);
    try {
      const { item } = await boltAdmin.adjustPrice(token, adjustment);
      setInventory(page => page && { ...page, items: page.items.map(row => sameVariant(row, item) ? { ...row, ...item } : row) });
      setInventoryEditor(current => current?.mode === 'price' && sameVariant(current.item, item) ? null : current);
      setNotice(`Precio guardado para ${item.name} · ${item.presentation}.`);
      refresh();
    } finally {
      setPriceSaving(false);
    }
  }

  async function saveInventoryPhoto(update: InventoryPhotoUpdate) {
    await boltAdmin.updateInventoryPhoto(token, update);
    setInventoryEditor(current => current?.mode === 'photo' && sameVariant(current.item, update) ? null : current);
    setNotice(update.target === 'product' ? 'Galería del producto guardada.' : 'Foto de la presentación guardada.');
    refresh();
  }

  function updateOrderFilters(view: OrderTab, changes: Partial<OrderFilters>) {
    setOrderFilters(current => ({ ...current, [view]: { ...(current[view] ?? defaultOrderFilters), ...changes } }));
  }

  function openAllOrders(status = 'all') {
    updateOrderFilters('orders', { search: '', status });
    navigate('orders');
  }

  function viewOrder(order: AdminOrder) {
    const destination = orderView ?? orderTab(order);
    if (!orderView) updateOrderFilters(destination, defaultOrderFilters);
    navigate(destination);
    setSelectedOrder(order.id);
  }

  function openLiveDispatches(orderId?: string) {
    navigate('dispatch');
    setDispatchOrderRef(orderId);
  }

  function openDispatch(order: AdminOrder) {
    if (!isDemo) {
      openLiveDispatches(order.id);
      return;
    }
    navigate('dispatch');
    setSelectedOrder(order.id);
  }

  function openOrderInventory(order: AdminOrder) {
    const item = order.items[0];
    if (!item) return;
    setInventorySearch(item.sku || item.name);
    setInventoryQuery(item.sku || item.name);
    setInventoryScope('store');
    setOffset(0);
    navigate('inventory');
    setInventoryOrder({ id: order.id, tab: tab === 'dispatch' ? tab : orderTab(order) });
  }

  function returnToInventoryOrder() {
    if (!inventoryOrder) return;
    navigate(inventoryOrder.tab);
    setSelectedOrder(inventoryOrder.id);
  }

  function demoDispatched(order: AdminOrder) {
    if (order.storeId !== activeStore.current) return;
    setOrders(previous => previous?.map(item => item.id === order.id ? order : item) ?? [order]);
    setNotice('Despacho de prueba en camino. Recaudo $0.');
    refresh();
  }

  const query = normalize(orderFiltersForView.search);
  const visibleOrders = scopedOrders?.filter(order => {
    const { status } = orderFiltersForView;
    const matchesStatus = status === 'all' || (status === 'active'
      ? !isPending(order) && !isClosed(order) : order.fulfillmentStatus === status);
    return matchesStatus && (!query || normalize(`${orderLabel(order)} ${order.items.map(item => item.name).join(' ')}`).includes(query));
  });

  return <div className="bolt-admin ba-shell">
    <aside className="ba-sidebar">
      <Brand />
      <nav aria-label="BOLT Admin">
        {tabs.filter(item => item.id !== 'tools' || !isDemo).map(({ id, title, icon: Icon }) => {
          const count = id === 'turbo' || id === 'scheduled' ? pending.filter(order => orderTab(order) === id).length : 0;
          return <button type="button" key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => navigate(id)}>
            <Icon size={18} strokeWidth={1.8} aria-hidden="true" /><span>{title}</span>
            {count > 0 && <small aria-label={`${number.format(count)} pendientes de confirmar`}>{number.format(count)}</small>}
          </button>;
        })}
      </nav>
      <div className="ba-sidebar-foot"><a href="/"><ArrowLeft size={16} /> BOLT Cliente</a></div>
    </aside>

    <div className="ba-main">
      <header className="ba-topbar">
        <div className="ba-context"><span>Operación</span><ChevronRight size={14} aria-hidden="true" /><strong>{orderView ? orderTitles[orderView] : tabs.find(item => item.id === tab)?.title}</strong>
          {isDemo && <span className="ba-demo"><FlaskConical size={13} aria-hidden="true" /> Demo</span>}
        </div>
        <div className="ba-top-actions">
          <label className="ba-store-picker"><Building2 size={16} aria-hidden="true" /><span className="ba-sr">Sede activa</span>
            <select value={storeId ?? ''} onChange={event => changeStore(event.target.value)} disabled={session.stores.length < 2}>
              {session.stores.length === 0 && <option value="">Sin sede asignada</option>}
              {session.stores.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
          </label>
          <button type="button" className="ba-account" onClick={() => navigate('permissions')} aria-label={`Permisos de ${actor.name}`}>
            <span aria-hidden="true">{actor.name.trim().charAt(0).toUpperCase()}</span><strong>{roleLabel(actor)}</strong>
          </button>
        </div>
      </header>

      <main className="ba-content">
        {notice && <div className="ba-notice" role="status"><CheckCircle2 size={18} /><span>{notice}</span><button className="ba-icon-btn" type="button" aria-label="Cerrar aviso" onClick={() => setNotice('')}><X size={16} /></button></div>}
        {requestedStoreUnavailable && <p className="ba-info"><ShieldCheck size={16} aria-hidden="true" /> La sede del enlace no está asignada a este perfil.</p>}
        {sessionError && <p className="ba-error" role="alert"><CircleAlert size={16} />{sessionError}</p>}

        {tab === 'home' && <>
          <section className="ba-hero">
            <div><span className="ba-hero-site"><Store size={15} />{store?.name || 'Sin sede asignada'}</span>
              <h1>Operación de la sede</h1><p>Consulta los pedidos por atender y el inventario disponible.</p></div>
            {isDemo && storeId === 'HUB_SUBA' ? <a className="ba-btn ba-btn-primary" href={demoCheckoutPath} target="_blank" rel="noopener">Probar pedido en BOLT Cliente <ArrowUpRight size={16} /></a>
              : store && <button type="button" className="ba-btn ba-btn-hero" onClick={() => openAllOrders()}>Ver pedidos <ArrowUpRight size={16} /></button>}
          </section>
          {isDemo && <p className="ba-demo-note"><FlaskConical size={16} /> Esta demo usa pedidos e inventario de prueba. No genera cobros.</p>}
          <div className="ba-metrics">
            <Metric label="Pendientes de confirmar" value={orders && !ordersError ? pending.length : null} icon={<Clock3 size={18} />} tone="amber" onClick={() => openAllOrders('PENDIENTE_CONFIRMACION')} />
            <Metric label="Pedidos en operación" value={orders && !ordersError ? active.length : null} icon={<ClipboardList size={18} />} onClick={() => openAllOrders('active')} />
            <Metric label="Presentaciones registradas" value={inventory && !inventoryError && !inventoryQuery ? inventory.total : null} icon={<Box size={18} />} onClick={() => navigate('inventory')} />
          </div>
          <section className="ba-panel">
            <div className="ba-panel-head"><div><h2>Pendientes de confirmar</h2><p>Solicitudes que necesitan una propuesta de entrega.</p></div><button type="button" className="ba-btn ba-btn-secondary" onClick={() => openAllOrders('PENDIENTE_CONFIRMACION')}>Ver pedidos <ArrowRight size={15} /></button></div>
            {ordersError ? <FetchError message={ordersError} refresh={refresh} /> : pending.length > 0 ? <OrderRows orders={pending.slice(0, 5)} selected="" onSelect={viewOrder} />
              : orders ? <Empty icon={<ClipboardList size={23} />} title="Sin solicitudes pendientes" text="Cuando lleguen solicitudes a esta sede, aparecerán aquí." />
              : <Loading text="Consultando pedidos…" />}
          </section>
        </>}

        {orderView && <>
          <PageHeading title={orderTitles[orderView]} text={store?.name || 'Sin sede asignada'}>
            {orderView !== 'orders' && <button type="button" className="ba-btn ba-btn-secondary" onClick={() => openAllOrders()}>Todos los pedidos</button>}
            <button type="button" className="ba-btn ba-btn-secondary" onClick={refresh}><RefreshCw size={16} /> Actualizar</button>
          </PageHeading>
          <div className={`ba-order-layout${detail ? ' ba-order-layout-detail' : ''}`}>
            <section className="ba-panel">
              <div className="ba-filters">
                <SearchBox label="Buscar por pedido o producto" value={orderFiltersForView.search} change={search => updateOrderFilters(orderView, { search })} />
                <label className="ba-field ba-filter-select"><span className="ba-sr">Estado del pedido</span>
                  <select value={orderFiltersForView.status} onChange={event => updateOrderFilters(orderView, { status: event.target.value })}><option value="all">Todos los estados</option><option value="active">En operación</option>
                    {Object.entries(statusLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
              </div>
              {ordersError ? <FetchError message={ordersError} refresh={refresh} /> : !visibleOrders ? <Loading text="Consultando pedidos…" />
                : visibleOrders.length === 0 ? <Empty icon={<ClipboardList size={23} />} title="Sin pedidos en esta vista" text="Prueba otro estado o cambia la búsqueda." />
                : <OrderRows orders={visibleOrders} selected={selectedOrder} onSelect={viewOrder} />}
            </section>
            {detail && <OrderDetail key={detail.id} order={detail} trackingPath={demoTrackingPath} token={token} actor={actor} isDemo={isDemo}
              close={() => setSelectedOrder('')} viewDispatch={() => openDispatch(detail)}
              viewInventory={() => openOrderInventory(detail)} changed={(result, message) => {
                if (result.storeId !== activeStore.current) return;
                setOrders(prev => prev?.map(item => item.id === result.id ? result : item) ?? [result]);
                const destination = orderTab(result);
                const moved = orderView !== 'orders' && orderView !== destination;
                if (moved) setSelectedOrder(current => current === result.id ? '' : current);
                updateOrderFilters(orderView, { status: 'all' });
                setNotice(moved ? `${message} Encuentra el pedido en ${orderTitles[destination]}.` : message);
                refresh();
              }} />}
          </div>
        </>}

        {tab === 'inventory' && <>
          <PageHeading title="Inventario" text={`${store?.name || 'Sin sede asignada'} · Precios de catálogo y existencias por sede`}>
            {inventoryOrder && <button type="button" className="ba-btn ba-btn-secondary" onClick={returnToInventoryOrder}><ArrowLeft size={16} aria-hidden="true" /> Volver al pedido</button>}
            <button type="button" className="ba-btn ba-btn-secondary" onClick={refresh}><RefreshCw size={16} /> Actualizar</button>
            {storeId && <button type="button" className="ba-btn ba-btn-primary" aria-expanded={showInventoryAdjustments}
              onClick={() => showInventoryAdjustments ? closeInventoryEditor() : openInventoryAdjustments()}>
              <SlidersHorizontal size={17} aria-hidden="true" /> Ajustes de inventario
            </button>}
          </PageHeading>
          <div className={`ba-stock-workspace${inventoryEditor ? ' ba-stock-with-adjustments' : ''}`}>
          {inventoryEditor && <aside className="ba-stock-adjustments">
            {inventoryEditor.mode === 'price' ? <PriceEditor
              key={`${inventoryEditor.item.productId}:${inventoryEditor.item.variantId}:${inventoryEditor.item.revision}`}
              item={inventoryEditor.item} saving={priceSaving} save={saveInventoryPrice} close={closeInventoryEditor}
              refreshPrices={() => { closeInventoryEditor(); refresh(); }} />
            : inventoryEditor.mode === 'photo' ? <InventoryPhotoEditor
              key={`${inventoryEditor.item.productId}:${inventoryEditor.item.variantId}`}
              item={inventoryEditor.item} token={token} save={saveInventoryPhoto} close={closeInventoryEditor} />
            : actor.canAdjustInventory ? <InventoryAdjustments
              item={inventoryEditor.item} storeName={store?.name || ''} token={token} close={closeInventoryEditor} saved={inventoryAdjusted}
              refreshRequested={() => { setInventoryEditor({ mode: 'stock', item: null }); refresh(); }} /> : <section className="ba-panel ba-inventory-access" aria-label="Permisos para ajustar inventario">
              <div className="ba-panel-head"><div><h2>Ajustes de inventario</h2><p>Coordinación administra los precios, las promociones y las existencias.</p></div>
                <button type="button" className="ba-icon-btn" aria-label="Cerrar ajustes de inventario" onClick={closeInventoryEditor}><X size={18} /></button></div>
              {isDemo && <button type="button" className="ba-btn ba-btn-secondary" disabled={busy} onClick={() => switchProfile('coordinacion', { tab: 'inventory', storeId })}>
                <ShieldCheck size={16} aria-hidden="true" /> Entrar como Coordinación
              </button>}
            </section>}
          </aside>}
          <section className="ba-panel ba-inventory-list">
            <div className="ba-filters">
              <SearchBox label="Buscar por SKU, producto o presentación" value={inventorySearch} change={setInventorySearch} />
              {actor.canAdjustPrices && <label className="ba-field ba-inventory-scope"><span className="ba-sr">Presentaciones visibles</span>
                <select value={inventoryScope} onChange={event => changeInventoryScope(event.target.value === 'catalog' ? 'catalog' : 'store')}>
                  <option value="store" disabled={!storeId}>Presentaciones de la sede</option><option value="catalog">Todo el catálogo</option>
                </select></label>}
            </div>
            {inventoryError ? <FetchError message={inventoryError} refresh={refresh} /> : !inventory ? <Loading text="Consultando inventario…" />
              : inventory.items.length === 0 ? <Empty icon={<PackageSearch size={24} />} title="Sin resultados de inventario" text="Revisa la búsqueda o la sede seleccionada." />
              : <>
                <div className="ba-table-scroll"><table className="ba-table ba-stock"><thead><tr>
                  <th scope="col">Producto / SKU</th><th scope="col">Precio vigente</th><th scope="col">Existencias</th><th scope="col">Reservadas</th><th scope="col">Disponibles</th>
                </tr></thead><tbody>
                  {inventory.items.map(item => {
                    return <tr key={`${item.productId}:${item.variantId}`} data-selected={inventoryEditor?.item && sameVariant(inventoryEditor.item, item) ? 'true' : undefined}>
                      <th scope="row">
                        <div className="ba-inventory-product">
                          <div aria-hidden="true"><ProductImage src={item.image} className="ba-inventory-thumbnail" loading="lazy" /></div>
                          <div className="ba-inventory-product-text">
                            <strong>{item.name}</strong><small>{[item.presentation, item.sku].filter(Boolean).join(' · ')}</small>
                            {!item.assignedToStore && <small>Sin asignación en esta sede</small>}
                            {item.demoReadOnly && <small>Solo consulta en la demo</small>}
                            {item.status && item.status !== 'ACTIVE' && <small>Inactivo</small>}
                            {item.canEditPhoto && <button type="button" className="ba-btn ba-btn-secondary ba-photo-trigger" disabled={priceSaving}
                              aria-label={`Editar foto de ${[item.name, item.presentation].filter(Boolean).join(', ')}`}
                              aria-expanded={inventoryEditor?.mode === 'photo' && sameVariant(inventoryEditor.item, item)}
                              onClick={() => { setNotice(''); setInventoryEditor({ mode: 'photo', item }); }}>
                              <ImagePlus size={14} aria-hidden="true" /> Editar foto
                            </button>}
                          </div>
                        </div>
                      </th>
                      <InventoryPriceCell item={item} editable={item.canEditPrice} saving={priceSaving}
                        edit={() => { setNotice(''); setInventoryEditor({ mode: 'price', item }); }} />
                      <td>{item.canEditStock ? <button className="ba-stock-editable" type="button" disabled={priceSaving} onClick={() => openInventoryAdjustments(item)}
                        aria-label={`Ajustar existencias de ${item.name}, ${item.presentation}, ${number.format(item.stock)} unidades`}>
                        {number.format(item.stock)}
                      </button> : item.assignedToStore ? number.format(item.stock) : '—'}</td>
                      <td>{item.assignedToStore ? number.format(item.reserved) : '—'}</td>
                      <td>{item.assignedToStore ? <span className={`ba-stock-value ${item.available === 0 ? 'ba-stock-none' : ''}`}>{number.format(item.available)}</span> : '—'}</td>
                    </tr>;
                  })}
                </tbody></table></div>
                <div className="ba-pagination"><span>{number.format(inventoryPageStart)}–{number.format(inventory.offset + inventory.items.length)} de {number.format(inventory.total)}</span><div>
                  <button className="ba-icon-btn" type="button" aria-label="Página anterior" disabled={offset === 0} onClick={() => changeInventoryPage(Math.max(0, offset - inventory.limit))}><ChevronLeft size={18} /></button>
                  <button className="ba-icon-btn" type="button" aria-label="Página siguiente" disabled={inventory.offset + inventory.items.length >= inventory.total} onClick={() => changeInventoryPage(offset + inventory.limit)}><ChevronRight size={18} /></button>
                </div></div>
              </>}
          </section>
          </div>
          {showInventoryAdjustments && actor.canAdjustInventory && storeId && <InventoryHistory key={storeId} storeId={storeId} token={token} revision={revision} />}
        </>}

        {tab === 'dispatch' && (isDemo ? <>
          <PageHeading title="Despachos" text={store?.name || 'Sin sede asignada'}>
            <button type="button" className="ba-btn ba-btn-secondary" onClick={refresh}><RefreshCw size={16} /> Actualizar</button>
          </PageHeading>
          <div className={`ba-order-layout${selectedDemoDispatchOrder ? ' ba-order-layout-detail' : ''}`}>
            <section className="ba-panel">
              <div className="ba-panel-head"><div><h2>Pedidos de la sede</h2><p>Consulta el estado de cada despacho.</p></div></div>
              {ordersError ? <FetchError message={ordersError} refresh={refresh} /> : !demoDispatchOrders ? <Loading text="Consultando despachos…" />
                : demoDispatchOrders.length === 0 ? <Empty icon={<Truck size={24} />} title="Sin despachos de prueba" text="Los pedidos de prueba aparecen aquí después de enviarlos desde BOLT Cliente." />
                : <OrderRows orders={demoDispatchOrders} selected={selectedOrder} onSelect={order => setSelectedOrder(order.id)} />}
            </section>
            {selectedDemoDispatchOrder && <DemoDispatchPanel key={selectedDemoDispatchOrder.id} order={selectedDemoDispatchOrder} actor={actor} token={token}
              close={() => setSelectedOrder('')} openOrder={() => viewOrder(selectedDemoDispatchOrder)}
              viewInventory={() => openOrderInventory(selectedDemoDispatchOrder)} onDispatched={demoDispatched} />}
          </div>
        </> : token && <LiveAdminTools token={token} view="dispatch" storeId={storeId} orderRef={dispatchOrderRef} key={storeId ?? 'dispatch'} />)}

        {tab === 'tools' && !isDemo && token && <>
          <PageHeading title="Herramientas operativas" text={store?.name || 'Coordinación'} />
          <label className="ba-field ba-operation-tool">Módulo
            <select value={liveTool} onChange={event => {
              const next = liveOperationTools.find(item => item.id === event.target.value);
              if (next) setLiveTool(next.id);
            }}>
              {liveOperationTools.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <LiveAdminTools token={token} view="tools" storeId={storeId} tool={liveTool} key={storeId ?? 'tools'} openDispatches={openLiveDispatches} />
        </>}

        {tab === 'sales' && <SalesDashboard token={token} storeId={storeId} stores={session.stores} fetchReport={boltAdmin.sales} />}

        {tab === 'permissions' && <>
          <PageHeading title="Permisos" text="Consulta el acceso de tu perfil." />
          <section className="ba-panel ba-permissions">
            <div className="ba-panel-head"><div><h2>{actor.name}</h2><p>{roleLabel(actor)}</p></div><span className="ba-status ba-status-success"><ShieldCheck size={14} /> Sesión activa</span></div>
            <dl><div><dt>Sedes autorizadas</dt><dd>{session.stores.map(item => item.name).join(' · ') || 'Sin sede asignada'}</dd></div>
              <div><dt>Consultar pedidos, inventario y ventas</dt><dd>Autorizado en sus sedes</dd></div>
              <div><dt>Confirmar entregas</dt><dd>{actor.canConfirm ? 'Autorizado en sus sedes' : 'Sin permiso'}</dd></div>
              <div><dt>Ajustar existencias</dt><dd>{actor.canAdjustInventory ? 'Autorizado en sus sedes' : 'Sin permiso'}</dd></div>
              <div><dt>Administrar precios y promociones</dt><dd>{actor.canAdjustPrices ? 'Autorizado para el catálogo' : 'Sin permiso'}</dd></div>
            </dl>
            <button type="button" className="ba-btn ba-btn-secondary" disabled={busy} onClick={signOut}><LogOut size={16} /> Cerrar sesión</button>
          </section>
          {isDemo && <section className="ba-panel ba-permissions"><div className="ba-panel-head"><div><h2>Perfiles de prueba</h2><p>Cambia de perfil para verificar qué puede consultar y hacer cada sede.</p></div></div>
            <div className="ba-profiles">{session.profiles.map(profile => <button type="button" key={profile.id} className="ba-profile" disabled={busy} onClick={() => switchProfile(profile.id)}>
              <span className="ba-symbol">{profile.role === 'COORDINACION' ? <ShieldCheck size={17} /> : <Building2 size={17} />}</span><span><strong>{profile.name}</strong><small>{profile.role === 'COORDINACION' ? 'Todas las sedes' : 'Acceso de sede'}</small></span><ArrowRight size={16} />
            </button>)}</div></section>}
        </>}
      </main>
    </div>
  </div>;
}

function Metric({ label, value, icon, tone, onClick }: { label: string; value: number | null; icon: ReactNode; tone?: 'amber'; onClick: () => void }) {
  return <button type="button" className="ba-metric" onClick={onClick}>
    <span className={`ba-symbol${tone ? ' ba-symbol-amber' : ''}`}>{icon}</span><span><strong>{value === null ? '—' : number.format(value)}</strong><small>{label}</small></span><ArrowDownRight className="ba-metric-arrow" size={17} aria-hidden="true" />
  </button>;
}

function PageHeading({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return <div className="ba-page-heading"><div><h1>{title}</h1><p>{text}</p></div>{children && <div className="ba-heading-actions">{children}</div>}</div>;
}

function SearchBox({ label, value, change }: { label: string; value: string; change: (value: string) => void }) {
  return <label className="ba-search"><Search size={17} aria-hidden="true" /><span className="ba-sr">{label}</span><input type="search" placeholder={label} value={value} onChange={event => change(event.target.value)} /></label>;
}

function InventoryPriceCell({ item, editable, saving, edit }: { item: InventoryItem; editable: boolean; saving: boolean; edit: () => void }) {
  const price = item.price > 0 ? formatAdminPrice(item.price) : 'Sin precio';
  const discount = item.originalPrice ? Math.round(100 * (1 - item.price / item.originalPrice)) : 0;
  return <td className="ba-stock-price">
    {editable ? <button className="ba-stock-editable" type="button" disabled={saving} onClick={edit}
      aria-label={`Editar precio de ${item.name}, ${item.presentation}, ${price}`}>{price}</button> : <strong>{price}</strong>}
    {item.originalPrice !== null && <small><span className="ba-sr">Precio regular </span><del>{formatAdminPrice(item.originalPrice)}</del></small>}
    {discount > 0 && <small className="ba-stock-discount">{discount}% de descuento</small>}
  </td>;
}

function Loading({ text }: { text: string }) {
  return <p className="ba-loading" role="status"><LoaderCircle size={18} className="ba-spin" aria-hidden="true" />{text}</p>;
}

function FetchError({ message, refresh }: { message: string; refresh: () => void }) {
  return <div className="ba-fetch-error"><p className="ba-error" role="alert"><CircleAlert size={16} />{message}</p><button className="ba-btn ba-btn-secondary" onClick={refresh} type="button">Reintentar</button></div>;
}

function OrderRows({ orders, selected, onSelect }: { orders: AdminOrder[]; selected: string; onSelect: (order: AdminOrder) => void }) {
  return <div className="ba-table-scroll"><table className="ba-table ba-order-table"><thead><tr><th scope="col">Pedido</th><th scope="col">Estado</th><th scope="col">Productos</th><th scope="col"><span className="ba-sr">Detalle</span></th></tr></thead><tbody>
    {orders.map(order => {
      const mode = orderMode(order);
      const scheduled = mode === 'PROGRAMADO';
      return <tr key={order.id} data-selected={selected === order.id ? 'true' : undefined}>
        <th scope="row">
          <div className="ba-order-identity"><strong>{orderLabel(order)}</strong>
            {mode && <span className={`ba-status ${scheduled ? 'ba-mode-scheduled' : 'ba-mode-turbo'}`}>{deliveryModeLabel(mode)}</span>}
          </div>
          {scheduled && <p className="ba-order-schedule"><DeliverySchedule window={order.scheduledWindow} showLabel /></p>}
          <small>Recibido · {timeLabel(order.createdAt)}</small>
        </th>
        <td><Status status={order.fulfillmentStatus} /></td><td>{number.format(order.items.reduce((sum, item) => sum + item.quantity, 0))} ud.</td>
        <td><button type="button" className="ba-icon-btn" aria-label={`Ver pedido ${orderLabel(order)}`} onClick={() => onSelect(order)}><ChevronRight size={19} /></button></td>
      </tr>;
    })}
  </tbody></table></div>;
}

function OrderDetail({ order, trackingPath, token, actor, isDemo, close, viewDispatch, viewInventory, changed }: {
  order: AdminOrder; trackingPath?: string; token: string | null; actor: AdminActor; isDemo: boolean;
  close: () => void; viewDispatch: () => void; viewInventory: () => void; changed: (order: AdminOrder, message: string) => void;
}) {
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const canPrepare = !order.demoReadOnly && !order.demoCustomerCheckout && actor.canConfirm && !order.isSplitOrder;
  const startingPreparation = order.fulfillmentStatus === 'CONFIRMADO';
  const canOpenDispatch = isDemo ? !!order.dispatch || (!!order.demoCustomerCheckout && !isClosed(order))
    : !!order.dispatch || (!isPending(order) && !isClosed(order));
  const cashToCollect = order.payment?.cashToCollect ?? 0;
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 1050px)').matches) heading.current?.scrollIntoView({ block: 'start' });
  }, []);
  const prepare = async () => {
    if (preparing) return;
    setPreparing(true); setError('');
    try {
      if (startingPreparation) {
        const result = await boltAdmin.startPreparation(token, order.id);
        changed(result, 'Alistamiento iniciado. El pedido está en preparación.');
      } else {
        const result = await boltAdmin.readyForDispatch(token, order.id);
        changed(result, 'Pedido listo para despacho. Consulta su asignación en Despachos.');
      }
    } catch (failure) { setError(errorText(failure)); }
    finally { setPreparing(false); }
  };
  return <section className="ba-panel ba-order-detail" aria-label="Detalle del pedido">
    <div className="ba-panel-head"><div><p>Detalle del pedido</p><h2 ref={heading} tabIndex={-1}>{orderLabel(order)}</h2></div><button className="ba-icon-btn" type="button" aria-label="Cerrar detalle del pedido" onClick={close}><X size={19} /></button></div>
    <div className="ba-order-body">
      <Status status={order.fulfillmentStatus} />
      <dl className="ba-order-meta"><div><dt>Sede</dt><dd>{order.storeName}</dd></div><div><dt>Recibido</dt><dd>{timeLabel(order.createdAt)}</dd></div>
        <div><dt>Modalidad</dt><dd>{deliveryModeLabel(orderMode(order))}</dd></div>
        {orderMode(order) === 'PROGRAMADO' && <div><dt>Franja</dt><dd><DeliverySchedule window={order.scheduledWindow} /></dd></div>}
        {order.customer?.name && <div><dt>Cliente</dt><dd>{order.customer.name}{order.customer.phone && <> · {order.customer.phone}</>}</dd></div>}
        {order.deliveryAddress?.address && <div><dt>Destino</dt><dd>{order.deliveryAddress.address}</dd></div>}
      </dl>
      <section className="ba-order-items"><h3>Productos</h3><ul>{order.items.map(item => <li key={`${item.productId}:${item.sku}`}><span>{item.name}<small>{item.presentation}</small></span><strong>×{number.format(item.quantity)}</strong></li>)}</ul>
        <div><span>{isPending(order) ? 'Subtotal de productos' : 'Total del pedido'}</span><strong>{formatCOP(isPending(order) ? order.totals.subtotal : order.totals.total)}</strong></div>
      </section>
      {!order.demoCustomerCheckout && order.payment?.status === 'PENDIENTE' && cashToCollect > 0 &&
        <p className="ba-info">Efectivo por recaudar · {formatCOP(cashToCollect)}</p>}
      {order.demoCustomerCheckout && <p className="ba-info"><FlaskConical size={16} aria-hidden="true" /> Pedido de prueba{order.payment?.cashToCollect === 0 && <> · Recaudo {formatCOP(order.payment.cashToCollect)}</>}</p>}
      {order.demoReadOnly && <p className="ba-info">Pedido recibido desde BOLT Cliente. Disponible para consulta en la demo.</p>}
      {!order.demoReadOnly && isPending(order) && (actor.canConfirm ? <DeliveryReviewPanel order={order} token={token} isDemo={isDemo}
        onConfirmed={result => changed(result, 'Entrega confirmada. Puedes consultar el nuevo estado del pedido.')} />
        : <p className="ba-info"><ShieldCheck size={16} /> Tu perfil no puede confirmar entregas.</p>)}
      {canPrepare && (startingPreparation || order.fulfillmentStatus === 'EN_ALISTAMIENTO') && <button type="button" className="ba-btn ba-btn-primary" disabled={preparing} onClick={() => void prepare()}>
        {preparing ? <LoaderCircle size={16} className="ba-spin" /> : <Box size={16} />} {startingPreparation ? 'Iniciar alistamiento' : 'Marcar listo para despacho'}
      </button>}
      {(!isDemo || order.demoCustomerCheckout) && order.items.length === 1 && !isClosed(order) && <button type="button" className="ba-btn ba-btn-secondary" onClick={viewInventory}><Box size={16} aria-hidden="true" /> Ver reserva en Inventario</button>}
      {canOpenDispatch && <button type="button" className="ba-btn ba-btn-secondary" onClick={viewDispatch}><Truck size={16} aria-hidden="true" /> Ver despacho</button>}
      {error && <p className="ba-error" role="alert"><CircleAlert size={16} />{error}</p>}
      {!!order.statusHistory?.length && <details className="ba-order-history"><summary>Historial del pedido</summary>
        <ul>{[...order.statusHistory].reverse().map((item, index) => <li key={`${item.timestamp}:${index}`}>
          <span>{statusLabels[item.newStatus] || item.newStatus}</span><small>{timeLabel(item.timestamp)}{item.actor?.name && ` · ${item.actor.name}`}</small>
        </li>)}</ul></details>}
      {trackingPath && <a href={trackingPath} target="_blank" rel="noopener" className="ba-btn ba-btn-secondary">Ver seguimiento del cliente <ArrowUpRight size={16} /></a>}
    </div>
  </section>;
}

function trackingPathFor(order: AdminOrder) {
  if (!api.hasOrderAccess(order.id)) return undefined;
  const base = order.demoCustomerCheckout ? '/pedido/' : '/simulacion/cliente/';
  return base + encodeURIComponent(order.id);
}

function DemoDispatchPanel({ order, actor, token, close, openOrder, viewInventory, onDispatched }: {
  order: AdminOrder; actor: AdminActor; token: string | null;
  close: () => void; openOrder: () => void; viewInventory: () => void; onDispatched: (order: AdminOrder) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const dispatch = order.dispatch;
  const trackingPath = trackingPathFor(order);
  const canSimulate = actor.canConfirm && order.demoCustomerCheckout && !order.demoReadOnly && (
    order.fulfillmentStatus === 'CONFIRMADO' || order.fulfillmentStatus === 'EN_ALISTAMIENTO' || order.fulfillmentStatus === 'LISTO_PARA_DESPACHO'
  );

  async function simulateDispatch() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await boltAdmin.demoDispatch(token, order.id);
      onDispatched(result.order);
    } catch (failure) { setError(errorText(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <section className="ba-panel ba-order-detail" aria-label="Detalle del despacho">
    <div className="ba-panel-head"><div><p>Despacho de prueba</p><h2>{dispatch?.code || orderLabel(order)}</h2></div>
      <button className="ba-icon-btn" type="button" aria-label="Cerrar detalle del despacho" onClick={close}><X size={19} /></button>
    </div>
    <div className="ba-order-body">
      <Status status={order.fulfillmentStatus} />
      <dl className="ba-order-meta">
        <div><dt>Pedido</dt><dd>{orderLabel(order)}</dd></div>
        <div><dt>Sede</dt><dd>{order.storeName}</dd></div>
        <div><dt>Modalidad</dt><dd>{deliveryModeLabel(orderMode(order))}</dd></div>
        {dispatch?.driverName && <div><dt>Repartidor de prueba</dt><dd>{dispatch.driverName}</dd></div>}
        {orderMode(order) === 'PROGRAMADO' && <div><dt>Franja</dt><dd><DeliverySchedule window={order.scheduledWindow} /></dd></div>}
        {order.payment?.cashToCollect === 0 && <div><dt>Recaudo</dt><dd>{formatCOP(order.payment.cashToCollect)}</dd></div>}
      </dl>
      {isPending(order) && <p className="ba-info">La unidad ya está reservada en Suba. Confirma la entrega en el pedido para habilitar el despacho.</p>}
      {canSimulate && <button type="button" className="ba-btn ba-btn-primary" disabled={busy} onClick={() => void simulateDispatch()}>
        {busy ? <LoaderCircle size={16} className="ba-spin" /> : <Truck size={16} aria-hidden="true" />} Simular despacho sin cobro
      </button>}
      {error && <p className="ba-error" role="alert"><CircleAlert size={16} aria-hidden="true" />{error}</p>}
      <button type="button" className="ba-btn ba-btn-secondary" onClick={openOrder}>Ver pedido <ArrowRight size={16} aria-hidden="true" /></button>
      {!isClosed(order) && order.demoCustomerCheckout && <button type="button" className="ba-btn ba-btn-secondary" onClick={viewInventory}><Box size={16} aria-hidden="true" /> Ver reserva en Inventario</button>}
      {trackingPath && <a href={trackingPath} target="_blank" rel="noopener" className="ba-btn ba-btn-secondary">Ver seguimiento del cliente <ArrowUpRight size={16} aria-hidden="true" /></a>}
    </div>
  </section>;
}

function InventoryHistory({ storeId, token, revision }: { storeId: string; token: string | null; revision: number }) {
  const [adjustments, setAdjustments] = useState<InventoryAdjustment[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void boltAdmin.inventoryAdjustments(token, storeId, controller.signal).then(result => {
      if (!controller.signal.aborted) setAdjustments(result.adjustments);
    }).catch(failure => { if (!controller.signal.aborted) setError(errorText(failure)); });
    return () => controller.abort();
  }, [storeId, token, revision]);

  return <section className="ba-panel ba-stock-history" aria-labelledby="ba-inventory-history-title">
    <div className="ba-panel-head"><h2 id="ba-inventory-history-title">Ajustes manuales recientes</h2></div>
    {error ? <p className="ba-error" role="alert"><CircleAlert size={16} aria-hidden="true" />{error}</p>
      : !adjustments ? <Loading text="Consultando ajustes…" />
        : adjustments.length === 0 ? <p className="ba-history-empty">Todavía no hay ajustes registrados para esta sede.</p>
          : <div className="ba-table-scroll"><table className="ba-table"><thead><tr>
            <th scope="col">Producto / SKU</th><th scope="col">Existencias</th><th scope="col">Motivo</th><th scope="col">Registrado por</th>
          </tr></thead><tbody>{adjustments.map(adjustment => <tr key={adjustment.id}>
            <th scope="row"><strong>{adjustment.name}</strong><small>{[adjustment.presentation, adjustment.sku].filter(Boolean).join(' · ')}</small></th>
            <td className="ba-history-stock">{number.format(adjustment.before)} → {number.format(adjustment.after)}</td>
            <td>{adjustment.reason || 'Sin motivo registrado'}</td>
            <td><strong>{adjustment.actorName || 'Sin responsable registrado'}</strong><small>{timeLabel(adjustment.timestamp)}</small></td>
          </tr>)}</tbody></table></div>}
  </section>;
}
