import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Box, Building2, CheckCircle2, ChevronLeft,
  ChevronRight, CircleAlert, ClipboardList, Clock3, FlaskConical, LayoutDashboard, LoaderCircle,
  LogOut, PackageSearch, Plus, RefreshCw, Search, ShieldCheck, Store, X, Zap,
} from 'lucide-react';
import type { FulfillmentStatus } from '../../types';
import { formatCOP, formatDateBogota, formatTimeBogota } from '../../lib/formatters';
import { api } from '../../lib/api';
import { boltAdmin, readAdminToken, storeAdminToken, type AdminActor, type AdminOrder, type AdminSession, type DemoOrderMode, type InventoryItem } from './adminClient';
import { DeliveryReviewPanel, deliveryModeLabel } from './DeliveryReviewPanel';
import './boltAdmin.css';

const tabs = [
  { id: 'home', title: 'Inicio', icon: LayoutDashboard },
  { id: 'orders', title: 'Pedidos', icon: ClipboardList },
  { id: 'inventory', title: 'Inventario', icon: Box },
  { id: 'permissions', title: 'Permisos', icon: ShieldCheck },
] as const;
type Tab = typeof tabs[number]['id'];
type InventoryPage = Awaited<ReturnType<typeof boltAdmin.inventory>>;

const statusLabels: Record<FulfillmentStatus, string> = {
  PENDIENTE_CONFIRMACION: 'Pendiente de confirmar', CONFIRMADO: 'Confirmado', EN_ALISTAMIENTO: 'En alistamiento',
  LISTO_PARA_DESPACHO: 'Listo para despacho', REPARTIDOR_ASIGNADO: 'Repartidor asignado', EN_CAMINO: 'En camino',
  ENTREGADO: 'Entregado', CON_INCIDENCIA: 'Con incidencia', CANCELADO: 'Cancelado',
};
const isPending = (order: AdminOrder) => order.fulfillmentStatus === 'PENDIENTE_CONFIRMACION';
const isClosed = (order: AdminOrder) => order.fulfillmentStatus === 'ENTREGADO' || order.fulfillmentStatus === 'CANCELADO';
const orderLabel = (order: AdminOrder) => order.purchaseCode || order.orderNumber || order.id;
const orderMode = (order: AdminOrder) => order.deliveryMode ?? order.deliveryReview?.requestedMode;
const roleLabel = (actor: AdminActor) => actor.role === 'COORDINACION' ? 'Coordinación' : 'Operación de sede';
const normalize = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLocaleLowerCase('es');
const errorText = (error: unknown) => error instanceof Error ? error.message : 'No pudimos completar la operación.';
const timeLabel = (date?: string) => date && Number.isFinite(Date.parse(date))
  ? `${formatDateBogota(date)} · ${formatTimeBogota(date)}` : 'Fecha no registrada';
const number = new Intl.NumberFormat('es-CO');

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

  async function signIn(profileId?: string) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const next = profileId ? await boltAdmin.demoLogin(profileId) : await boltAdmin.login(email.trim(), password);
      if (session?.actor && token && token !== next.token) void boltAdmin.logout(token).catch(() => {});
      storeAdminToken(next.token); setSession(null); setToken(next.token); setPassword('');
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

  if (session?.actor) return <AdminWorkspace key={`${session.actor.id}:${token}`} session={session} actor={session.actor} token={token}
    switchProfile={id => void signIn(id)} signOut={() => void signOut()} busy={busy} sessionError={error} />;

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
        <p>Ingresa con tu cuenta administrativa.</p>
        <label className="ba-field">Correo<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label className="ba-field">Contraseña<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
        <button className="ba-btn ba-btn-primary" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
      </form>}
      {error && <p className="ba-error" role="alert"><CircleAlert size={16} />{error}</p>}
      {!session && error && <button className="ba-btn ba-btn-secondary" type="button" onClick={() => setAttempt(n => n + 1)}>Reintentar</button>}
      <a className="ba-text-link" href="/operacion"><ArrowLeft size={15} /> Panel anterior</a>
    </div>
  </main>;
}

function AdminWorkspace({ session, actor, token, switchProfile, signOut, busy, sessionError }: {
  session: AdminSession; actor: AdminActor; token: string | null; switchProfile: (id: string) => void;
  signOut: () => void; busy: boolean; sessionError: string;
}) {
  const [tab, setTab] = useState<Tab>('home');
  const [storeChoice, setStoreChoice] = useState('');
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [inventory, setInventory] = useState<InventoryPage | null>(null);
  const [selectedOrder, setSelectedOrder] = useState('');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatus, setOrderStatus] = useState('all');
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryQuery, setInventoryQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [inboxRevision, setInboxRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const [ordersError, setOrdersError] = useState('');
  const [inventoryError, setInventoryError] = useState('');
  const [actionError, setActionError] = useState('');
  const [demoOrderMode, setDemoOrderMode] = useState<DemoOrderMode>('PROGRAMADO');
  const [fixtureBusy, setFixtureBusy] = useState(false);
  const fixtureKeys = useRef<Partial<Record<DemoOrderMode, string>>>({});
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);

  const store = session.stores.find(item => item.id === storeChoice)
    || session.stores.find(item => item.id === 'HUB_SUBA') || session.stores[0];
  const storeId = store?.id;
  const activeStore = useRef(storeId);
  activeStore.current = storeId;
  const isDemo = session.mode === 'demo';
  const refresh = () => setRevision(value => value + 1);
  const pending = orders?.filter(isPending) ?? [];
  const active = orders?.filter(order => !isPending(order) && !isClosed(order)) ?? [];
  const detail = orders?.find(order => order.id === selectedOrder);
  const reviewingDelivery = !!detail && isPending(detail) && actor.canConfirm;
  const demoTrackingPath = isDemo && detail && api.hasOrderAccess(detail.id)
    ? `/simulacion/cliente/${encodeURIComponent(detail.id)}` : undefined;
  const canCreateDemoOrder = isDemo && storeId === 'HUB_SUBA' && actor.canConfirm;
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
    if ((tab !== 'home' && tab !== 'orders') || reviewingDelivery || !storeId) return;
    const refreshInbox = () => { if (document.visibilityState === 'visible') setInboxRevision(n => n + 1); };
    const timer = window.setInterval(refreshInbox, 18_000);
    document.addEventListener('visibilitychange', refreshInbox);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshInbox); };
  }, [tab, reviewingDelivery, storeId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setInventoryQuery(inventorySearch.trim()); setOffset(0); }, 200);
    return () => window.clearTimeout(timer);
  }, [inventorySearch]);

  useEffect(() => {
    if (!storeId) return;
    const controller = new AbortController();
    setInventoryError('');
    void boltAdmin.inventory(token, storeId, inventoryQuery, offset, controller.signal).then(result => {
      if (!controller.signal.aborted) setInventory(result);
    }).catch(failure => { if (!controller.signal.aborted) setInventoryError(errorText(failure)); });
    return () => controller.abort();
  }, [storeId, token, revision, inventoryQuery, offset]);

  function changeStore(id: string) {
    activeStore.current = id;
    setStoreChoice(id); setOrders(null); setInventory(null); setOffset(0); setEditItem(null);
    setSelectedOrder(''); setNotice(''); setActionError('');
  }

  function viewOrder(id: string) {
    setSelectedOrder(id); setTab('orders');
  }

  async function createDemoOrder(mode: DemoOrderMode = 'PROGRAMADO') {
    if (!canCreateDemoOrder || fixtureBusy) return;
    setFixtureBusy(true); setActionError(''); setNotice('');
    try {
      const key = fixtureKeys.current[mode] ??= crypto.randomUUID();
      const result = await boltAdmin.createDemoOrder(token, key, mode);
      delete fixtureKeys.current[mode];
      if (result.trackingPath === `/simulacion/cliente/${encodeURIComponent(result.orderId)}`) {
        api.saveOrderAccess(result.orderId, result.guestAccessToken);
      }
      if (activeStore.current !== 'HUB_SUBA') return;
      setOrderStatus('all'); setOrderSearch(''); viewOrder(result.orderId); refresh();
      setNotice('Pedido de prueba listo. Consulta la disponibilidad para continuar.');
    } catch (failure) { setActionError(errorText(failure)); }
    finally { setFixtureBusy(false); }
  }

  const visibleOrders = orders?.filter(order => {
    const matchesStatus = orderStatus === 'all' || (orderStatus === 'active'
      ? !isPending(order) && !isClosed(order) : order.fulfillmentStatus === orderStatus);
    const query = normalize(orderSearch);
    return matchesStatus && (!query || normalize(`${orderLabel(order)} ${order.items.map(item => item.name).join(' ')}`).includes(query));
  });

  const navigate = (next: Tab) => { setTab(next); if (next !== 'inventory') setEditItem(null); };

  return <div className="bolt-admin ba-shell">
    <aside className="ba-sidebar">
      <Brand />
      <nav aria-label="BOLT Admin">
        {tabs.map(({ id, title, icon: Icon }) => <button type="button" key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => navigate(id)}>
          <Icon size={18} strokeWidth={1.8} aria-hidden="true" /><span>{title}</span>
          {id === 'orders' && pending.length > 0 && <small>{number.format(pending.length)}</small>}
        </button>)}
      </nav>
      <div className="ba-sidebar-foot"><a href="/operacion"><ArrowLeft size={16} /> Panel anterior</a></div>
    </aside>

    <div className="ba-main">
      <header className="ba-topbar">
        <div className="ba-context"><span>Operación</span><ChevronRight size={14} aria-hidden="true" /><strong>{tabs.find(item => item.id === tab)?.title}</strong>
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
        {(sessionError || actionError) && <p className="ba-error" role="alert"><CircleAlert size={16} />{sessionError || actionError}</p>}

        {tab === 'home' && <>
          <section className="ba-hero">
            <div><span className="ba-hero-site"><Store size={15} />{store?.name || 'Sin sede asignada'}</span>
              <h1>Operación de la sede</h1><p>Consulta los pedidos por atender y el inventario disponible.</p></div>
            {canCreateDemoOrder ? <button type="button" className="ba-btn ba-btn-primary" disabled={fixtureBusy} onClick={() => void createDemoOrder()}>
              {fixtureBusy ? <LoaderCircle size={18} className="ba-spin" /> : <Plus size={18} />} Crear pedido de prueba
            </button> : store && <button type="button" className="ba-btn ba-btn-hero" onClick={() => navigate('orders')}>Ver pedidos <ArrowUpRight size={16} /></button>}
          </section>
          {isDemo && <p className="ba-demo-note"><FlaskConical size={16} /> Esta demo usa pedidos e inventario de prueba. No genera cobros.</p>}
          <div className="ba-metrics">
            <Metric label="Pendientes de confirmar" value={orders && !ordersError ? pending.length : null} icon={<Clock3 size={18} />} tone="amber" onClick={() => { setOrderStatus('PENDIENTE_CONFIRMACION'); navigate('orders'); }} />
            <Metric label="Pedidos en operación" value={orders && !ordersError ? active.length : null} icon={<ClipboardList size={18} />} onClick={() => { setOrderStatus('active'); navigate('orders'); }} />
            <Metric label="Presentaciones registradas" value={inventory && !inventoryError && !inventoryQuery ? inventory.total : null} icon={<Box size={18} />} onClick={() => navigate('inventory')} />
          </div>
          <section className="ba-panel">
            <div className="ba-panel-head"><div><h2>Pendientes de confirmar</h2><p>Solicitudes que necesitan una propuesta de entrega.</p></div><button type="button" className="ba-btn ba-btn-secondary" onClick={() => { setOrderStatus('PENDIENTE_CONFIRMACION'); navigate('orders'); }}>Ver pedidos <ArrowRight size={15} /></button></div>
            {ordersError ? <FetchError message={ordersError} refresh={refresh} /> : pending.length > 0 ? <OrderRows orders={pending.slice(0, 5)} selected="" onSelect={viewOrder} />
              : orders ? <Empty icon={<ClipboardList size={23} />} title="Sin solicitudes pendientes" text={canCreateDemoOrder ? 'Crea un pedido de prueba para recorrer la confirmación.' : 'Cuando lleguen solicitudes a esta sede, aparecerán aquí.'} />
              : <Loading text="Consultando pedidos…" />}
          </section>
        </>}

        {tab === 'orders' && <>
          <PageHeading title="Pedidos" text={store?.name || 'Sin sede asignada'}>
            <button type="button" className="ba-btn ba-btn-secondary" onClick={refresh}><RefreshCw size={16} /> Actualizar</button>
            {canCreateDemoOrder && <div className="ba-demo-order-actions">
              <label className="ba-field ba-demo-order-mode">Modalidad de prueba
                <select value={demoOrderMode} disabled={fixtureBusy} onChange={event => setDemoOrderMode(event.target.value === 'TURBO' ? 'TURBO' : 'PROGRAMADO')}>
                  <option value="PROGRAMADO">Programado</option><option value="TURBO">Turbo</option>
                </select>
              </label>
              <button type="button" className="ba-btn ba-btn-primary" disabled={fixtureBusy} onClick={() => void createDemoOrder(demoOrderMode)}>
                {fixtureBusy ? <LoaderCircle size={17} className="ba-spin" /> : <Plus size={17} />} Crear pedido de prueba</button>
            </div>}
          </PageHeading>
          <div className={`ba-order-layout${detail ? ' ba-order-layout-detail' : ''}`}>
            <section className="ba-panel">
              <div className="ba-filters">
                <SearchBox label="Buscar por pedido o producto" value={orderSearch} change={setOrderSearch} />
                <label className="ba-field ba-filter-select"><span className="ba-sr">Estado del pedido</span>
                  <select value={orderStatus} onChange={event => setOrderStatus(event.target.value)}><option value="all">Todos los estados</option><option value="active">En operación</option>
                    {Object.entries(statusLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
              </div>
              {ordersError ? <FetchError message={ordersError} refresh={refresh} /> : !visibleOrders ? <Loading text="Consultando pedidos…" />
                : visibleOrders.length === 0 ? <Empty icon={<ClipboardList size={23} />} title="Sin pedidos en esta vista" text="Prueba otro estado o cambia la búsqueda." />
                : <OrderRows orders={visibleOrders} selected={selectedOrder} onSelect={viewOrder} />}
            </section>
            {detail && <OrderDetail key={detail.id} order={detail} trackingPath={demoTrackingPath} token={token} actor={actor} isDemo={isDemo}
              close={() => setSelectedOrder('')} changed={(result, message) => {
                if (result.storeId !== activeStore.current) return;
                setOrders(prev => prev?.map(item => item.id === result.id ? result : item) ?? [result]);
                setOrderStatus('all'); setNotice(message); refresh();
              }} />}
          </div>
        </>}

        {tab === 'inventory' && <>
          <PageHeading title="Inventario" text={`${store?.name || 'Sin sede asignada'} · Existencias, reservas y disponibilidad por presentación`}>
            <button type="button" className="ba-btn ba-btn-secondary" onClick={refresh}><RefreshCw size={16} /> Actualizar</button>
          </PageHeading>
          <section className="ba-panel">
            <div className="ba-filters"><SearchBox label="Buscar por SKU, producto o presentación" value={inventorySearch} change={setInventorySearch} /></div>
            {inventoryError ? <FetchError message={inventoryError} refresh={refresh} /> : !inventory ? <Loading text="Consultando inventario…" />
              : inventory.items.length === 0 ? <Empty icon={<PackageSearch size={24} />} title="Sin resultados de inventario" text="Revisa la búsqueda o la sede seleccionada." />
              : <>
                <div className="ba-table-scroll"><table className="ba-table ba-stock"><thead><tr>
                  <th scope="col">Producto / SKU</th><th scope="col">Existencias</th><th scope="col">Reservadas</th><th scope="col">Disponibles</th><th scope="col">Último conteo</th>{actor.canAdjustInventory && <th scope="col"><span className="ba-sr">Acción</span></th>}
                </tr></thead><tbody>
                  {inventory.items.map(item => <tr key={`${item.productId}:${item.variantId}`}>
                    <th scope="row"><strong>{item.name}</strong><small>{[item.presentation, item.sku].filter(Boolean).join(' · ')}</small></th>
                    <td>{number.format(item.stock)}</td><td>{number.format(item.reserved)}</td>
                    <td><span className={`ba-stock-value ${item.available === 0 ? 'ba-stock-none' : ''}`}>{number.format(item.available)}</span></td>
                    <td className="ba-dim">{item.countedAt ? timeLabel(item.countedAt) : 'Sin registro'}</td>
                    {actor.canAdjustInventory && <td><button type="button" className="ba-btn ba-btn-secondary ba-compact" aria-label={`Ajustar inventario de ${item.name}`} onClick={() => setEditItem(item)}>Ajustar</button></td>}
                  </tr>)}
                </tbody></table></div>
                <div className="ba-pagination"><span>{number.format(inventoryPageStart)}–{number.format(inventory.offset + inventory.items.length)} de {number.format(inventory.total)}</span><div>
                  <button className="ba-icon-btn" type="button" aria-label="Página anterior" disabled={offset === 0} onClick={() => { setEditItem(null); setOffset(Math.max(0, offset - inventory.limit)); }}><ChevronLeft size={18} /></button>
                  <button className="ba-icon-btn" type="button" aria-label="Página siguiente" disabled={inventory.offset + inventory.items.length >= inventory.total} onClick={() => { setEditItem(null); setOffset(offset + inventory.limit); }}><ChevronRight size={18} /></button>
                </div></div>
              </>}
          </section>
          {editItem && actor.canAdjustInventory && <InventoryEditor key={`${editItem.productId}:${editItem.variantId}:${editItem.revision}`} item={editItem} token={token}
            close={() => setEditItem(null)} saved={() => { setEditItem(null); setNotice('Ajuste registrado con su motivo y responsable.'); refresh(); }} />}
        </>}

        {tab === 'permissions' && <>
          <PageHeading title="Permisos" text="Consulta el acceso de tu perfil." />
          <section className="ba-panel ba-permissions">
            <div className="ba-panel-head"><div><h2>{actor.name}</h2><p>{roleLabel(actor)}</p></div><span className="ba-status ba-status-success"><ShieldCheck size={14} /> Sesión activa</span></div>
            <dl><div><dt>Sedes autorizadas</dt><dd>{session.stores.map(item => item.name).join(' · ') || 'Sin sede asignada'}</dd></div>
              <div><dt>Consultar pedidos e inventario</dt><dd>Autorizado en sus sedes</dd></div>
              <div><dt>Confirmar entregas</dt><dd>{actor.canConfirm ? 'Autorizado en sus sedes' : 'Sin permiso'}</dd></div>
              <div><dt>Ajustar existencias</dt><dd>{actor.canAdjustInventory ? 'Autorizado en sus sedes' : 'Sin permiso'}</dd></div>
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

function Loading({ text }: { text: string }) {
  return <p className="ba-loading" role="status"><LoaderCircle size={18} className="ba-spin" aria-hidden="true" />{text}</p>;
}

function FetchError({ message, refresh }: { message: string; refresh: () => void }) {
  return <div className="ba-fetch-error"><p className="ba-error" role="alert"><CircleAlert size={16} />{message}</p><button className="ba-btn ba-btn-secondary" onClick={refresh} type="button">Reintentar</button></div>;
}

function OrderRows({ orders, selected, onSelect }: { orders: AdminOrder[]; selected: string; onSelect: (id: string) => void }) {
  return <div className="ba-table-scroll"><table className="ba-table"><thead><tr><th scope="col">Pedido</th><th scope="col">Estado</th><th scope="col">Productos</th><th scope="col"><span className="ba-sr">Detalle</span></th></tr></thead><tbody>
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
        <td><button type="button" className="ba-icon-btn" aria-label={`Ver pedido ${orderLabel(order)}`} onClick={() => onSelect(order.id)}><ChevronRight size={19} /></button></td>
      </tr>;
    })}
  </tbody></table></div>;
}

function OrderDetail({ order, trackingPath, token, actor, isDemo, close, changed }: {
  order: AdminOrder; trackingPath?: string; token: string | null; actor: AdminActor; isDemo: boolean;
  close: () => void; changed: (order: AdminOrder, message: string) => void;
}) {
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 1050px)').matches) heading.current?.scrollIntoView({ block: 'start' });
  }, []);
  const prepare = async () => {
    if (preparing) return;
    setPreparing(true); setError('');
    try {
      const result = await boltAdmin.startPreparation(token, order.id);
      changed(result, 'Alistamiento iniciado. El pedido está en preparación.');
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
      <section className="ba-order-items"><h3>Productos</h3><ul>{order.items.map(item => <li key={item.productId}><span>{item.name}<small>{item.presentation}</small></span><strong>×{number.format(item.quantity)}</strong></li>)}</ul>
        <div><span>{isPending(order) ? 'Subtotal de productos' : 'Total del pedido'}</span><strong>{formatCOP(isPending(order) ? order.totals.subtotal : order.totals.total)}</strong></div>
      </section>
      {isPending(order) && (actor.canConfirm ? <DeliveryReviewPanel order={order} token={token} isDemo={isDemo}
        onConfirmed={result => changed(result, 'Entrega confirmada. Puedes consultar el nuevo estado del pedido.')} />
        : <p className="ba-info"><ShieldCheck size={16} /> Tu perfil no puede confirmar entregas.</p>)}
      {actor.canConfirm && order.fulfillmentStatus === 'CONFIRMADO' && order.isSplitOrder !== true && <button type="button" className="ba-btn ba-btn-primary" disabled={preparing} onClick={() => void prepare()}>
        {preparing ? <LoaderCircle size={16} className="ba-spin" /> : <Box size={16} />} Iniciar alistamiento
      </button>}
      {error && <p className="ba-error" role="alert"><CircleAlert size={16} />{error}</p>}
      {!!order.statusHistory?.length && <details className="ba-order-history"><summary>Historial del pedido</summary>
        <ul>{[...order.statusHistory].reverse().map((item, index) => <li key={`${item.timestamp}:${index}`}>
          <span>{statusLabels[item.newStatus] || item.newStatus}</span><small>{timeLabel(item.timestamp)}{item.actor?.name && ` · ${item.actor.name}`}</small>
        </li>)}</ul></details>}
      {trackingPath && <a href={trackingPath} target="_blank" rel="noopener" className="ba-btn ba-btn-secondary">Ver seguimiento del cliente <ArrowUpRight size={16} /></a>}
    </div>
  </section>;
}

function InventoryEditor({ item, token, close, saved }: { item: InventoryItem; token: string | null; close: () => void; saved: () => void }) {
  const [stock, setStock] = useState(String(item.stock));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: 'center' }); }, []);
  const quantity = Number(stock);
  const valid = stock.trim() !== '' && Number.isSafeInteger(quantity) && quantity >= item.reserved && quantity !== item.stock && reason.trim().length >= 5;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setError('');
    try { await boltAdmin.adjustInventory(token, item, quantity, reason.trim()); saved(); }
    catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  return <section className="ba-panel ba-editor" aria-label="Ajustar inventario">
    <div className="ba-panel-head"><div><h2 ref={heading} tabIndex={-1}>Ajustar existencias</h2><p>{item.name} · {item.presentation}</p></div><button className="ba-icon-btn" type="button" aria-label="Cerrar ajuste" onClick={close} disabled={busy}><X size={19} /></button></div>
    <form onSubmit={event => void submit(event)}>
      <p className="ba-info">Existencias registradas: {number.format(item.stock)} · Reservadas: {number.format(item.reserved)}</p>
      <label className="ba-field">Nueva existencia<input type="number" value={stock} min={item.reserved} step="1" required onChange={event => setStock(event.target.value)} /></label>
      <label className="ba-field">Motivo del ajuste<input value={reason} onChange={event => setReason(event.target.value)} required minLength={5} maxLength={240} placeholder="Describe qué originó el ajuste" /></label>
      {error && <p className="ba-error" role="alert"><CircleAlert size={16} />{error}</p>}
      <button type="submit" disabled={!valid || busy} className="ba-btn ba-btn-primary">{busy ? 'Guardando…' : 'Guardar ajuste'}</button>
    </form>
  </section>;
}
