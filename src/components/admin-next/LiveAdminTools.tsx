import { lazy, Suspense, useLayoutEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { bindPageAdminToken } from '../../lib/api';
import type { OperationsTool } from '../operations/OperationsDashboard';

const DispatchManager = lazy(() => import('../dispatch/DispatchManager').then(module => ({ default: module.DispatchManager })));
const OrderTracking = lazy(() => import('../customer/OrderTracking').then(module => ({ default: module.OrderTracking })));
const OperationsDashboard = lazy(() => import('../operations/OperationsDashboard').then(module => ({ default: module.OperationsDashboard })));

export const liveOperationTools = [
  { id: 'PEDIDOS', label: 'Gestión de pedidos y devoluciones' },
  { id: 'BODEGAS', label: 'Bodegas y mapas' },
  { id: 'CATALOGO', label: 'Edición de catálogo' },
  { id: 'SHOPIFY', label: 'Shopify Agrocentro' },
  { id: 'FARMACIA', label: 'Fórmulas veterinarias' },
  { id: 'FLOTA', label: 'Flota y transporte' },
  { id: 'INVENTARIO', label: 'Lotes e inventario farmacéutico' },
] as const satisfies readonly { id: OperationsTool; label: string }[];

export type LiveOperationTool = typeof liveOperationTools[number]['id'];

type LiveAdminToolsProps = { token: string; storeId?: string } & (
  { view: 'dispatch'; orderRef?: string } | { view: 'tools'; tool: LiveOperationTool; openDispatches: (id?: string) => void }
);

const loginRequired = () => window.location.reload();

function Loading() {
  return <p className="ba-loading" role="status"><LoaderCircle size={18} className="ba-spin" /> Cargando herramientas…</p>;
}

export function LiveAdminTools(props: LiveAdminToolsProps) {
  const { token, storeId } = props;
  const [trackingId, setTrackingId] = useState<string>();
  const [verifiedToken, setVerifiedToken] = useState<string>();
  useLayoutEffect(() => {
    const release = bindPageAdminToken(token);
    setVerifiedToken(token);
    return release;
  }, [token]);

  if (verifiedToken !== token) return <Loading />;
  return <Suspense fallback={<Loading />}>
    {trackingId ? <OrderTracking key={trackingId} orderId={trackingId} adminView onBack={() => setTrackingId(undefined)} />
      : props.view === 'dispatch'
        ? <DispatchManager authenticated onAuthenticate={loginRequired} storeFilter={storeId ? [storeId] : []}
          initialOrderRef={props.orderRef} onViewOrderTracking={setTrackingId} />
        : <OperationsDashboard activeTab={props.tool} selectedStoreId={storeId ?? ''} onAuthenticate={loginRequired}
          onOpenDispatches={props.openDispatches} onViewOrderTracking={setTrackingId} />}
  </Suspense>;
}
