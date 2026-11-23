import type { Express, RequestHandler } from 'express';
import { providerRouteLimit } from './providerQuota';
import type { Order } from '../types';

const endpoints = {
  sandbox: 'https://sandbox.wompi.co/v1/transactions/',
  production: 'https://production.wompi.co/v1/transactions/',
};
const methods = { WOMPI_CARD: 'CARD', WOMPI_PSE: 'PSE', WOMPI_BANCOLOMBIA: 'BANCOLOMBIA_TRANSFER' } as const;
const statuses = ['PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR'] as const;

type LocalPayment = { id: string; payment: Order['payment']; totals: Pick<Order['totals'], 'total'> };
type Config = { environment: keyof typeof endpoints; privateKey: string; merchantId: string };

export function wompiLookupConfig(env: NodeJS.ProcessEnv): Config | null {
  const environment = env.BOLT_WOMPI_LOOKUP_ENV;
  if (environment !== 'production' && environment !== 'sandbox') return null;
  const privateKey = env.BOLT_WOMPI_PRIVATE_KEY?.trim();
  const merchantId = env.BOLT_WOMPI_MERCHANT_ID?.trim();
  const prefix = environment === 'sandbox' ? 'prv_test_' : 'prv_prod_';
  if (!privateKey?.startsWith(prefix) || privateKey.length <= prefix.length || /\s/.test(privateKey) || !merchantId) return null;
  return { environment, merchantId, privateKey };
}

class LookupError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

// Consult only the transaction already linked by the backend. This function has no write dependency.
function paymentParameters(order: LocalPayment) {
  const transactionId = order.payment.transactionId;
  const amount = order.totals.total * 100;
  if (!Object.hasOwn(methods, order.payment.method) || !transactionId || !/^[a-zA-Z0-9_-]{1,160}$/.test(transactionId) ||
      !Number.isSafeInteger(amount) || amount <= 0) {
    throw new LookupError(409, 'WOMPI_LINK_REQUIRED', 'El pedido requiere una transacción Wompi vinculada y un importe válido.');
  }

  return { transactionId, amount };
}

export async function lookupWompiPayment(order: LocalPayment, config: Config, request = fetch) {
  return consultWompi(order, config, paymentParameters(order), request);
}

async function consultWompi(order: LocalPayment, config: Config, params: ReturnType<typeof paymentParameters>, request = fetch) {
  const { transactionId, amount } = params;
  let data;
  try {
    const response = await request(endpoints[config.environment] + encodeURIComponent(transactionId), {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + config.privateKey },
    });
    if (response.status === 404) throw new LookupError(409, 'WOMPI_NOT_VERIFIED', 'La transacción vinculada no pudo verificarse en este comercio.');
    if (!response.ok) throw new Error('Provider unavailable');
    data = (await response.json()).data;
  } catch (error) {
    if (error instanceof LookupError) throw error;
    throw new LookupError(502, 'WOMPI_UNAVAILABLE', 'No se pudo consultar Wompi. Intenta nuevamente más tarde.');
  }

  const expectedMethod = methods[order.payment.method as keyof typeof methods];
  const id = data?.merchant?.id;
  if (!(typeof id === 'string' || Number.isSafeInteger(id)) || String(id) !== config.merchantId ||
      data.id !== transactionId || data.reference !== order.id || data.amount_in_cents !== amount ||
      data.currency !== 'COP' || data.payment_method_type !== expectedMethod || !statuses.includes(data.status)) {
    throw new LookupError(409, 'WOMPI_NOT_VERIFIED', 'Los datos del comercio y del pedido requieren conciliación.');
  }
  return { provider: 'WOMPI', environment: config.environment, providerStatus: data.status as typeof statuses[number],
    amountInCents: amount, currency: 'COP' };
}

export function mountWompiLookup(app: Express, coordination: RequestHandler, getOrder: (id: string) => Order | undefined) {
  const limitLookup = providerRouteLimit('WOMPI');
  app.get('/api/v1/admin/orders/:orderId/payments/wompi', coordination, async (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    const config = wompiLookupConfig(process.env);
    if (!config) return res.status(503).json({ code: 'WOMPI_NOT_CONFIGURED', error: 'La consulta de pagos no está configurada.' });
    const order = getOrder(req.params.orderId);
    if (!order) return res.status(404).json({ code: 'ORDER_NOT_FOUND', error: 'Pedido no encontrado.' });
    try {
      const params = paymentParameters(order);
      return await limitLookup(req, res, async () => res.json(await consultWompi(order, config, params)));
    } catch (error) {
      if (error instanceof LookupError) return res.status(error.status).json({ code: error.code, error: error.message });
      return next(error);
    }
  });
}
