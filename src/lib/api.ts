import { Product, Store, Order, GPSTelemetry, DriverProfile } from '../types';
import { INITIAL_PRODUCTS, INITIAL_STORES, INITIAL_ORDERS, INITIAL_DRIVERS } from '../data/seedData';

const BASE_URL = '/api/v1';

export const api = {
  async getStores(): Promise<Store[]> {
    try {
      const res = await fetch(`${BASE_URL}/stores`);
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

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error('Error al cargar catálogo');
      return await res.json();
    } catch {
      return INITIAL_PRODUCTS;
    }
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

  async verifyDelivery(orderId: string, deliveryCode: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/orders/${orderId}/verify-delivery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliveryCode }),
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

  async updateOrderStatus(orderId: string, status: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/operations/orders/${orderId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
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

  async assignDriver(orderId: string, driverId: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/operations/orders/${orderId}/assign-driver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId }),
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
};
