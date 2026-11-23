import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { formatCOP, formatTimeBogota } from '../../lib/formatters';
import { AdminRequestError, boltAdmin, type ServiceReport } from './adminClient';

export function ServiceStatusDetails({ report }: {report: ServiceReport}) {
  const { operations, service } = report;
  const { cash, orders, dispatches, tests } = operations;
  const { alerts, recentMinutes } = service;
  const recentErrors = recentMinutes.reduce((sum, minute) => sum + minute.http.http5xx, 0);
  const windowStart = recentMinutes[0]?.start ?? service.asOf;
  const webhook = !alerts.configured ? 'Pendiente de configurar' : alerts.sent ? 'Envío verificado' : 'Configurado, sin envío verificado';
  return <dl className="ba-service-facts">
    <div><dt>Alertas externas</dt><dd>{webhook}
      {alerts.failed > 0 && <small>Envíos fallidos desde el inicio del servicio: {alerts.failed}</small>}</dd></div>
    <div><dt>Errores del servidor (HTTP 5xx)</dt><dd>{recentErrors}
      <small>{formatTimeBogota(windowStart)} – {formatTimeBogota(service.asOf)} · Bogotá</small></dd></div>
    <div><dt>Pedidos registrados</dt><dd>{orders.total}<small>Pendientes de confirmación: {orders.awaitingConfirmation}</small></dd></div>
    <div><dt>Despachos entregados</dt><dd>{dispatches.delivered} de {dispatches.total}<small>Compras con entrega parcial: {orders.partiallyDelivered}</small></dd></div>
    <div><dt>Efectivo verificado</dt><dd>{cash.verifiedCollectedCOP === null ? 'Sin recaudo verificado' : formatCOP(cash.verifiedCollectedCOP)}
      <small>Entregas sin comprobación del recaudo: {cash.unverifiedDeliveredShipments}</small></dd></div>
    <div><dt>Operaciones de prueba</dt><dd>{tests.orders} pedidos<small>Pedidos de prueba entregados: {tests.deliveredOrders}</small></dd></div>
  </dl>;
}

export function ServiceStatus({ token }: {token: string}) {
  const current = useRef<AbortController | null>(null);
  const [view, setView] = useState<{owner: string; report?: ServiceReport; error?: string; loading?: boolean}>();
  const shown = view?.owner === token ? view : undefined;
  useEffect(() => () => current.current?.abort(), [token]);
  async function load() {
    current.current?.abort();
    const request = new AbortController();
    current.current = request;
    setView({owner:token, loading:true});
    try {
      const report = await boltAdmin.observability(token, request.signal);
      if (!request.signal.aborted) setView({owner:token, report});
    } catch (error) {
      if (request.signal.aborted) return;
      const expired = error instanceof AdminRequestError && [401, 403].includes(error.status);
      setView({owner:token, error:expired ? 'Se requiere una sesión vigente de Coordinación.' : 'No se pudo consultar el estado del servicio. Vuelve a intentarlo.'});
    }
  }
  return <section className="ba-panel" aria-label="Estado del servicio">
    <div className="ba-panel-head">
      <div><h2>Estado del servicio</h2><p>Todas las sedes{shown?.report && <> · Consultado a las {formatTimeBogota(shown.report.service.asOf)} (Bogotá)</>}</p></div>
      <button type="button" onClick={load} disabled={shown?.loading} className="ba-btn ba-btn-secondary">
        <RefreshCw size={15} aria-hidden="true" />{shown?.loading ? 'Consultando…' : shown?.report ? 'Actualizar' : 'Consultar'}
      </button>
    </div>
    <div aria-live="polite" aria-busy={shown?.loading || undefined}>
      {shown?.error && <p className="ba-error" role="alert">{shown.error}</p>}
      {shown?.report && <ServiceStatusDetails report={shown.report} />}
    </div>
  </section>;
}
