import { Product, Store, Order, GPSTelemetry, DriverProfile, GPSTrackingPoint, OrderTrackingSnapshot } from '../types';
import { INITIAL_PRODUCTS, INITIAL_STORES, INITIAL_DRIVERS } from '../data/seedData';
import { DeliveryQuote, QuoteRequest, evaluateDeliveryQuote } from './deliveryService';
import { getAdminCsrfToken } from './adminApi';

const BASE_URL = '/api/v1';
const ORDER_KEYS = 'bolt_pets_order_access';
const inMemoryAccess: Record<string, string> = {};
function savedOrderAccess(): Record<string, string> { try { const stored = JSON.parse(localStorage.getItem(ORDER_KEYS) || '{}'); return { ...(stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}), ...inMemoryAccess }; } catch { return inMemoryAccess; } }
async function apiFetch(input: RequestInfo | URL, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.method && options.method !== 'GET' && getAdminCsrfToken()) headers.set('x-csrf-token', getAdminCsrfToken());
  const match = String(input).match(/\/orders\/([^/?]+)/);
  if (match) { const token = savedOrderAccess()[decodeURIComponent(match[1])]; if (token) headers.set('x-order-token', token); }
  return fetch(input, { ...options, headers, credentials: 'same-origin' });
}

export class ApiRequestError extends Error {
  constructor(message: string, public status: number, public nextSequenceNumber?: number) { super(message); }
}

export interface GeocodingCandidate {
  address: string;
  coordinates: { lat: number; lng: number } | null;
  partialMatch?: boolean;
  locationType?: string;
  types?: string[];
  placeId?: string;
}

function rethrowCancellation(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason || new DOMException('Operación cancelada', 'AbortError');
  if (error instanceof Error && error.name === 'AbortError') throw error;
}

export const api = {
  async getDeliveryQuote(req: QuoteRequest, localStores?: Store[], localProducts?: Product[], signal?: AbortSignal, options?: { authoritative?: boolean }): Promise<DeliveryQuote> {
    try {
      const res = await apiFetch(`${BASE_URL}/delivery/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal,
      });
      if (!res.ok) {
        throw new Error('Error del servidor en cotización');
      }
      return await res.json();
    } catch (error) {
      rethrowCancellation(error, signal);
      if (options?.authoritative) throw new Error('No pudimos verificar la entrega. Comprueba la conexión e inténtalo de nuevo.');
      // Fallback local autoritativo
      return evaluateDeliveryQuote(req, localStores || INITIAL_STORES, localProducts || INITIAL_PRODUCTS);
    }
  },

  async reverseGeocode(lat: number, lng: number, signal?: AbortSignal): Promise<{ address: string; formattedAddress?: string; candidates?: GeocodingCandidate[] } | null> {
    try {
      const res = await apiFetch(`${BASE_URL}/geocode/reverse?lat=${lat}&lng=${lng}`, { signal });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      rethrowCancellation(e, signal);
      console.warn('api.reverseGeocode request failed:', e);
      return null;
    }
  },

  async forwardGeocode(address: string, signal?: AbortSignal): Promise<{ coordinates: { lat: number; lng: number } | null; formattedAddress: string; candidates?: GeocodingCandidate[] } | null> {
    try {
      const res = await apiFetch(`${BASE_URL}/geocode/forward?address=${encodeURIComponent(address)}`, { signal });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      rethrowCancellation(e, signal);
      console.warn('api.forwardGeocode request failed:', e);
      return null;
    }
  },

  async getStores(): Promise<Store[]> {
    try {
      const res = await apiFetch(`${BASE_URL}/stores`);
      if (!res.ok) throw new Error('Error al consultar sedes');
      return await res.json();
    } catch {
      return INITIAL_STORES;
    }
  },

  async getCatalog(params?: { category?: string; species?: string; q?: string; storeId?: string }): Promise<Product[]> {
    try {
      const url = new URL(`${window.location.origin}${BASE_URL}/catalog`);
      if (params?.category) url.searchParams.append('category', params.category);
      if (params?.species) url.searchParams.append('species', params.species);
      if (params?.q) url.searchParams.append('q', params.q);
      if (params?.storeId) url.searchParams.append('storeId', params.storeId);

      const res = await apiFetch(url.toString());
      if (!res.ok) throw new Error('Error al cargar catálogo');
      return await res.json();
    } catch {
      throw new Error('No se pudo cargar el catálogo. Comprueba la conexión e inténtalo nuevamente.');
    }
  },

  async createOrder(payload: any): Promise<Order> {
    const res = await apiFetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'No se pudo crear el pedido');
    }
    const order = await res.json();
    if (order.customerAccessToken) {
      const access = savedOrderAccess();
      access[order.id] = order.customerAccessToken;
      inMemoryAccess[order.id] = order.customerAccessToken;
      try { localStorage.setItem(ORDER_KEYS, JSON.stringify(access)); } catch { console.warn('El navegador conservará el acceso al pedido solamente durante esta sesión.'); }
      delete order.customerAccessToken;
    }
    return order;
  },

  async getMyOrders(): Promise<Order[]> {
    const orders = await Promise.all(Object.keys(savedOrderAccess()).map(id => api.getOrder(id).catch(() => null)));
    return orders.filter((order): order is Order => !!order).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  },

  async priceCart(storeId: string, items: { productId: string; quantity: number }[], signal?: AbortSignal): Promise<{ subtotal: number; discount: number; promotionName?: string; shipping: number; serviceFee: number; total: number }> {
    const response = await apiFetch(`${BASE_URL}/cart/price`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId, items }), signal });
    if (!response.ok) throw new Error((await response.json()).error || 'No se pudo verificar el total.');
    return response.json();
  },

  async getOrder(orderId: string, signal?: AbortSignal): Promise<Order> {
    const res = await apiFetch(`${BASE_URL}/orders/${encodeURIComponent(orderId)}`, { signal });
    if (!res.ok) throw new Error('Pedido no encontrado');
    return await res.json();
  },

  async getOrders(params?: { storeId?: string; status?: string }): Promise<Order[]> {
    const url = new URL(`${window.location.origin}${BASE_URL}/orders`);
    if (params?.storeId) url.searchParams.append('storeId', params.storeId);
    if (params?.status) url.searchParams.append('status', params.status);
    const res = await apiFetch(url.toString());
    if (!res.ok) throw new ApiRequestError('Error al cargar pedidos', res.status);
    return await res.json();
  },

  async uploadPrescription(orderId: string, data: { documentUrl: string; documentName: string; vetName?: string; vetLicense?: string }): Promise<any> {
    const res = await apiFetch(`${BASE_URL}/orders/${orderId}/prescription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Error al subir fórmula veterinaria');
    return await res.json();
  },

  async getTracking(orderId: string, shipmentId?: string, signal?: AbortSignal): Promise<OrderTrackingSnapshot> {
    const url = shipmentId
      ? `${BASE_URL}/orders/${encodeURIComponent(orderId)}/tracking?shipmentId=${encodeURIComponent(shipmentId)}`
      : `${BASE_URL}/orders/${encodeURIComponent(orderId)}/tracking`;
    const res = await apiFetch(url, { signal });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiRequestError(err.error || 'Error al consultar rastreo', res.status);
    }
    return await res.json();
  },

  async getTelemetryHistory(orderId: string, shipmentId?: string): Promise<{ orderId: string; shipmentId?: string; history: GPSTrackingPoint[]; count: number }> {
    const url = shipmentId
      ? `${BASE_URL}/orders/${orderId}/telemetry/history?shipmentId=${encodeURIComponent(shipmentId)}`
      : `${BASE_URL}/orders/${orderId}/telemetry/history`;
    const res = await apiFetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al consultar historial de telemetría');
    }
    return await res.json();
  },

  async verifyDelivery(orderId: string, deliveryCode: string, shipmentId?: string): Promise<any> {
    const res = await apiFetch(`${BASE_URL}/orders/${orderId}/verify-delivery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliveryCode, shipmentId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Código incorrecto');
    }
    return await res.json();
  },

  async sendGpsTelemetry(telemetry: GPSTelemetry, driverId?: string, signal?: AbortSignal): Promise<{ status: string; point: GPSTelemetry; count: number }> {
    const res = await apiFetch(`${BASE_URL}/driver/gps`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-actor-role': 'CONDUCTOR',
        ...(driverId ? { 'x-driver-id': driverId } : {}),
      },
      body: JSON.stringify(telemetry),
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiRequestError(err.error || `Error enviando telemetría GPS (${res.status})`, res.status, err.nextSequenceNumber);
    }
    return await res.json();
  },

  async updateOrderStatus(
    orderId: string,
    status: string,
    shipmentId?: string,
    reason?: string,
    deliveryCode?: string,
    role?: string
  ): Promise<any> {
    const res = await apiFetch(`${BASE_URL}/operations/orders/${orderId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(role ? { 'x-actor-role': role } : {}),
      },
      body: JSON.stringify({ status, shipmentId, reason, deliveryCode }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al actualizar estado');
    }
    return await res.json();
  },

  async getOrderHistory(orderId: string): Promise<any> {
    const res = await apiFetch(`${BASE_URL}/orders/${orderId}/history`);
    if (!res.ok) throw new Error('Error al consultar historial del pedido');
    return await res.json();
  },

  async cancelOrder(orderId: string, reason?: string, role: string = 'CLIENTE'): Promise<any> {
    const res = await apiFetch(`${BASE_URL}/orders/${orderId}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-actor-role': role,
      },
      body: JSON.stringify({ reason, role }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'No se pudo cancelar el pedido');
    }
    return await res.json();
  },

  async confirmPhysicalReturn(orderId: string, inspectorName: string, notes?: string, shipmentId?: string): Promise<any> {
    const res = await apiFetch(`${BASE_URL}/operations/orders/${orderId}/confirm-physical-return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectorName, notes, shipmentId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al confirmar devolución física');
    }
    return await res.json();
  },

  async reviewPrescription(orderId: string, status: 'APROBADA' | 'RECHAZADA', reviewNotes: string, reviewerName?: string): Promise<any> {
    const res = await apiFetch(`${BASE_URL}/operations/orders/${orderId}/prescription/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, reviewNotes, reviewerName }),
    });
    return await res.json();
  },

  async assignDriver(orderId: string, driverId: string, shipmentId?: string): Promise<any> {
    const res = await apiFetch(`${BASE_URL}/operations/orders/${orderId}/assign-driver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId, shipmentId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al asignar conductor');
    }
    return await res.json();
  },

  async getIntegrationsStatus(): Promise<any> {
    try {
      const res = await apiFetch(`${BASE_URL}/integrations/status`);
      return await res.json();
    } catch {
      return {
        shopifyOlfato: { name: 'Shopify / Olfato', status: 'En pruebas', lastSync: new Date().toISOString() },
        siigoNube: { name: 'Siigo Nube', status: 'En pruebas', lastSync: new Date().toISOString() },
        wompi: { name: 'Wompi Colombia', status: 'Conectada (Sandbox)', lastTransaction: new Date().toISOString() },
        whatsappBot: { name: 'WhatsApp Bot', status: 'Conectada (Simulador)', activeConversations: 2 },
      };
    }
  },

  async verifyStoreEntrance(storeId: string, coordinates: { lat: number; lng: number }, verifiedBy?: string): Promise<any> {
    const res = await apiFetch(`${BASE_URL}/stores/${storeId}/verify-entrance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates, verifiedBy }),
    });
    if (!res.ok) throw new Error('Error al guardar verificación de entrada de bodega');
    return await res.json();
  },

  async getShopifyStatus(): Promise<any> {
    try {
      const res = await apiFetch(`${BASE_URL}/shopify/status`);
      if (!res.ok) throw new Error('Error al consultar estado de Shopify');
      return await res.json();
    } catch {
      // Fallback a servicio cliente
      const { shopifyService } = await import('./shopifyService');
      return shopifyService.getState();
    }
  },

  async syncShopifyInventory(): Promise<any> {
    try {
      const res = await apiFetch(`${BASE_URL}/shopify/sync`, { method: 'POST' });
      if (!res.ok) throw new Error('Error al sincronizar inventario con Shopify');
      return await res.json();
    } catch {
      const { shopifyService } = await import('./shopifyService');
      const state = await shopifyService.triggerReconciliation();
      return { message: 'Sincronización simulada exitosa', state };
    }
  },

  async simulateShopifyWebhook(storeId: string, sku: string, newOnHand: number, committed: number = 0): Promise<any> {
    const res = await apiFetch(`${BASE_URL}/shopify/simulate-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, sku, newOnHand, committed }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al simular webhook de Shopify');
    }
    return await res.json();
  },
};
