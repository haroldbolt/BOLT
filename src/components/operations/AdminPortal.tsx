import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bell, Boxes, ChevronLeft, ChevronRight, ClipboardList, Home, KeyRound, LogOut, Package, Plus, RefreshCw, Search, ShieldCheck, Tag, Truck, X, Zap } from 'lucide-react';
import type { FulfillmentStatus, Order, Store } from '../../types';
import type { AdminProduct, AdminPromotion, AdminSession, InventoryMovement } from '../../types/admin';
import { adminApi, adminRequest, setAdminCsrfToken } from '../../lib/adminApi';
import { formatCOP } from '../../lib/formatters';
import { groupScheduledOrders, scheduledOrderLocality, scheduledOrderWindow } from '../../lib/deliverySelection';
import { OperationsDashboard } from './OperationsDashboard';
import { OrderTotals } from './OrderTotals';
import { NEW_ORDER_DELIVERY_OPTIONS } from '../../lib/checkoutPolicy';
import './admin.css';

type Tab = 'inicio' | 'pedidos' | 'productos' | 'inventario' | 'promociones' | 'operacion';
const navigation: Array<{ id: Tab; title: string; icon: typeof Home }> = [
  { id: 'inicio', title: 'Inicio', icon: Home }, { id: 'pedidos', title: 'Pedidos', icon: ClipboardList },
  { id: 'productos', title: 'Productos', icon: Package }, { id: 'inventario', title: 'Inventario', icon: Boxes },
  { id: 'promociones', title: 'Promociones', icon: Tag }, { id: 'operacion', title: 'Despacho y GPS', icon: Truck },
];
const message = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación.';
const dateTime = (value: string) => new Date(value).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' });
const humanStatus = (value: string) => value.replaceAll('_', ' ').toLowerCase();
const receptionInstruction = (policy: Order['deliveryAddress']['porteriaPolicy']) =>
  NEW_ORDER_DELIVERY_OPTIONS.find(option => option.value === policy)?.label ||
  (policy === 'SUBIR_A_PUERTA' ? 'Subir al apartamento' : 'Instrucción guardada no disponible');
const orderStatuses: FulfillmentStatus[] = ['PENDIENTE_CONFIRMACION', 'CONFIRMADO', 'EN_ALISTAMIENTO', 'LISTO_PARA_DESPACHO', 'REPARTIDOR_ASIGNADO', 'EN_CAMINO', 'ENTREGADO', 'CON_INCIDENCIA', 'CANCELADO'];
const nextStatus: Partial<Record<FulfillmentStatus, FulfillmentStatus>> = { PENDIENTE_CONFIRMACION: 'CONFIRMADO', CONFIRMADO: 'EN_ALISTAMIENTO', EN_ALISTAMIENTO: 'LISTO_PARA_DESPACHO' };
const actionTitle: Partial<Record<FulfillmentStatus, string>> = { PENDIENTE_CONFIRMACION: 'Aceptar pedido', CONFIRMADO: 'Iniciar preparación', EN_ALISTAMIENTO: 'Marcar listo' };

function Notice({ children, danger = false }: { children: React.ReactNode; danger?: boolean }) {
  return <div className={`ba-notice ${danger ? 'ba-danger' : ''}`} role={danger ? 'alert' : 'status'}>{children}</div>;
}
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]') || []);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className="ba-overlay"><div className="ba-dialog" role="dialog" aria-modal="true" aria-label={title} ref={dialog} tabIndex={-1}>
    <div className="ba-dialog-head"><h2>{title}</h2><button className="ba-icon" onClick={onClose} aria-label="Cerrar"><X size={20}/></button></div>{children}
  </div></div>;
}

export function AdminPortal({ onBackToCustomer, onViewOrderTracking }: { onBackToCustomer: () => void; onViewOrderTracking: (id: string) => void }) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);
  const check = useCallback(() => {
    setChecking(true); setError('');
    adminApi.session().then(setSession).catch(e => setError(message(e))).finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    check();
    const expired = () => { setAdminCsrfToken(); setSession({ authenticated: false, setupRequired: false }); setError('Tu sesión terminó. Vuelve a ingresar.'); };
    window.addEventListener('bolt-admin-session-expired', expired);
    return () => window.removeEventListener('bolt-admin-session-expired', expired);
  }, [check]);
  if (session?.authenticated) return <AdminShell session={session} onSession={setSession} onBack={onBackToCustomer} onTrack={onViewOrderTracking}/>;
  return <div className="bolt-admin ba-login-page">
    <button className="ba-btn ba-login-back" onClick={onBackToCustomer}><ArrowLeft size={16}/> Volver a la tienda</button>
    <div className="ba-login-card"><div className="ba-brand"><Zap fill="#FFD83D" stroke="#D1A900"/><strong>Bolt Pets</strong></div>
      <div className="ba-login-mark"><ShieldCheck size={28}/></div><h1>Administra tu tienda</h1><p className="ba-muted">Productos, bodegas y pedidos en un solo lugar.</p>
      {checking ? <p className="ba-loading">Comprobando acceso…</p> : <>
        {error && <Notice danger>{error}</Notice>}
        {session?.setupRequired ? <Notice>Primero crea tu cuenta administrativa en este equipo con <strong>Crear administrador.cmd</strong>, dentro de la carpeta del proyecto. Tus credenciales no se comparten con el chat. Después pulsa «Comprobar acceso».</Notice> : <LoginForm onLogin={setSession} onError={setError}/>}
        {(!session || session.setupRequired) && <button className="ba-btn" onClick={check}><RefreshCw size={16}/> Comprobar acceso</button>}
      </>}
      <small>Acceso privado para el equipo de Bolt Pets</small>
    </div>
  </div>;
}
function LoginForm({ onLogin, onError }: { onLogin: (s: AdminSession) => void; onError: (s: string) => void }) {
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false);
  return <form className="ba-form" onSubmit={async event => {
    event.preventDefault(); setBusy(true); onError('');
    try { onLogin(await adminApi.login(username.trim(), password)); setPassword(''); } catch (e) { onError(message(e)); } finally { setBusy(false); }
  }}>
    <label>Usuario<input autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)}/></label>
    <label>Contraseña<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/></label>
    <button className="ba-btn ba-primary" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
  </form>;
}

function AdminShell({ session, onSession, onBack, onTrack }: { session: AdminSession; onSession: (s: AdminSession) => void; onBack: () => void; onTrack: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>('inicio'), [orders, setOrders] = useState<Order[]>([]), [stores, setStores] = useState<Store[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(true), [online, setOnline] = useState(false), [revision, setRevision] = useState(0), [passwordOpen, setPasswordOpen] = useState(false);
  const [sound, setSound] = useState(false), [newNotice, setNewNotice] = useState('');
  const known = useRef<Set<string> | null>(null), soundRef = useRef(false), audio = useRef<AudioContext | null>(null);
  const load = useCallback(async () => {
    try {
      const incoming = await adminRequest<Order[]>('/api/v1/orders');
      const additions = known.current ? incoming.filter(o => !known.current!.has(o.id)) : [];
      known.current = new Set(incoming.map(o => o.id));
      if (additions.length) {
        setNewNotice(`${additions.length === 1 ? 'Llegó un pedido nuevo' : `Llegaron ${additions.length} pedidos nuevos`}.`);
        if (soundRef.current && audio.current) {
          const oscillator = audio.current.createOscillator(), gain = audio.current.createGain();
          oscillator.connect(gain); gain.connect(audio.current.destination); oscillator.frequency.value = 660;
          gain.gain.setValueAtTime(0.06, audio.current.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, audio.current.currentTime + .35);
          oscillator.start(); oscillator.stop(audio.current.currentTime + .35);
        }
      }
      setOrders(incoming); setError('');
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }, []);
  useEffect(() => {
    load(); adminRequest<Store[]>('/api/v1/stores').then(setStores).catch(e => setError(message(e)));
    const stream = new EventSource('/api/v1/admin/events');
    stream.onopen = () => { setOnline(true); load(); setRevision(v => v + 1); };
    stream.onerror = () => setOnline(false);
    const orderEvent = () => load();
    const catalogEvent = () => setRevision(v => v + 1);
    stream.addEventListener('orders', orderEvent); stream.addEventListener('catalog', catalogEvent); stream.addEventListener('promotions', catalogEvent);
    // Reconsulta también al volver de una pestaña suspendida y como respaldo de los eventos.
    const timer = window.setInterval(load, 15000);
    const visible = () => { if (!document.hidden) { load(); setRevision(v => v + 1); } };
    document.addEventListener('visibilitychange', visible);
    return () => { stream.close(); window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); audio.current?.close(); };
  }, [load]);
  const change = () => { setRevision(v => v + 1); load(); };
  return <div className="bolt-admin ba-shell">
    <aside className="ba-sidebar"><div className="ba-brand"><Zap fill="#FFD83D" stroke="#D1A900"/><strong>Bolt Pets</strong><span>Admin</span></div>
      <nav aria-label="Administración">{navigation.map(item => <button key={item.id} className={tab === item.id ? 'ba-nav-active' : ''} onClick={() => setTab(item.id)}><item.icon size={19}/>{item.title}{item.id === 'pedidos' && orders.some(o => o.fulfillmentStatus === 'PENDIENTE_CONFIRMACION') && <b>{orders.filter(o => o.fulfillmentStatus === 'PENDIENTE_CONFIRMACION').length}</b>}</button>)}</nav>
      <button className="ba-store-link" onClick={onBack}><ArrowLeft size={16}/> Ver tienda</button>
    </aside>
    <div className="ba-workspace"><header className="ba-topbar"><span className={`ba-connection ${online ? 'is-online' : ''}`}><i/>{online ? 'Actualización en vivo' : 'Reconectando · consulta de respaldo activa'}</span>
      <div className="ba-account"><span>{session.user?.displayName || session.user?.username}</span><button className="ba-icon" aria-label="Cambiar contraseña" title="Cambiar contraseña" onClick={() => setPasswordOpen(true)}><KeyRound size={18}/></button><button className="ba-btn" onClick={async () => { try { await adminApi.logout(); onSession({ authenticated: false, setupRequired: false }); } catch (e) { setError(message(e)); } }}><LogOut size={16}/><span>Salir</span></button></div>
    </header>
    <main className={`ba-main ${tab === 'operacion' ? 'ba-legacy' : ''}`}>
      {error && <Notice danger>{error} <button className="ba-link" onClick={load}>Reintentar</button></Notice>}
      {newNotice && <Notice><Bell size={16}/>{newNotice}<button className="ba-link" onClick={() => { setTab('pedidos'); setNewNotice(''); }}>Ver pedidos</button><button className="ba-icon" aria-label="Cerrar aviso" onClick={() => setNewNotice('')}><X size={16}/></button></Notice>}
      {tab === 'inicio' && <><div className="ba-page-head"><div><p className="ba-eyebrow">TU CENTRO DE OPERACIONES</p><h1>Hola, {session.user?.displayName || session.user?.username}</h1><p className="ba-muted">Todo lo que necesita tu tienda para preparar la próxima entrega.</p></div><button className="ba-btn" onClick={load}><RefreshCw size={16}/>Actualizar</button></div>
        <div className="ba-stats">{[['Por confirmar', orders.filter(o => o.fulfillmentStatus === 'PENDIENTE_CONFIRMACION').length], ['En preparación', orders.filter(o => ['CONFIRMADO', 'EN_ALISTAMIENTO', 'LISTO_PARA_DESPACHO'].includes(o.fulfillmentStatus)).length], ['En reparto', orders.filter(o => ['REPARTIDOR_ASIGNADO', 'EN_CAMINO'].includes(o.fulfillmentStatus)).length], ['Bodegas activas', stores.filter(s => s.isActive).length]].map(([label, value]) => <div className="ba-card ba-stat" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
        <div className="ba-card ba-welcome"><div><Zap size={30} fill="#FFD83D" stroke="#D1A900"/><h2>De tu tienda a su puerta</h2><p>Gestiona productos y existencias por bodega. Cada pedido conserva su historial y sus envíos.</p></div><button className="ba-btn ba-primary" onClick={() => setTab('pedidos')}>Revisar pedidos</button></div>
        <div className="ba-page-head"><h2>Pedidos recientes</h2><button className="ba-link" onClick={() => setTab('pedidos')}>Ver todos</button></div><OrdersTable orders={orders.slice(0, 8)} stores={stores} busy={busy} onTrack={onTrack} onRefresh={load}/>
      </>}
      {tab === 'pedidos' && <><div className="ba-page-head"><div><h1>Pedidos</h1><p className="ba-muted">Pedidos de esta instalación, actualizados mientras el panel está abierto.</p></div><button className={`ba-btn ${sound ? 'ba-toggled' : ''}`} onClick={async () => {
        if (!sound) { try { audio.current ||= new AudioContext(); await audio.current.resume(); } catch { setError('El navegador no permitió activar el sonido.'); return; } }
        soundRef.current = !sound; setSound(!sound);
      }}><Bell size={16}/>{sound ? 'Sonido activado' : 'Activar sonido'}</button></div><OrdersTable orders={orders} stores={stores} busy={busy} onTrack={onTrack} onRefresh={load}/></>}
      {tab === 'productos' && <ProductsPanel stores={stores} revision={revision} onChange={change}/>}
      {tab === 'inventario' && <ProductsPanel stores={stores} revision={revision} onChange={change} inventory/>}
      {tab === 'promociones' && <PromotionsPanel stores={stores} revision={revision} onChange={change}/>}
      {tab === 'operacion' && <OperationsDashboard onBackToCustomer={() => setTab('inicio')} onViewOrderTracking={onTrack}/>}
    </main></div>
    {passwordOpen && <PasswordDialog onClose={() => setPasswordOpen(false)} onSession={onSession}/>}
  </div>;
}

function PasswordDialog({ onClose, onSession }: { onClose: () => void; onSession: (s: AdminSession) => void }) {
  const [currentPassword, setCurrent] = useState(''), [newPassword, setNew] = useState(''), [confirmation, setConfirmation] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [success, setSuccess] = useState(false);
  return <Dialog title="Cambiar contraseña" onClose={onClose}><form className="ba-form ba-dialog-body" onSubmit={async e => {
    e.preventDefault(); if (newPassword !== confirmation) { setError('Las contraseñas nuevas no coinciden.'); return; } setBusy(true); setError('');
    try { await adminRequest('/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }); const updated = await adminApi.session(); onSession(updated); setSuccess(true); setCurrent(''); setNew(''); setConfirmation(''); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }}>{error && <Notice danger>{error}</Notice>}{success ? <Notice>Contraseña actualizada.</Notice> : <>
    <label>Contraseña actual<input type="password" autoComplete="current-password" required value={currentPassword} onChange={e => setCurrent(e.target.value)}/></label>
    <label>Nueva contraseña<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={newPassword} onChange={e => setNew(e.target.value)}/><small>Usa al menos 12 caracteres. Al cambiarla se cerrarán las sesiones; deberás ingresar nuevamente.</small></label>
    <label>Repetir nueva contraseña<input type="password" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)}/></label>
    <button className="ba-btn ba-primary" disabled={busy}>{busy ? 'Guardando…' : 'Cambiar contraseña'}</button></>}</form></Dialog>;
}

function OrdersTable({ orders, stores, busy, onTrack, onRefresh }: { orders: Order[]; stores: Store[]; busy: boolean; onTrack: (id: string) => void; onRefresh: () => Promise<void> }) {
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [store, setStore] = useState(''), [mode, setMode] = useState(''), [date, setDate] = useState(''), [selected, setSelected] = useState<string | null>(null), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const [locality, setLocality] = useState(''), [windowFilter, setWindowFilter] = useState('');
  const localities = [...new Map(orders.filter(o => o.deliveryMode === 'PROGRAMADO').map(o => {
    const found = scheduledOrderLocality(o); return [found.code, found] as const;
  })).values()].sort((a, b) => a.name.localeCompare(b.name));
  const windows = [...new Map(orders.filter(o => o.deliveryMode === 'PROGRAMADO').map(o => {
    const found = scheduledOrderWindow(o); return [found.id, found] as const;
  })).values()].sort((a, b) => a.name.localeCompare(b.name));
  const filtered = orders.filter(o => (!status || o.fulfillmentStatus === status) && (!store || o.storeId === store) && (!mode || o.deliveryMode === mode) &&
    (!date || (o.deliveryMode === 'PROGRAMADO' ? o.scheduledWindow?.date : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(o.createdAt))) === date) &&
    (!locality || o.deliveryMode === 'PROGRAMADO' && scheduledOrderLocality(o).code === locality) &&
    (!windowFilter || o.deliveryMode === 'PROGRAMADO' && scheduledOrderWindow(o).id === windowFilter) &&
    (!query || `${o.orderNumber} ${o.customer.name} ${o.customer.phone}`.toLowerCase().includes(query.toLowerCase())));
  const scheduledGroups = groupScheduledOrders(filtered);
  const order = orders.find(o => o.id === selected);
  async function transition(target: FulfillmentStatus) {
    if (!order) return;
    const reason = target === 'CANCELADO' ? window.prompt('Motivo de cancelación (obligatorio):') : undefined;
    if (target === 'CANCELADO' && !reason?.trim()) return;
    setSaving(true); setError('');
    try { await adminRequest(`/api/v1/operations/orders/${encodeURIComponent(order.id)}/status`, { method: 'POST', body: JSON.stringify({ status: target, reason }) }); await onRefresh(); } catch (e) { setError(message(e)); } finally { setSaving(false); }
  }
  return <><div className="ba-card"><div className="ba-toolbar"><label className="ba-search"><Search size={17}/><input aria-label="Buscar pedidos" placeholder="Buscar pedido o cliente" value={query} onChange={e => setQuery(e.target.value)}/></label><select aria-label="Estado del pedido" value={status} onChange={e => setStatus(e.target.value)}><option value="">Todos los estados</option>{orderStatuses.map(s => <option key={s} value={s}>{humanStatus(s)}</option>)}</select><select aria-label="Bodega del pedido" value={store} onChange={e => setStore(e.target.value)}><option value="">Todas las bodegas</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><select aria-label="Modalidad de entrega" value={mode} onChange={e => { setMode(e.target.value); if (e.target.value !== 'PROGRAMADO') { setLocality(''); setWindowFilter(''); } }}><option value="">Todas las entregas</option><option value="TURBO">Turbo</option><option value="TURBO_DIVIDIDO">Turbo dividido</option><option value="PROGRAMADO">Programado</option></select><input aria-label="Fecha de entrega programada o creación del pedido" title="Para Programado se filtra por fecha de entrega; para otras modalidades, por creación en Bogotá." type="date" value={date} onChange={e => setDate(e.target.value)}/><select aria-label="Localidad del envío programado" value={locality} onChange={e => { setLocality(e.target.value); if (e.target.value) setMode('PROGRAMADO'); }}><option value="">Todas las localidades</option>{localities.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select><select aria-label="Franja del envío programado" value={windowFilter} onChange={e => { setWindowFilter(e.target.value); if (e.target.value) setMode('PROGRAMADO'); }}><option value="">Todas las franjas</option>{windows.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
    {mode === 'PROGRAMADO' && <div className="ba-scheduled-note">Los carritos con inventario pendiente de validar todavía no son pedidos. Revisa las existencias de cada sede en Inventario.</div>}
    {!!scheduledGroups.length && <section className="ba-scheduled-groups" aria-label="Preparación de envíos programados"><h3>Programados por preparar y entregar</h3><p className="ba-muted ba-small">Agrupados por bodega, fecha, franja y localidad. Los pedidos entregados y cancelados no participan en estos grupos.</p><div className="ba-table-scroll"><table><thead><tr><th>Bodega</th><th>Fecha</th><th>Franja</th><th>Localidad</th><th>Asignación</th><th>Pedidos</th></tr></thead><tbody>{scheduledGroups.map(group => <tr key={group.key}><td>{group.storeName}</td><td>{group.date}</td><td>{group.window}</td><td>{group.locality}</td><td><span className={`ba-badge ${group.status === 'Confirmada' ? 'ba-green' : 'ba-gray'}`}>{group.status}</span></td><td><strong>{group.count}</strong></td></tr>)}</tbody></table></div></section>}
    <div className="ba-table-scroll"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Bodega</th><th>Entrega programada</th><th>Estado</th><th>Pago</th><th>Total</th></tr></thead><tbody>{filtered.map(o => <tr key={o.id}><td><button className="ba-link" onClick={() => { setSelected(o.id); setError(''); }}>{o.orderNumber}</button><small>{dateTime(o.createdAt)}</small></td><td>{o.customer.name}</td><td>{o.storeName}<small>{o.deliveryMode && humanStatus(o.deliveryMode)}</small></td><td>{o.deliveryMode === 'PROGRAMADO' ? <>{scheduledOrderLocality(o).name}<small>{o.scheduledWindow?.date || 'Sin fecha guardada'} · {scheduledOrderWindow(o).name}</small><small>{o.scheduledDispatch?.status === 'CONFIRMADA' ? 'Asignación confirmada' : 'Histórico / sin clasificación'}</small></> : '—'}</td><td><span className={`ba-badge ${o.fulfillmentStatus === 'ENTREGADO' ? 'ba-green' : o.fulfillmentStatus === 'CANCELADO' ? 'ba-gray' : 'ba-amber'}`}>{humanStatus(o.fulfillmentStatus)}</span></td><td>{humanStatus(o.payment.status)}</td><td>{formatCOP(o.totals.total)}</td></tr>)}</tbody></table></div>{!filtered.length && <p className="ba-empty">{busy ? 'Cargando pedidos…' : 'No hay pedidos que coincidan con los filtros.'}</p>}
  </div>{order && <Dialog title={`Pedido ${order.orderNumber}`} onClose={() => setSelected(null)}><div className="ba-dialog-body">
    {error && <Notice danger>{error}</Notice>}<div className="ba-detail-grid"><section><h3>Cliente</h3><p>{order.customer.name}</p><a href={`tel:${order.customer.phone}`}>{order.customer.phone}</a><p>{order.deliveryAddress.address}</p><p className="ba-muted">{order.deliveryAddress.details}</p></section><section><h3>Entrega</h3><p>{order.storeName}</p><p>{order.deliveryMode && humanStatus(order.deliveryMode)}</p><p>Recepción: {receptionInstruction(order.deliveryAddress.porteriaPolicy)}</p>{order.scheduledWindow && <p>{order.scheduledWindow.date} · {order.scheduledWindow.displayWindow}</p>}{order.deliveryMode === 'PROGRAMADO' && <><p>Localidad: {scheduledOrderLocality(order).name}</p><p className="ba-muted">{order.scheduledDispatch?.status === 'CONFIRMADA' ? 'Bodega confirmada para este pedido' : 'Se conserva la bodega histórica; este pedido no fue reclasificado.'}</p></>}<span className="ba-badge ba-amber">{humanStatus(order.fulfillmentStatus)}</span><p>Pago: {humanStatus(order.payment.status)}</p></section></div>
    <div className="ba-table-scroll"><table><thead><tr><th>Producto</th><th>Cantidad</th><th>Precio</th></tr></thead><tbody>{order.items.map((i, index) => <tr key={`${i.productId}-${index}`}><td>{i.name}<small>{i.presentation}</small></td><td>{i.quantity}</td><td>{formatCOP(i.price)}</td></tr>)}</tbody></table></div>
    <OrderTotals totals={order.totals}/>
    {!!order.childShipments?.length && <section><h3>Envíos independientes</h3>{order.childShipments.map(child => <div className="ba-shipment" key={child.shipmentId}><strong>Envío {child.shipmentIndex} de {child.shipmentCount}</strong><span>{humanStatus(child.fulfillmentStatus)}</span><span>{child.driver?.name || 'Sin repartidor asignado'}</span></div>)}</section>}
    <div className="ba-actions"><button className="ba-btn" onClick={() => onTrack(order.id)}>Ver seguimiento</button>{nextStatus[order.fulfillmentStatus] && <button className="ba-btn ba-primary" disabled={saving} onClick={() => transition(nextStatus[order.fulfillmentStatus]!)}>{actionTitle[order.fulfillmentStatus]}</button>}{!['ENTREGADO', 'CANCELADO'].includes(order.fulfillmentStatus) && <button className="ba-btn ba-destructive" disabled={saving} onClick={() => transition('CANCELADO')}>Cancelar pedido</button>}</div>
    <p className="ba-muted ba-small">La asignación de repartidores y las acciones de cada envío están en Despacho y GPS.</p>
  </div></Dialog>}</>;
}

function ProductsPanel({ stores, revision, onChange, inventory = false }: { stores: Store[]; revision: number; onChange: () => void; inventory?: boolean }) {
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [store, setStore] = useState(''), [page, setPage] = useState(1), [result, setResult] = useState<{ products: AdminProduct[]; total: number; page: number; pageSize: number }>({ products: [], total: 0, page: 1, pageSize: 20 });
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [editor, setEditor] = useState<AdminProduct | 'new' | null>(null), [stockProduct, setStockProduct] = useState<AdminProduct | null>(null), [notice, setNotice] = useState(''), [localRevision, setLocalRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setBusy(true);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ page: String(page), q: query, status, storeId: store });
      adminRequest<typeof result>(`/products?${params}`, { signal: controller.signal }).then(data => { setResult(data); setError(''); }).catch(e => { if (!controller.signal.aborted) setError(message(e)); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, status, store, page, revision, localRevision]);
  const changed = (text: string) => { setNotice(text); setLocalRevision(v => v + 1); onChange(); };
  async function open(product: AdminProduct, stock: boolean) { try { const fresh = await adminApi.product(product.id); if (stock) setStockProduct(fresh); else setEditor(fresh); } catch (e) { setError(message(e)); } }
  return <><div className="ba-page-head"><div><h1>{inventory ? 'Inventario por bodega' : 'Productos'}</h1><p className="ba-muted">{inventory ? 'Registra cantidades verificadas. Las reservas se mantienen separadas.' : 'Conserva tu catálogo y prepara cada presentación para la venta.'}</p></div>{!inventory && <button className="ba-btn ba-primary" onClick={() => setEditor('new')}><Plus size={17}/>Agregar producto</button>}</div>
    {error && <Notice danger>{error}</Notice>}{notice && <Notice>{notice}</Notice>}
    <div className="ba-card"><div className="ba-toolbar"><label className="ba-search"><Search size={17}/><input aria-label="Buscar productos" placeholder="Buscar por nombre, marca o SKU" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }}/></label><select aria-label="Estado del producto" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">Todos los estados</option><option value="ACTIVE">Activos</option><option value="DRAFT">Borradores</option><option value="ARCHIVED">Archivados</option></select><select aria-label="Bodega del producto" value={store} onChange={e => { setStore(e.target.value); setPage(1); }}><option value="">Todas las bodegas</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
    <div className="ba-table-scroll"><table><thead><tr><th>Producto</th><th>Estado</th><th>{inventory ? 'Existencias · principal' : 'Precio base'}</th><th>{inventory ? 'Reservadas · principal' : 'Presentaciones'}</th><th>Acciones</th></tr></thead><tbody>{result.products.map(p => <tr key={p.id}><td><div className="ba-product-cell"><img src={p.image || undefined} alt="" loading="lazy"/><div><button className="ba-link ba-product-name" onClick={() => open(p, inventory)}>{p.name}</button><small>{p.brand} · {p.sku}</small>{p.dataPending?.length > 0 && <span className="ba-pending">Datos de venta pendientes</span>}</div></div></td><td><span className={`ba-badge ${p.status === 'ACTIVE' ? 'ba-green' : 'ba-gray'}`}>{p.status === 'ACTIVE' ? 'Activo' : p.status === 'ARCHIVED' ? 'Archivado' : 'Borrador'}</span></td><td>{inventory ? Object.entries(p.inventoryVerifiedByStore || {}).some(([id, verified]) => verified && (!store || id === store)) ? Object.entries(p.stockByStore || {}).filter(([id]) => !store || id === store).reduce((sum, [, qty]) => sum + qty, 0) : 'Por verificar' : p.price > 0 ? formatCOP(p.price) : 'Pendiente'}</td><td>{inventory ? Object.entries(p.reservedStockByStore || {}).filter(([id]) => !store || id === store).reduce((sum, [, qty]) => sum + qty, 0) : p.presentaciones?.length || 1}</td><td><div className="ba-row-actions"><button className="ba-btn ba-small-btn" onClick={() => open(p, inventory)}>{inventory ? 'Ajustar' : 'Editar'}</button>{!inventory && <button className="ba-link" onClick={async () => {
      const restore = p.status === 'ARCHIVED'; if (!window.confirm(restore ? `¿Reactivar «${p.name}»?` : `¿Archivar «${p.name}»? Se conservarán los pedidos anteriores.`)) return;
      try { await adminApi.archive(p, restore); changed(restore ? 'Producto reactivado.' : 'Producto archivado.'); } catch (e) { setError(message(e)); }
    }}>{p.status === 'ARCHIVED' ? 'Reactivar' : 'Archivar'}</button>}</div></td></tr>)}</tbody></table></div>
    {!result.products.length && <p className="ba-empty">{busy ? 'Cargando productos…' : 'No hay productos que coincidan con los filtros.'}</p>}
    <div className="ba-pagination"><span>{busy ? 'Actualizando…' : `${result.total.toLocaleString('es-CO')} productos`}</span><div><button className="ba-btn ba-icon" aria-label="Página anterior" disabled={page <= 1 || busy} onClick={() => setPage(v => v - 1)}><ChevronLeft size={17}/></button><span>Página {page} de {Math.max(1, Math.ceil(result.total / result.pageSize))}</span><button className="ba-btn ba-icon" aria-label="Página siguiente" disabled={page * result.pageSize >= result.total || busy} onClick={() => setPage(v => v + 1)}><ChevronRight size={17}/></button></div></div></div>
    {inventory && <InventoryHistory revision={revision + localRevision} stores={stores}/>}
    {editor && <ProductEditor product={editor === 'new' ? null : editor} stores={stores} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); changed('Producto guardado.'); }}/>} 
    {stockProduct && <StockEditor product={stockProduct} stores={stores} initialStore={store} onClose={() => setStockProduct(null)} onSaved={() => changed('Ajuste registrado. Las reservas existentes se conservaron.')}/>}
  </>;
}

function blankProduct(): Partial<AdminProduct> {
  return { name: '', brand: '', sku: '', description: '', image: '', category: 'Alimentos', species: 'Ambos', price: 0, weightKg: 0, presentation: 'Unidad', status: 'DRAFT', requiresPrescription: false, temperatureColdChain: false, storageCondition: 'LUGAR_FRESCO_Y_SECO', tags: [], bodegaIds: [], presentaciones: [] };
}
function ProductEditor({ product, stores, onClose, onSaved }: { product: AdminProduct | null; stores: Store[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Partial<AdminProduct>>(() => product ? structuredClone(product) : blankProduct()), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const field = (key: keyof AdminProduct, value: unknown) => setForm(p => ({ ...p, [key]: value }));
  const variantField = (index: number, key: string, value: unknown) => setForm(p => ({ ...p, presentaciones: p.presentaciones?.map((v, i) => i === index ? { ...v, [key]: value } : v) }));
  const toggleStore = (store: Store) => {
    const id = store.shopifyLocationGid || store.id;
    field('bodegaIds', form.bodegaIds?.includes(id) ? form.bodegaIds.filter(v => v !== id && v !== store.id) : [...form.bodegaIds || [], id]);
  };
  return <Dialog title={product ? 'Editar producto' : 'Agregar producto'} onClose={onClose}><form className="ba-form ba-dialog-body" onSubmit={async e => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      const payload: Partial<AdminProduct> = Object.fromEntries(['id', 'version', 'name', 'brand', 'sku', 'description', 'image', 'category', 'species', 'price', 'weightKg', 'presentation', 'status', 'requiresPrescription', 'temperatureColdChain', 'storageCondition', 'bodegaIds', 'pharmacySubcategory', 'activeIngredient', 'concentration', 'pharmaceuticalForm', 'icaRegistration', 'authorizedInfo'].filter(key => key in form).map(key => [key, form[key as keyof AdminProduct]]));
      const variants = form.presentaciones?.map(({ varianteId, nombre, sku, foto, bodegaIds, price, weightKg }, index) => ({ varianteId, nombre, sku, foto, bodegaIds, price: index === 0 ? form.price : price, weightKg: index === 0 ? form.weightKg : weightKg }));
      await adminApi.saveProduct({ ...payload, presentaciones: variants }, !!product); onSaved();
    } catch (e) { setError(message(e)); } finally { setSaving(false); }
  }}>
    {error && <Notice danger>{error}</Notice>}
    <div className="ba-form-grid"><label className="ba-span-2">Nombre<input required maxLength={240} value={form.name || ''} onChange={e => field('name', e.target.value)}/></label><label>Marca<input maxLength={120} value={form.brand || ''} onChange={e => field('brand', e.target.value)}/></label><label>SKU<input required maxLength={120} value={form.sku || ''} onChange={e => field('sku', e.target.value)}/></label>
      <label>Estado<select value={form.status} onChange={e => field('status', e.target.value)}><option value="DRAFT">Borrador</option><option value="ACTIVE">Activo</option><option value="ARCHIVED">Archivado</option></select></label><label>Categoría<select value={form.category} onChange={e => field('category', e.target.value)}>{['Alimentos', 'Perros', 'Gatos', 'Arenas', 'Snacks', 'Farmacia', 'Antipulgas', 'Higiene', 'Accesorios'].map(v => <option key={v}>{v}</option>)}</select></label>
      <label>Especie<select value={form.species} onChange={e => field('species', e.target.value)}>{['Perro', 'Gato', 'Ambos', 'Otros'].map(v => <option key={v}>{v}</option>)}</select></label><label>Presentación base<input value={form.presentation || ''} onChange={e => field('presentation', e.target.value)}/></label><label>Precio base · COP<input type="number" min="0" step="1" value={form.price || ''} placeholder="Pendiente" onChange={e => field('price', e.target.value ? Number(e.target.value) : 0)}/></label><label>Peso base · kg<input type="number" min="0" step="0.001" value={form.weightKg || ''} placeholder="Pendiente" onChange={e => field('weightKg', e.target.value ? Number(e.target.value) : 0)}/></label>
      <label className="ba-span-2">URL de la foto principal<input type="url" placeholder="https://…" value={form.image || ''} onChange={e => field('image', e.target.value)}/></label>{form.image && <img className="ba-photo-preview" src={form.image} alt="Vista previa del producto"/>}
      <label className="ba-span-2">Descripción<textarea rows={4} value={form.description || ''} onChange={e => field('description', e.target.value)}/></label>
      <label className="ba-check"><input type="checkbox" checked={!!form.requiresPrescription} onChange={e => field('requiresPrescription', e.target.checked)}/>Requiere fórmula veterinaria</label>
      <label className="ba-check"><input type="checkbox" checked={!!form.temperatureColdChain} onChange={e => { field('temperatureColdChain', e.target.checked); field('storageCondition', e.target.checked ? 'CADENA_FRIO_2_8' : 'LUGAR_FRESCO_Y_SECO'); }}/>Requiere cadena de frío</label>
    </div>
    {form.category === 'Farmacia' && <fieldset><legend>Información de Farmacia</legend><div className="ba-form-grid"><label>Subcategoría<select value={form.pharmacySubcategory || 'Medicamentos veterinarios'} onChange={e => field('pharmacySubcategory', e.target.value)}>{['Antipulgas y garrapatas', 'Desparasitación', 'Dermatología', 'Oídos y ojos', 'Cuidado digestivo', 'Vitaminas y suplementos', 'Curación y primeros auxilios', 'Medicamentos veterinarios'].map(v => <option key={v}>{v}</option>)}</select></label><label>Registro ICA<input value={form.icaRegistration || ''} onChange={e => field('icaRegistration', e.target.value)}/></label><label>Principio activo<input value={form.activeIngredient || ''} onChange={e => field('activeIngredient', e.target.value)}/></label><label>Concentración<input value={form.concentration || ''} onChange={e => field('concentration', e.target.value)}/></label><label>Forma farmacéutica<input value={form.pharmaceuticalForm || ''} onChange={e => field('pharmaceuticalForm', e.target.value)}/></label><label className="ba-span-2">Información autorizada<textarea rows={2} value={form.authorizedInfo || ''} onChange={e => field('authorizedInfo', e.target.value)}/></label></div></fieldset>}
    <fieldset><legend>Bodegas asociadas</legend><p className="ba-muted ba-small">La asociación no crea existencias. Registra las cantidades verificadas en Inventario.</p><div className="ba-checks">{stores.map(s => <label key={s.id} className="ba-check"><input type="checkbox" checked={!!form.bodegaIds?.some(id => id === s.id || id === s.shopifyLocationGid)} onChange={() => toggleStore(s)}/>{s.name}{!s.isActive && ' (inactiva)'}</label>)}</div></fieldset>
    <fieldset><legend>Presentaciones y variantes</legend><p className="ba-muted ba-small">Deja precio o peso vacío cuando todavía no esté verificado. No se podrá comprar una presentación con datos pendientes.</p>
      {form.presentaciones?.map((v, i) => <div className="ba-variant" key={v.varianteId || i}>{i === 0 && <p className="ba-muted ba-small">Presentación principal: comparte el precio y el peso base.</p>}<div className="ba-form-grid"><label>Presentación<input required value={v.nombre} onChange={e => { variantField(i, 'nombre', e.target.value); if (i === 0) field('presentation', e.target.value); }}/></label><label>SKU<input value={v.sku} onChange={e => { variantField(i, 'sku', e.target.value); if (i === 0) field('sku', e.target.value); }}/></label><label>Precio · COP<input type="number" min="0" step="1" placeholder="Pendiente" value={(i === 0 ? form.price : v.price) || ''} onChange={e => i === 0 ? field('price', e.target.value ? Number(e.target.value) : 0) : variantField(i, 'price', e.target.value ? Number(e.target.value) : 0)}/></label><label>Peso · kg<input type="number" min="0" step="0.001" placeholder="Pendiente" value={(i === 0 ? form.weightKg : v.weightKg) || ''} onChange={e => i === 0 ? field('weightKg', e.target.value ? Number(e.target.value) : 0) : variantField(i, 'weightKg', e.target.value ? Number(e.target.value) : 0)}/></label><label className="ba-span-2">URL de foto<input type="url" value={v.foto || ''} onChange={e => variantField(i, 'foto', e.target.value)}/></label></div>{i > 0 && !product?.presentaciones?.some(existing => existing.varianteId === v.varianteId) && <button type="button" className="ba-link" onClick={() => field('presentaciones', form.presentaciones!.filter((_, index) => index !== i))}>Retirar presentación nueva</button>}</div>)}
      <button type="button" className="ba-btn" onClick={() => field('presentaciones', [...form.presentaciones || [], { varianteId: `VAR-${crypto.randomUUID()}`, nombre: '', sku: '', foto: form.image || '', bodegaIds: form.bodegaIds || [] }])}><Plus size={16}/>Agregar presentación</button>
    </fieldset>
    <div className="ba-dialog-footer"><button type="button" className="ba-btn" onClick={onClose}>Cancelar</button><button className="ba-btn ba-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar producto'}</button></div>
  </form></Dialog>;
}

function StockEditor({ product, stores, initialStore, onClose, onSaved }: { product: AdminProduct; stores: Store[]; initialStore: string; onClose: () => void; onSaved: () => void }) {
  const [current, setCurrent] = useState(product), [storeId, setStore] = useState(stores.find(s => s.id === initialStore && s.isActive)?.id || stores.find(s => s.isActive)?.id || ''), [variantId, setVariant] = useState(''), [quantity, setQuantity] = useState(''), [reason, setReason] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [saving, setSaving] = useState(false);
  const variant = current.presentaciones?.find(v => v.varianteId === variantId);
  const stock = (variant ? variant.stockByStore : current.stockByStore)?.[storeId] || 0, reserved = (variant ? variant.reservedStockByStore : current.reservedStockByStore)?.[storeId] || 0;
  const verified = (variant ? variant.inventoryVerifiedByStore : current.inventoryVerifiedByStore)?.[storeId];
  return <Dialog title="Ajustar inventario" onClose={onClose}><form className="ba-form ba-dialog-body" onSubmit={async e => {
    e.preventDefault(); setSaving(true); setError(''); setNotice('');
    try { await adminRequest(`/products/${encodeURIComponent(current.id)}/inventory`, { method: 'POST', body: JSON.stringify({ version: current.version, storeId, quantity: Number(quantity), reason, variantId: variantId || undefined }) }); const fresh = await adminApi.product(current.id); setCurrent(fresh); setQuantity(''); setReason(''); setNotice('Ajuste registrado.'); onSaved(); } catch (e) { setError(message(e)); } finally { setSaving(false); }
  }}><h3>{current.name}</h3>{error && <Notice danger>{error}</Notice>}{notice && <Notice>{notice}</Notice>}<label>Bodega<select required value={storeId} onChange={e => { setStore(e.target.value); setQuantity(''); }}>{stores.map(s => <option key={s.id} value={s.id} disabled={!s.isActive}>{s.name}{!s.isActive ? ' (inactiva)' : ''}</option>)}</select></label>
    <label>Presentación<select value={variantId} onChange={e => { setVariant(e.target.value); setQuantity(''); }}><option value="">Principal · {current.presentaciones?.[0]?.nombre || current.presentation}</option>{current.presentaciones?.slice(1).map(v => <option key={v.varianteId} value={v.varianteId}>{v.nombre} · {v.sku}</option>)}</select></label>
    {!verified && <Notice>Esta presentación aún no tiene un conteo verificado en la bodega seleccionada. Registra el conteo físico, incluso si es cero.</Notice>}
    <div className="ba-stats ba-stock-stats"><div><span>Existencias físicas</span><strong>{verified ? stock : '—'}</strong></div><div><span>Reservadas</span><strong>{reserved}</strong></div><div><span>Disponibles</span><strong>{verified ? Math.max(0, stock - reserved) : '—'}</strong></div></div>
    <label>Nueva cantidad física verificada<input required type="number" min={reserved} step="1" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="Cuenta las unidades en esta bodega"/></label><label>Motivo del ajuste<textarea required minLength={3} maxLength={500} rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="Ej.: conteo físico, entrada de mercancía…"/></label><small>El ajuste corresponde a la cantidad final, no a unidades para sumar. No puede ser inferior a las reservas activas.</small><div className="ba-dialog-footer"><button type="button" className="ba-btn" onClick={onClose}>Cerrar</button><button className="ba-btn ba-primary" disabled={saving || !storeId}>{saving ? 'Guardando…' : 'Registrar ajuste'}</button></div></form></Dialog>;
}
function InventoryHistory({ revision, stores }: { revision: number; stores: Store[] }) {
  const [movements, setMovements] = useState<InventoryMovement[]>([]), [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController(); adminRequest<{ movements: InventoryMovement[] }>('/inventory/movements?pageSize=10', { signal: controller.signal }).then(data => { setMovements(data.movements); setError(''); }).catch(e => { if (!controller.signal.aborted) setError(message(e)); }); return () => controller.abort(); }, [revision]);
  return <><div className="ba-page-head"><h2>Últimos ajustes</h2></div>{error && <Notice danger>{error}</Notice>}<div className="ba-card"><div className="ba-table-scroll"><table><thead><tr><th>Producto</th><th>Bodega</th><th>Cantidad anterior → nueva</th><th>Motivo</th><th>Responsable</th></tr></thead><tbody>{movements.map(m => <tr key={m.id}><td>{m.productName}<small>{dateTime(m.createdAt)}</small></td><td>{stores.find(s => s.id === m.storeId)?.name || m.storeId}</td><td>{m.previousQuantity} → {m.quantity}</td><td>{m.reason}</td><td>{m.actorName}</td></tr>)}</tbody></table></div>{!movements.length && <p className="ba-empty">Todavía no hay ajustes de inventario.</p>}</div></>;
}

function PromotionsPanel({ stores, revision, onChange }: { stores: Store[]; revision: number; onChange: () => void }) {
  const [promotions, setPromotions] = useState<AdminPromotion[]>([]), [error, setError] = useState(''), [editor, setEditor] = useState<AdminPromotion | 'new' | null>(null);
  const load = useCallback(async () => { try { const result = await adminRequest<AdminPromotion[] | { promotions: AdminPromotion[] }>('/promotions'); setPromotions(Array.isArray(result) ? result : result.promotions); setError(''); } catch (e) { setError(message(e)); } }, []);
  useEffect(() => { load(); }, [load, revision]);
  return <><div className="ba-page-head"><div><h1>Promociones</h1><p className="ba-muted">Descuentos con vigencia y condiciones. Se aplica la mejor promoción elegible, sin acumularlas.</p></div><button className="ba-btn ba-primary" onClick={() => setEditor('new')}><Plus size={17}/>Crear promoción</button></div>{error && <Notice danger>{error}</Notice>}<div className="ba-card"><div className="ba-table-scroll"><table><thead><tr><th>Promoción</th><th>Descuento</th><th>Vigencia · Bogotá</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{promotions.map(p => {
    const now = Date.now(), status = !p.active ? 'Pausada' : now < Date.parse(p.startsAt) ? 'Programada' : now >= Date.parse(p.endsAt) ? 'Finalizada' : 'Activa';
    const targets = [p.productIds.length ? `${p.productIds.length} productos completos` : '', p.variantIds.length ? `${p.variantIds.length} presentaciones` : ''].filter(Boolean).join(' + ') || 'Todos los productos';
    return <tr key={p.id}><td><strong>{p.name}</strong><small>{targets} · {p.storeIds.length ? `${p.storeIds.length} bodegas` : 'Todas las bodegas'}</small></td><td>{p.type === 'PERCENTAGE' ? `${p.value}%` : formatCOP(p.value)}<small>Mínimo {formatCOP(p.minSubtotal)}</small></td><td>{dateTime(p.startsAt)}<small>Hasta {dateTime(p.endsAt)}</small></td><td><span className={`ba-badge ${status === 'Activa' ? 'ba-green' : 'ba-gray'}`}>{status}</span></td><td><div className="ba-row-actions"><button className="ba-btn ba-small-btn" onClick={() => setEditor(p)}>Editar</button><button className="ba-link" onClick={async () => { try { await adminApi.savePromotion({ ...p, active: !p.active }, true); load(); onChange(); } catch (e) { setError(message(e)); } }}>{p.active ? 'Pausar' : 'Activar'}</button></div></td></tr>;
  })}</tbody></table></div>{!promotions.length && <p className="ba-empty">Crea tu primera promoción para mostrarla en la tienda.</p>}</div>{editor && <PromotionEditor promotion={editor === 'new' ? null : editor} stores={stores} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); load(); onChange(); }}/>}</>;
}
const bogotaInput = (date: string) => {
  const d = new Date(date); if (!Number.isFinite(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return parts.replace(' ', 'T');
};
function PromotionEditor({ promotion, stores, onClose, onSaved }: { promotion: AdminPromotion | null; stores: Store[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Partial<AdminPromotion>>(() => promotion ? structuredClone(promotion) : { name: '', type: 'PERCENTAGE', value: 10, productIds: [], variantIds: [], storeIds: [], minSubtotal: 0, active: false, startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 86400000 * 7).toISOString() });
  const [starts, setStarts] = useState(bogotaInput(form.startsAt!)), [ends, setEnds] = useState(bogotaInput(form.endsAt!)), [query, setQuery] = useState(''), [results, setResults] = useState<AdminProduct[]>([]), [chosen, setChosen] = useState<Record<string, string>>({}), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const [chosenVariants, setChosenVariants] = useState<Record<string, string>>({});
  const field = (key: keyof AdminPromotion, value: unknown) => setForm(f => ({ ...f, [key]: value }));
  useEffect(() => { const controller = new AbortController(); const timer = window.setTimeout(() => { if (!query.trim()) { setResults([]); return; } adminRequest<{ products: AdminProduct[] }>(`/products?q=${encodeURIComponent(query)}&pageSize=10`, { signal: controller.signal }).then(r => setResults(r.products)).catch(e => { if (!controller.signal.aborted) setError(message(e)); }); }, 250); return () => { controller.abort(); window.clearTimeout(timer); }; }, [query]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const productNames = Promise.all((promotion?.productIds || []).map(id => adminApi.product(id).then(p => [id, p.name] as const).catch(() => [id, id] as const)));
    const variantNames = Promise.all((promotion?.variantIds || []).map(async id => {
      try {
        const response = await adminRequest<{ products: AdminProduct[] }>(`/products?variantId=${encodeURIComponent(id)}&pageSize=1`, { signal: controller.signal });
        const product = response.products[0];
        const variant = product?.presentaciones?.find(v => v.varianteId === id);
        return [id, variant ? `${product.name} · ${variant.nombre}` : id] as const;
      } catch { return [id, id] as const; }
    }));
    Promise.all([productNames, variantNames]).then(([productLabels, variantLabels]) => {
      if (!active) return;
      setChosen(current => ({ ...Object.fromEntries(productLabels), ...current }));
      setChosenVariants(current => ({ ...Object.fromEntries(variantLabels), ...current }));
    });
    return () => { active = false; controller.abort(); };
  }, [promotion]);
  return <Dialog title={promotion ? 'Editar promoción' : 'Crear promoción'} onClose={onClose}><form className="ba-form ba-dialog-body" onSubmit={async e => {
    e.preventDefault(); setError(''); setSaving(true);
    try { await adminApi.savePromotion({ ...form, startsAt: new Date(`${starts}:00-05:00`).toISOString(), endsAt: new Date(`${ends}:00-05:00`).toISOString() }, !!promotion); onSaved(); } catch (e) { setError(message(e)); } finally { setSaving(false); }
  }}>{error && <Notice danger>{error}</Notice>}<label>Nombre<input required maxLength={150} value={form.name} onChange={e => field('name', e.target.value)}/></label><div className="ba-form-grid"><label>Tipo de descuento<select value={form.type} onChange={e => field('type', e.target.value)}><option value="PERCENTAGE">Porcentaje</option><option value="FIXED">Valor fijo en COP</option></select></label><label>{form.type === 'PERCENTAGE' ? 'Porcentaje' : 'Valor · COP'}<input required type="number" min="1" max={form.type === 'PERCENTAGE' ? 100 : undefined} step="1" value={form.value} onChange={e => field('value', Number(e.target.value))}/></label><label>Inicio · hora Bogotá<input type="datetime-local" required value={starts} onChange={e => setStarts(e.target.value)}/></label><label>Finalización · hora Bogotá<input type="datetime-local" required value={ends} onChange={e => setEnds(e.target.value)}/></label><label>Compra mínima · COP<input type="number" min="0" step="1" value={form.minSubtotal} onChange={e => field('minSubtotal', Number(e.target.value))}/></label><label className="ba-check"><input type="checkbox" checked={form.active} onChange={e => field('active', e.target.checked)}/>Promoción habilitada</label></div>
    <fieldset><legend>Productos y presentaciones participantes</legend><small>Elige el producto completo o únicamente una presentación. Sin selección, aplica a todos los productos elegibles.</small><label>Buscar producto<input placeholder="Nombre, marca o SKU" value={query} onChange={e => setQuery(e.target.value)}/></label>
      <div className="ba-picker">{results.map(p => <div key={p.id}>
        <button type="button" className="ba-picker-result" disabled={form.productIds?.includes(p.id)} onClick={() => {
          field('productIds', [...new Set([...(form.productIds || []), p.id])]);
          field('variantIds', (form.variantIds || []).filter(id => !p.presentaciones?.some(v => v.varianteId === id)));
          setChosen(c => ({ ...c, [p.id]: p.name })); setQuery(''); setResults([]);
        }}><span>{p.name}<small style={{ display: 'block' }}>Todo el producto · {p.brand}</small></span><Plus size={16}/></button>
        {p.presentaciones?.map(variant => <button type="button" key={variant.varianteId} className="ba-picker-result" style={{ paddingLeft: 28 }} disabled={form.productIds?.includes(p.id) || form.variantIds?.includes(variant.varianteId)} onClick={() => {
          field('variantIds', [...new Set([...(form.variantIds || []), variant.varianteId])]);
          setChosenVariants(c => ({ ...c, [variant.varianteId]: `${p.name} · ${variant.nombre}` })); setQuery(''); setResults([]);
        }}><span>Solo {variant.nombre}<small style={{ display: 'block' }}>{variant.sku}</small></span><Plus size={15}/></button>)}
      </div>)}</div>
      <div className="ba-chips">{form.productIds?.map(id => <button type="button" key={id} aria-label={`Quitar producto ${chosen[id] || id}`} onClick={() => field('productIds', form.productIds!.filter(v => v !== id))}>{chosen[id] || id} · todas sus presentaciones<X size={14}/></button>)}{form.variantIds?.map(id => <button type="button" key={id} aria-label={`Quitar presentación ${chosenVariants[id] || id}`} onClick={() => field('variantIds', form.variantIds!.filter(v => v !== id))}>{chosenVariants[id] || id}<X size={14}/></button>)}</div>
    </fieldset>
    <fieldset><legend>Bodegas participantes</legend><small>Sin selección, aplica a todas las bodegas habilitadas.</small><div className="ba-checks">{stores.filter(s => s.isActive).map(s => <label key={s.id} className="ba-check"><input type="checkbox" checked={form.storeIds?.includes(s.id)} onChange={() => field('storeIds', form.storeIds?.includes(s.id) ? form.storeIds.filter(v => v !== s.id) : [...form.storeIds || [], s.id])}/>{s.name}</label>)}</div></fieldset><p className="ba-muted ba-small">Los descuentos se validan en el servidor. El beneficio de envío gratis conserva sus reglas actuales.</p><div className="ba-dialog-footer"><button type="button" className="ba-btn" onClick={onClose}>Cancelar</button><button className="ba-btn ba-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar promoción'}</button></div></form></Dialog>;
}
