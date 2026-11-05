import type { Product, ProductPresentation } from '../types';

export interface AdminUser { id: string; username: string; displayName: string; }
export interface AdminSession {
  authenticated: boolean;
  user?: AdminUser;
  csrfToken?: string;
  setupRequired: boolean;
}
export interface AdminPresentation extends ProductPresentation {
  price?: number;
  weightKg?: number;
  stockByStore?: Record<string, number>;
  reservedStockByStore?: Record<string, number>;
  inventoryVerifiedByStore?: Record<string, boolean>;
}
export interface AdminProduct extends Product {
  presentaciones?: AdminPresentation[];
  version: number;
  updatedAt: string;
  dataPending: string[];
  inventoryVerifiedByStore?: Record<string, boolean>;
}
export interface AdminPromotion {
  id: string;
  name: string;
  type: 'PERCENTAGE' | 'FIXED';
  value: number;
  productIds: string[];
  variantIds: string[];
  storeIds: string[];
  startsAt: string;
  endsAt: string;
  minSubtotal: number;
  active: boolean;
  version: number;
  updatedAt: string;
}
export interface InventoryMovement {
  id: string;
  productId: string;
  productName: string;
  variantId?: string;
  storeId: string;
  previousQuantity: number;
  quantity: number;
  reserved: number;
  reason: string;
  actorId: string;
  actorName: string;
  createdAt: string;
}
export interface AdminAuditEntry {
  id: string;
  action: string;
  resourceId: string;
  actorId: string;
  actorName: string;
  detail: string;
  createdAt: string;
}
export interface DiscountResult {
  discount: number;
  promotionId?: string;
  promotionName?: string;
}
