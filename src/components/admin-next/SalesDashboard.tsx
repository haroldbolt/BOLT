import { useEffect, useId, useState } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, ChartNoAxesCombined, CircleAlert, Clock3, FlaskConical, LoaderCircle, Package, ReceiptText, RefreshCw, Wallet } from 'lucide-react';
import type { BoltAdminSalesReport, SalesPeriod } from '../../lib/boltAdminSales';
import { formatCOP, formatDateBogota, formatTimeBogota } from '../../lib/formatters';
import './salesDashboard.css';

type SalesDashboardProps = {
  token: string | null;
  storeId?: string;
  stores: { id: string; name: string }[];
  fetchReport: (token: string | null, scope: string, period: SalesPeriod, signal: AbortSignal) => Promise<BoltAdminSalesReport>;
};

type SalesSnapshot = {
  scope: string;
  token: string | null;
  period: SalesPeriod;
  report?: BoltAdminSalesReport;
  error?: string;
};

const periods = { today: 'Hoy', '7d': 'Últimos 7 días', '30d': 'Últimos 30 días' } as const;
const number = new Intl.NumberFormat('es-CO');
const compact = new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' });
const refreshInterval = 15_000;

export function SalesDashboard({ token, storeId, stores, fetchReport }: SalesDashboardProps) {
  const [period, setPeriod] = useState<SalesPeriod>('today');
  const [showAll, setShowAll] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<SalesSnapshot>();
  const scope = showAll && stores.length > 1 ? 'all' : storeId;
  const current = snapshot?.scope === scope && snapshot?.period === period && snapshot?.token === token ? snapshot : undefined;
  const report = current?.report;
  const scopeName = scope === 'all' ? 'Todas las sedes autorizadas' : stores.find(store => store.id === storeId)?.name;

  useEffect(() => {
    if (!scope) return;
    const requestScope = scope;
    const controller = new AbortController();
    let inFlight = false;

    async function refresh() {
      if (inFlight || controller.signal.aborted || document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        const report = await fetchReport(token, requestScope, period, controller.signal);
        if (!controller.signal.aborted) setSnapshot({ scope: requestScope, token, period, report });
      } catch (failure) {
        if (controller.signal.aborted) return;
        const error = failure instanceof Error ? failure.message : 'No pudimos actualizar las ventas.';
        const status = (failure as { status?: number } | undefined)?.status;
        setSnapshot(previous => ({
          scope: requestScope, token, period, error,
          report: status !== 401 && status !== 403 && previous?.scope === requestScope && previous.period === period && previous.token === token
            ? previous.report : undefined,
        }));
      } finally {
        inFlight = false;
      }
    }

    void refresh();
    const timer = window.setInterval(refresh, refreshInterval);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [scope, token, period, fetchReport, attempt]);

  return <section className="ba-sales" aria-label="Panel de ventas">
    <header className="ba-page-heading ba-sales-header">
      <div>
        <h1>Ventas en vivo</h1>
        <p>{scopeName ?? 'Sin sede asignada'}</p>
      </div>
      {scope && <div className="ba-sales-controls">
        {stores.length > 1 && <label className="ba-field">Sedes
          <select value={showAll ? 'all' : 'active'} onChange={event => setShowAll(event.target.value === 'all')}>
            <option value="active">Sede activa</option><option value="all">Todas las sedes</option>
          </select>
        </label>}
        <label className="ba-field">Periodo
          <select value={period} onChange={event => setPeriod(event.target.value as SalesPeriod)}>
            {Object.entries(periods).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <button type="button" className="ba-btn ba-btn-secondary" onClick={() => setAttempt(value => value + 1)}>
          <RefreshCw size={15} aria-hidden="true" />Actualizar
        </button>
      </div>}
    </header>

    {!scope && <p className="ba-info">Selecciona una sede para consultar sus ventas.</p>}
    {scope && !current && <p className="ba-loading" role="status"><LoaderCircle size={17} className="ba-spin" aria-hidden="true" />Consultando ventas…</p>}
    {current?.error && <p className="ba-error" role="alert"><CircleAlert size={17} aria-hidden="true" />{current.error}{report && ' Se muestran los datos de la última consulta.'}</p>}

    {report && <>
      <div className="ba-sales-period">
        <span>{dateRange(report.from, report.to)}</span>
        {report.demo && <span className="ba-demo"><FlaskConical size={13} aria-hidden="true" />Ventas de prueba</span>}
        <span className="ba-sales-updated"><Clock3 size={14} aria-hidden="true" />Actualizado a las <time dateTime={report.updatedAt}>{formatTimeBogota(report.updatedAt)}</time> · cada 15 s</span>
      </div>
      <SalesMetrics summary={report.summary} />
      {!!report.testDeliveries?.length && <TestDeliveries deliveries={report.testDeliveries} />}
      <SalesChart series={report.series} />
      <div className="ba-sales-breakdowns">
        <ProductsTrend products={report.products} units={report.summary.units} />
        <SalesByStore stores={report.stores} />
      </div>
    </>}
  </section>;
}

function dateRange(from: string, to: string) {
  const start = formatDateBogota(`${from}T12:00:00-05:00`);
  if (from === to) return start;
  return `${start} – ${formatDateBogota(`${to}T12:00:00-05:00`)}`;
}

function SalesMetrics({ summary }: { summary: BoltAdminSalesReport['summary'] }) {
  const metrics = [
    { label: 'Ventas confirmadas', value: formatCOP(summary.confirmedCOP), description: 'Valor de los pedidos confirmados', icon: ChartNoAxesCombined },
    { label: 'Recaudo registrado', value: formatCOP(summary.collectedCOP), description: 'Efectivo registrado para estos pedidos', icon: Wallet },
    { label: 'Pedidos confirmados', value: number.format(summary.orderCount), icon: ReceiptText },
    { label: 'Promedio por pedido', value: formatCOP(summary.averageOrderCOP), icon: Package },
  ];
  return <dl className="ba-sales-metrics" aria-label="Indicadores de ventas">
    {metrics.map(({ label, value, description, icon: Icon }) => <div className="ba-panel ba-sales-metric" key={label}>
      <dt>{label}<span className="ba-symbol"><Icon size={16} aria-hidden="true" /></span></dt>
      <dd><strong>{value}</strong>{description && <small>{description}</small>}</dd>
    </div>)}
  </dl>;
}

function TestDeliveries({ deliveries }: { deliveries: NonNullable<BoltAdminSalesReport['testDeliveries']> }) {
  return <section className="ba-panel" aria-label="Entregas de prueba">
    <div className="ba-panel-head">
      <div>
        <h2>Entregas de prueba</h2>
        <p>Fuera de los totales de ventas y recaudo.</p>
      </div>
      <span className="ba-demo"><FlaskConical size={13} aria-hidden="true" />Simulación</span>
    </div>
    <div className="ba-sales-table-scroll">
      <table className="ba-sales-table">
        <thead><tr><th scope="col">Pedido</th><th scope="col">Productos</th><th scope="col">Recaudo</th></tr></thead>
        <tbody>
          {deliveries.map(delivery => <tr key={delivery.id}>
            <th scope="row">
              <strong>{delivery.code}</strong>
              <small>{delivery.storeName} · Entregado</small>
              <small><time dateTime={delivery.deliveredAt}>
                {formatDateBogota(delivery.deliveredAt)} · {formatTimeBogota(delivery.deliveredAt)}
              </time></small>
            </th>
            <td><ul>{delivery.items.map(({ name, presentation, quantity }, index) => <li key={`${index}-${name}`}>
              {number.format(quantity)} × {name}
              {presentation && <small>{presentation}</small>}
            </li>)}</ul></td>
            <td><strong>{formatCOP(delivery.collectedCOP)}</strong></td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>;
}

function SalesChart({ series }: { series: BoltAdminSalesReport['series'] }) {
  const [metric, setMetric] = useState<'confirmedCOP' | 'orderCount'>('confirmedCOP');
  const controlId = useId();
  const peak = series.reduce<(typeof series)[number] | undefined>((best, bucket) =>
    bucket[metric] > (best?.[metric] ?? 0) ? bucket : best, undefined);
  const max = peak?.[metric] ?? 0;
  const tickStep = Math.ceil(series.length / 5);
  const currency = metric === 'confirmedCOP';
  const formatAxis = (value: number) => currency ? `$ ${compact.format(value)}` : number.format(value);

  return <section className="ba-panel ba-sales-chart" aria-label="Gráfico de ventas">
    <div className="ba-panel-head">
      <div><h2>Ventas en el tiempo</h2><p>Hora de Bogotá</p></div>
      <fieldset className="ba-sales-chart-options">
        <legend className="ba-sr">Medida del gráfico</legend>
        <label><input type="radio" name={controlId} checked={currency} onChange={() => setMetric('confirmedCOP')} /> <span>Valor</span></label>
        <label><input type="radio" name={controlId} checked={!currency} onChange={() => setMetric('orderCount')} /> <span>Pedidos</span></label>
      </fieldset>
    </div>
    {peak ? <>
      <figure className="ba-sales-figure">
        <div className="ba-sales-chart-area" aria-hidden="true">
          <div className="ba-sales-axis"><span>{formatAxis(max)}</span><span>{(currency || Number.isInteger(max / 2)) && formatAxis(max / 2)}</span><span>{formatAxis(0)}</span></div>
          <div className="ba-sales-plot" style={{ gridTemplateColumns: `repeat(${series.length}, minmax(0, 1fr))` }}>
            {series.map((bucket, index) => <div className="ba-sales-bucket" key={bucket.key}>
              <div className="ba-sales-bar" data-peak={bucket.key === peak.key || undefined}
                style={{ height: `${bucket[metric] / max * 100}%` }}
                title={`${bucket.label} · ${currency ? formatCOP(bucket.confirmedCOP) : `${number.format(bucket.orderCount)} pedidos`}`} />
              {(index === 0 || index === series.length - 1 || (index % tickStep === 0 && series.length - 1 - index >= tickStep / 2)) &&
                <span className="ba-sales-axis-label">{bucket.label}</span>}
            </div>)}
          </div>
        </div>
        <figcaption><Activity size={15} aria-hidden="true" /><strong>{currency ? 'Mayor valor confirmado' : 'Mayor demanda'}</strong>
          <span>{peak.label} · {formatCOP(peak.confirmedCOP)} · {number.format(peak.orderCount)} {peak.orderCount === 1 ? 'pedido' : 'pedidos'}</span>
        </figcaption>
      </figure>
      <details className="ba-sales-chart-data">
        <summary>Ver datos del gráfico</summary>
        <table className="ba-sales-table">
          <thead><tr><th scope="col">Momento</th><th scope="col">Pedidos</th><th scope="col">Valor confirmado</th></tr></thead>
          <tbody>{series.map(bucket => <tr key={bucket.key}>
            <th scope="row">{bucket.label}</th><td>{number.format(bucket.orderCount)}</td><td>{formatCOP(bucket.confirmedCOP)}</td>
          </tr>)}</tbody>
        </table>
      </details>
    </> : <p className="ba-sales-empty">Aún no hay pedidos confirmados en este periodo.</p>}
  </section>;
}

function ProductsTrend({ products, units }: { products: BoltAdminSalesReport['products']; units: number }) {
  return <section className="ba-panel" aria-label="Productos en tendencia">
    <div className="ba-panel-head"><div><h2>Productos en tendencia</h2><p>{number.format(units)} {units === 1 ? 'unidad confirmada' : 'unidades confirmadas'} · Comparación con el periodo anterior</p></div></div>
    {products.length ? <div className="ba-sales-table-scroll"><table className="ba-sales-table">
      <thead><tr><th scope="col">Producto</th><th scope="col">Unidades</th><th scope="col">Variación</th></tr></thead>
      <tbody>{products.map(product => <tr key={product.id}>
        <th scope="row"><strong>{product.name}</strong><small>{formatCOP(product.revenueCOP)} en productos</small></th>
        <td>{number.format(product.units)}</td>
        <td><ProductChange change={product.changePercent} previous={product.previousUnits} /></td>
      </tr>)}</tbody>
    </table></div> : <p className="ba-sales-empty">Los productos aparecerán cuando se confirmen ventas en el periodo.</p>}
  </section>;
}

function ProductChange({ change, previous }: { change: number | null; previous: number }) {
  if (change === null) return <span className="ba-dim">Sin base previa</span>;
  const Icon = change < 0 ? ArrowDownRight : ArrowUpRight;
  return <>
    <span className="ba-sales-change" data-direction={Math.sign(change)}>
      {change !== 0 && <Icon size={13} aria-hidden="true" />}{percent.format(change / 100)}
    </span>
    <small>Antes {number.format(previous)} {previous === 1 ? 'unidad' : 'unidades'}</small>
  </>;
}

function SalesByStore({ stores }: { stores: BoltAdminSalesReport['stores'] }) {
  return <section className="ba-panel" aria-label="Ventas por sede">
    <div className="ba-panel-head"><div><h2>Ventas por sede</h2><p>Pedidos y efectivo registrado</p></div></div>
    {stores.length ? <div className="ba-sales-table-scroll"><table className="ba-sales-table">
      <thead><tr><th scope="col">Sede</th><th scope="col">Pedidos</th><th scope="col">Valor confirmado</th></tr></thead>
      <tbody>{stores.map(store => <tr key={store.id}>
        <th scope="row">{store.name}</th><td>{number.format(store.orderCount)}</td>
        <td><strong>{formatCOP(store.confirmedCOP)}</strong><small>{formatCOP(store.collectedCOP)} de recaudo</small></td>
      </tr>)}</tbody>
    </table></div> : <p className="ba-sales-empty">No hay sedes disponibles en esta vista.</p>}
  </section>;
}
