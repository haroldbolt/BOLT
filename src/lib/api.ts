import type {AddressSearchResult} from './addressSearch';
import {backendAuthorization} from './backendRequest';
import { Product, Store, Order, GPSTelemetry, DriverProfile, GPSTrackingPoint, DeliveryTracking } from '../types';
import { INITIAL_PRODUCTS, INITIAL_STORES, INITIAL_ORDERS, INITIAL_DRIVERS } from '../data/seedData';
import { DeliveryQuote, QuoteRequest, evaluateDeliveryQuote } from './deliveryService';

const BASE_URL = '/api/v1';
let pendingCheckoutRequest: {fingerprint:string;requestId:string} | undefined;

const guestOrderKey='bolt_guest_order_access_v1';
let guestOrderMemory:Record<string,string>={};
function guestOrderTokens():Record<string,string>{try{return {...guestOrderMemory,...JSON.parse(localStorage.getItem(guestOrderKey)||'{}')}}catch{return guestOrderMemory}}
function saveOrderAccess(id:string,token:string){guestOrderMemory={...guestOrderTokens(),[id]:token};try{localStorage.setItem(guestOrderKey,JSON.stringify(guestOrderMemory))}catch{}}
function authorizedFetch(url:RequestInfo|URL,init:RequestInit={},guestOnly=false){
  const headers=new Headers(init.headers),path=String(url),match=path.match(/\/orders\/([^/?]+)/);
  if(!guestOnly){const origin=typeof window==='undefined'?'http://localhost':window.location.origin;const auth=backendAuthorization(url,api.getStoredAdminToken(),origin);if(auth.has('Authorization')&&!headers.has('Authorization'))headers.set('Authorization',auth.get('Authorization')!);}
  if(match && new URL(path,typeof window==='undefined'?'http://localhost':window.location.origin).origin===(typeof window==='undefined'?'http://localhost':window.location.origin) && new URL(path,'http://localhost').pathname.startsWith('/api/v1/orders/')){const token=guestOrderTokens()[decodeURIComponent(match[1])];if(token)headers.set('X-Order-Token',token);}
  return fetch(url,{...init,headers});
}

export const api = {
  saveOrderAccess,
  async uploadEntrancePhoto(orderId:string,photoId:string,blob:Blob,destinationKey:string) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try {
      const res=await authorizedFetch(`${BASE_URL}/orders/${encodeURIComponent(orderId)}/entrance-photo`,{method:'PUT',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'image/jpeg','X-Photo-Id':photoId,'X-Photo-Destination':encodeURIComponent(destinationKey)},body:blob},true);
      if(!res.ok){const data=await res.json().catch(()=>({}));throw new Error(data.error || 'La foto quedó pendiente. Puedes reintentar desde el seguimiento.');}
    }catch(error){if(controller.signal.aborted)throw Error('El envío de la foto tardó demasiado. Tu pedido sigue confirmado; puedes reintentar la foto.');throw error;}
    finally{clearTimeout(timer)}
  },
  async getEntrancePhoto(orderId:string,audience:'customer'|'admin'|'driver',dispatchId?:string,driverToken?:string):Promise<Blob|null> {
    const res=audience==='driver'
      ?await fetch(`${BASE_URL}/driver/dispatches/${encodeURIComponent(dispatchId||'')}/entrance-photo`,{cache:'no-store',headers:{Authorization:`Bearer ${driverToken||''}`}})
      :await authorizedFetch(`${BASE_URL}/orders/${encodeURIComponent(orderId)}/entrance-photo`,{cache:'no-store'},audience==='customer');
    if(res.status===404)return null;if(!res.ok)throw Error('No pudimos cargar la foto.');return res.blob();
  },
  async transportAdmin(path:string, method='GET', body?:unknown) {
    const res=await authorizedFetch(`${BASE_URL}/admin/${path}`,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${api.getStoredAdminToken() || ''}`},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await res.json();if(!res.ok)throw new Error(data.error || 'No se pudo guardar transporte');return data;
  },
  async getDeliveryQuote(req: QuoteRequest, localStores?: Store[], localProducts?: Product[]): Promise<DeliveryQuote> {
    const res = await authorizedFetch(`${BASE_URL}/delivery/quote`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(req), cache:'no-store'
    });
    if(!res.ok) throw new Error('No se pudo validar la entrega. Intenta nuevamente.');
    return res.json();
  },

  async reverseGeocode(lat: number, lng: number): Promise<{ address: string; formattedAddress?: string; municipality?: string; locality?: string; neighborhood?: string } | null> {
    try {
      const res = await authorizedFetch(`${BASE_URL}/geocode/reverse?lat=${lat}&lng=${lng}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.warn('api.reverseGeocode request failed:', e);
      return null;
    }
  },

  async forwardGeocode(address: string, municipality: string): Promise<AddressSearchResult> {
    try {
      const query=new URLSearchParams({address,municipality});
      const res = await authorizedFetch(`${BASE_URL}/geocode/forward?${query}`,{cache:'no-store'});
      if (!res.ok) throw Error('Address lookup unavailable');
      const result=await res.json();
      if(!Array.isArray(result?.candidates)) throw Error('Address search response changed; retry after reload');
      return result;
    } catch {
      return {status:'UNAVAILABLE',candidates:[],message:'No pudimos consultar el mapa. Conservamos tu dirección; intenta de nuevo.'};
    }
  },

  async getStores(): Promise<Store[]> {
    try {
      const res = await authorizedFetch(`${BASE_URL}/stores`);
      if (!res.ok) throw new Error('Error al consultar sedes');
      return await res.json();
    } catch {
      return INITIAL_STORES;
    }
  },

  async getCatalog(params?: { category?: string; species?: string; q?: string; storeId?: string }, options?: { requireServer?: boolean }): Promise<Product[]> {
    try {
      const url = new URL(`${window.location.origin}${BASE_URL}/catalog`);
      if (params?.category) url.searchParams.append('category', params.category);
      if (params?.species) url.searchParams.append('species', params.species);
      if (params?.q) url.searchParams.append('q', params.q);
      if (params?.storeId) url.searchParams.append('storeId', params.storeId);

      const res = await authorizedFetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) throw new Error('Error al cargar catálogo');
      const catalog = await res.json();
      if (!Array.isArray(catalog)) throw new Error('Catálogo inválido');
      return catalog;
    } catch (error) {
      if (options?.requireServer) throw error;
      return INITIAL_PRODUCTS;
    }
  },

  async createOrder(payload: any): Promise<Order> {
    const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload))))).map(b=>b.toString(16).padStart(2,'0')).join('');
    let requestId=pendingCheckoutRequest?.fingerprint===fingerprint ? pendingCheckoutRequest.requestId : crypto.randomUUID();
    try {
      const previous=JSON.parse(sessionStorage.getItem('bolt_checkout_request') || 'null');
      if(previous?.fingerprint===fingerprint) requestId=previous.requestId;
      sessionStorage.setItem('bolt_checkout_request',JSON.stringify({fingerprint,requestId}));
    } catch {}
    pendingCheckoutRequest={fingerprint,requestId};
    const res = await authorizedFetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key':requestId },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'No se pudo crear el pedido');
    }
    const created:Order=await res.json();
    if(created.guestAccessToken && !(created as any).customerAccountId)saveOrderAccess(created.id,created.guestAccessToken);
    pendingCheckoutRequest=undefined;
    try {sessionStorage.removeItem('bolt_checkout_request')} catch {}
    return created;
  },

  async getOrder(orderId: string, guestOnly=false): Promise<Order> {
    const res = await authorizedFetch(`${BASE_URL}/orders/${orderId}`,{},guestOnly);
    if (!res.ok) throw new Error('Pedido no encontrado');
    return await res.json();
  },

  async getGuestOrders():Promise<Order[]> {
    const results=await Promise.allSettled(Object.keys(guestOrderTokens()).map(id=>api.getOrder(id,true)));
    return results.filter((r):r is PromiseFulfilledResult<Order>=>r.status==='fulfilled').map(r=>r.value);
  },
  async getCustomerOrders(authenticated:boolean):Promise<Order[]> {
    if(!authenticated)return api.getGuestOrders();
    const response=await fetch('/api/customer/orders',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw Error('No se pudieron consultar tus pedidos');return response.json();
  },
  async linkGuestOrder(id:string) {
    const token=guestOrderTokens()[id];if(!token)throw Error('Recupera primero el acceso privado a esta compra.');
    const me=await fetch('/api/customer/me',{credentials:'same-origin',cache:'no-store'}).then(r=>r.json());
    if(!me.user?.id)throw Error('Inicia sesión antes de vincular la compra.');
    const response=await fetch(`/api/customer/orders/${encodeURIComponent(id)}/link`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Order-Token':token,'X-Customer-Id':me.user.id},body:'{}'});
    const data=await response.json();if(!response.ok)throw Error(data.error||'No se pudo vincular la compra');
  },

  async getOrders(params?: { storeId?: string; status?: string }): Promise<Order[]> {
    if(!api.getStoredAdminToken()){const results=await Promise.allSettled(Object.keys(guestOrderTokens()).map(id=>api.getOrder(id)));return results.filter((r):r is PromiseFulfilledResult<Order>=>r.status==='fulfilled').map(r=>r.value).filter(o=>(!params?.storeId||o.storeId===params.storeId)&&(!params?.status||o.fulfillmentStatus===params.status));}
    try {
      const url = new URL(`${window.location.origin}${BASE_URL}/orders`);
      if (params?.storeId) url.searchParams.append('storeId', params.storeId);
      if (params?.status) url.searchParams.append('status', params.status);
      const res = await authorizedFetch(url.toString());
      if (!res.ok) throw new Error('Error al cargar pedidos');
      return await res.json();
    } catch {
      return [];
    }
  },

  async uploadPrescription(orderId: string, data: { documentUrl: string; documentName: string; vetName?: string; vetLicense?: string }): Promise<any> {
    const res = await authorizedFetch(`${BASE_URL}/orders/${orderId}/prescription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Error al subir fórmula veterinaria');
    return await res.json();
  },

  async getTracking(orderId: string, shipmentId?: string, guestOnly=false): Promise<DeliveryTracking> {
    const url = shipmentId
      ? `${BASE_URL}/orders/${orderId}/tracking?shipmentId=${encodeURIComponent(shipmentId)}`
      : `${BASE_URL}/orders/${orderId}/tracking`;
    const res = await authorizedFetch(url,{},guestOnly);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al consultar rastreo');
    }
    return await res.json();
  },

  async getTelemetryHistory(orderId: string, shipmentId?: string): Promise<{ orderId: string; shipmentId?: string; history: GPSTrackingPoint[]; count: number }> {
    const url = shipmentId
      ? `${BASE_URL}/orders/${orderId}/telemetry/history?shipmentId=${encodeURIComponent(shipmentId)}`
      : `${BASE_URL}/orders/${orderId}/telemetry/history`;
    const res = await authorizedFetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al consultar historial de telemetría');
    }
    return await res.json();
  },

  async verifyDelivery(orderId: string, deliveryCode: string, shipmentId?: string): Promise<any> {
    const res = await authorizedFetch(`${BASE_URL}/orders/${orderId}/verify-delivery`, {
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

  async sendGpsTelemetry(telemetry: GPSTelemetry | GPSTrackingPoint, driverId?: string): Promise<{ status: string; point: any; count: number }> {
    const res = await authorizedFetch(`${BASE_URL}/driver/gps`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-actor-role': 'CONDUCTOR',
        ...(driverId ? { 'x-driver-id': driverId } : {}),
      },
      body: JSON.stringify(telemetry),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Error enviando telemetría GPS (${res.status})`);
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
    const res = await authorizedFetch(`${BASE_URL}/operations/orders/${orderId}/status`, {
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
    const res = await authorizedFetch(`${BASE_URL}/orders/${orderId}/history`);
    if (!res.ok) throw new Error('Error al consultar historial del pedido');
    return await res.json();
  },

  async cancelOrder(orderId: string, reason?: string, role: string = 'CLIENTE', shipmentId?: string, guestOnly=false): Promise<any> {
    const res = await authorizedFetch(`${BASE_URL}/orders/${orderId}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-actor-role': role,
      },
      body: JSON.stringify({ reason, role, shipmentId }),
    },guestOnly);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'No se pudo cancelar el pedido');
    }
    return await res.json();
  },

  async confirmPhysicalReturn(orderId: string, inspectorName: string, notes?: string, shipmentId?: string): Promise<any> {
    const res = await authorizedFetch(`${BASE_URL}/operations/orders/${orderId}/confirm-physical-return`, {
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
    const res = await authorizedFetch(`${BASE_URL}/operations/orders/${orderId}/prescription/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, reviewNotes, reviewerName }),
    });
    return await res.json();
  },

  async assignDriver(orderId: string, driverId: string, shipmentId?: string): Promise<any> {
    const res = await authorizedFetch(`${BASE_URL}/operations/orders/${orderId}/assign-driver`, {
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
      const res = await authorizedFetch(`${BASE_URL}/integrations/status`);
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
    const res = await authorizedFetch(`${BASE_URL}/stores/${storeId}/verify-entrance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates, verifiedBy }),
    });
    if (!res.ok) throw new Error('Error al guardar verificación de entrada de bodega');
    return await res.json();
  },

  async getShopifyStatus(): Promise<any> {
    try {
      const res = await authorizedFetch(`${BASE_URL}/shopify/status`);
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
      const res = await authorizedFetch(`${BASE_URL}/shopify/sync`, { method: 'POST' });
      if (!res.ok) throw new Error('Error al sincronizar inventario con Shopify');
      return await res.json();
    } catch {
      const { shopifyService } = await import('./shopifyService');
      const state = await shopifyService.triggerReconciliation();
      return { message: 'Sincronización simulada exitosa', state };
    }
  },

  async simulateShopifyWebhook(storeId: string, sku: string, newOnHand: number, committed: number = 0): Promise<any> {
    const res = await authorizedFetch(`${BASE_URL}/shopify/simulate-webhook`, {
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

  // ==========================================
  // AUTENTICACIÓN Y SEGURIDAD ADMINISTRATIVA
  // ==========================================

  getStoredAdminToken(): string | null {
    try{return localStorage.getItem('bolt_admin_token') || sessionStorage.getItem('bolt_admin_token');}catch{return null;}
  },

  setStoredAdminToken(token: string | null): void {
    if (token) {
      localStorage.setItem('bolt_admin_token', token);
      sessionStorage.setItem('bolt_admin_token', token);
    } else {
      localStorage.removeItem('bolt_admin_token');
      sessionStorage.removeItem('bolt_admin_token');
    }
  },

  async getAuthStatus(): Promise<{ isSetupRequired: boolean; isAuthenticated: boolean; user?: any }> {
    const token = this.getStoredAdminToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await authorizedFetch(`${BASE_URL}/auth/status`, { headers });
    if (!res.ok) throw new Error('Error al consultar estado de autenticación');
    return await res.json();
  },

  async setupMasterAdmin(payload: { email: string; password: string; name: string }): Promise<any> {
    const res = await authorizedFetch(`${BASE_URL}/auth/setup-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al configurar administrador');
    if (data.token) {
      this.setStoredAdminToken(data.token);
    }
    return data;
  },

  async loginAdmin(email: string, password: string): Promise<any> {
    const res = await authorizedFetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Credenciales inválidas');
    if (data.token) {
      this.setStoredAdminToken(data.token);
    }
    return data;
  },

  async getAdminMe(): Promise<any> {
    const token = this.getStoredAdminToken();
    if (!token) return null;
    const res = await authorizedFetch(`${BASE_URL}/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) {
      this.setStoredAdminToken(null);
      return null;
    }
    return await res.json();
  },

  async logoutAdmin(): Promise<void> {
    const token = this.getStoredAdminToken();
    if (token) {
      await authorizedFetch(`${BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      }).catch(() => {});
    }
    this.setStoredAdminToken(null);
  },

  // ==========================================
  // GESTIÓN DE CATÁLOGO ADMINISTRATIVO (CRUD)
  // ==========================================

  async getAdminCatalog(params?: { q?: string; category?: string; status?: string }): Promise<Product[]> {
    const token = this.getStoredAdminToken();
    const url = new URL(`${window.location.origin}${BASE_URL}/admin/catalog`);
    if (params?.q) url.searchParams.append('q', params.q);
    if (params?.category) url.searchParams.append('category', params.category);
    if (params?.status) url.searchParams.append('status', params.status);

    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await authorizedFetch(url.toString(), { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al consultar catálogo administrativo');
    }
    return await res.json();
  },

  async createAdminProduct(productData: Partial<Product>): Promise<Product> {
    const token = this.getStoredAdminToken();
    const res = await authorizedFetch(`${BASE_URL}/admin/catalog/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(productData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al crear producto');
    return data.product;
  },

  async updateAdminProduct(id: string, updates: Partial<Product>): Promise<Product> {
    const token = this.getStoredAdminToken();
    const res = await authorizedFetch(`${BASE_URL}/admin/catalog/products/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al actualizar producto');
    return data.product;
  },

  async toggleProductStatus(id: string): Promise<{ product: Product; newStatus: string }> {
    const token = this.getStoredAdminToken();
    const res = await authorizedFetch(`${BASE_URL}/admin/catalog/products/${id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al cambiar estado del producto');
    return data;
  },

  async updateVariantPriceStock(id: string, payload: { expectedRevision?: string; variantId?: string; priceCOP?: number; stockByStore?: Record<string, number>; presentationName?: string }): Promise<Product> {
    const token = this.getStoredAdminToken();
    const res = await authorizedFetch(`${BASE_URL}/admin/catalog/products/${id}/pricing-stock`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al actualizar precio o inventario');
    return data.product;
  },

  async applyCatalogImages(patches: import('./catalogImagePatch').CatalogImagePatch[]): Promise<{changed:number}> {
    const res=await authorizedFetch(`${BASE_URL}/admin/catalog/images/apply`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({patches})});
    const data=await res.json();if(!res.ok)throw new Error(data.error||'No se pudo guardar la fotografía');return data;
  },

  async uploadCatalogImage(dataUrl: string, filename?: string): Promise<{ url: string; filename: string; size: number }> {
    const token = this.getStoredAdminToken();
    const res = await authorizedFetch(`${BASE_URL}/admin/catalog/upload-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ dataUrl, filename }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al subir imagen');
    return data;
  },

  async getCatalogAuditLog(productId?: string): Promise<any[]> {
    const token = this.getStoredAdminToken();
    const url = new URL(`${window.location.origin}${BASE_URL}/admin/catalog/audit`);
    if (productId) url.searchParams.append('productId', productId);

    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await authorizedFetch(url.toString(), { headers });
    if (!res.ok) throw new Error('Error al consultar historial de auditoría');
    return await res.json();
  },
};
