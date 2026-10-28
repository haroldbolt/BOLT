import { Product, Store, Order, GPSTelemetry, DriverProfile } from '../types';
import { INITIAL_ORDERS, INITIAL_DRIVERS } from '../data/seedData';
import { DeliveryQuote, QuoteRequest } from './deliveryService';

const BASE_URL = '/api/v1';

export const api = {
  async getDeliveryQuote(req: QuoteRequest, localStores?: Store[], localProducts?: Product[], signal?: AbortSignal): Promise<DeliveryQuote> {
      const res = await fetch(`${BASE_URL}/delivery/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal,
      });
      if (!res.ok) {
        throw new Error('Error del servidor en cotización');
      }
      return await res.json();
  },

  async reverseGeocode(lat: number, lng: number): Promise<{ address: string; formattedAddress?: string } | null> {
    try {
      const res = await fetch(`${BASE_URL}/geocode/reverse?lat=${lat}&lng=${lng}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.warn('api.reverseGeocode request failed:', e);
      return null;
    }
  },

  async forwardGeocode(address: string): Promise<{ coordinates: { lat: number; lng: number } | null; formattedAddress: string } | null> {
    try {
      const res = await fetch(`${BASE_URL}/geocode/forward?address=${encodeURIComponent(address)}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.warn('api.forwardGeocode request failed:', e);
      return null;
    }
  },

  async getStores(): Promise<Store[]> {
    const res = await fetch(`${BASE_URL}/stores`);
    if (!res.ok) throw new Error('No pudimos consultar las bodegas. Intenta de nuevo.');
    return await res.json();
  },

  async getCatalog(params?: { category?: string; species?: string; q?: string; storeId?: string; scope?: 'admin' | 'customer' }, signal?: AbortSignal): Promise<Product[]> {
    try {
      const url = new URL(`${window.location.origin}${BASE_URL}/catalog`);
      if (params?.category) url.searchParams.append('category', params.category);
      if (params?.species) url.searchParams.append('species', params.species);
      if (params?.q) url.searchParams.append('q', params.q);
      if (params?.storeId) url.searchParams.append('storeId', params.storeId);
      if (params?.scope) url.searchParams.append('scope', params.scope);

      const res = await fetch(url.toString(), { signal });
      if (!res.ok) throw new Error('Error al cargar catálogo');
      return await res.json();
    } catch (error) {
      throw error instanceof Error ? error : new Error('Error al cargar catálogo');
    }
  },

  async getInventoryStatus(): Promise<{
    version?: string; mode?: string; fetchedAt?: string; lastSuccessfulSync?: string;
    lastAttemptedSync?: string; nextSyncAt?: string; automaticSync?: boolean; liveVerified?: boolean;
    isStale?: boolean; credentialsConfigured?: boolean; reconciliationIntervalMinutes?: number; errorMessage?: string;
  }> {
    const res = await fetch(`${BASE_URL}/inventory/status`, { cache: 'no-store' });
    if (!res.ok) throw new Error('No pudimos revisar la actualización del inventario.');
    return await res.json();
  },

  async createOrder(payload: any): Promise<Order> {
    const res = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'No se pudo crear el pedido');
    }
    return await res.json();
  },

  async getOrder(orderId: string): Promise<Order> {
    const res = await fetch(`${BASE_URL}/orders/${orderId}`);
    if (!res.ok) throw new Error('Pedido no encontrado');
    return await res.json();
  },

  async getOrders(params?: { storeId?: string; status?: string }): Promise<Order[]> {
    try {
      const url = new URL(`${window.location.origin}${BASE_URL}/orders`);
      if (params?.storeId) url.searchParams.append('storeId', params.storeId);
      if (params?.status) url.searchParams.append('status', params.status);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error('Error al cargar pedidos');
      return await res.json();
    } catch {
      return INITIAL_ORDERS;
    }
  },

  async uploadPrescription(orderId: string, data: { documentUrl: string; documentName: string; vetName?: string; vetLicense?: string }): Promise<any> {
    const res = await fetch(`${BASE_URL}/orders/${orderId}/prescription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Error al subir fórmula veterinaria');
    return await res.json();
  },

  async getTracking(orderId: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/orders/${orderId}/tracking`);
    if (!res.ok) throw new Error('Error al consultar rastreo');
    return await res.json();
  },

  async verifyDelivery(orderId: string, deliveryCode: string, shipmentId?: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/orders/${orderId}/verify-delivery`, {
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

  async sendGpsTelemetry(telemetry: GPSTelemetry): Promise<any> {
    const res = await fetch(`${BASE_URL}/driver/gps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(telemetry),
    });
    return await res.json();
  },

  async updateOrderStatus(orderId: string, status: string, shipmentId?: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/operations/orders/${orderId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, shipmentId }),
    });
    return await res.json();
  },

  async reviewPrescription(orderId: string, status: 'APROBADA' | 'RECHAZADA', reviewNotes: string, reviewerName?: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/operations/orders/${orderId}/prescription/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, reviewNotes, reviewerName }),
    });
    return await res.json();
  },

  async assignDriver(orderId: string, driverId: string, shipmentId?: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/operations/orders/${orderId}/assign-driver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId, shipmentId }),
    });
    return await res.json();
  },

  async getIntegrationsStatus(): Promise<any> {
    try {
      const res = await fetch(`${BASE_URL}/integrations/status`);
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
    const res = await fetch(`${BASE_URL}/stores/${storeId}/verify-entrance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates, verifiedBy }),
    });
    if (!res.ok) throw new Error('Error al guardar verificación de entrada de bodega');
    return await res.json();
  },

  async getShopifyStatus(): Promise<any> {
    const res = await fetch(`${BASE_URL}/shopify/status`);
    if (!res.ok) throw new Error('Error al consultar estado de Shopify');
    return await res.json();
  },

  async syncShopifyInventory(): Promise<any> {
    throw new Error('La sincronización manual requiere autorización administrativa en el servidor. Usa Revisar estado para consultar la lectura actual.');
  },

  async simulateShopifyWebhook(storeId: string, sku: string, newOnHand: number, committed: number = 0): Promise<any> {
    const res = await fetch(`${BASE_URL}/shopify/simulate-webhook`, {
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
