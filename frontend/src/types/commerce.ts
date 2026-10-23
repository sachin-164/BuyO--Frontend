export interface CartVariantInfo {
  id: number;
  sku: string;
  size: string | null;
  color: string | null;
}

export interface CartItem {
  id: number;
  productId: number | null;
  /** NULL = the legacy/base line of a product without active variants. */
  variantId?: number | null;
  variant?: CartVariantInfo | null;
  qty: number;
  name: string;
  price: number | null;
  image: string | null;
  lineTotal: number;
  stock: number | null;
  stockExceeded: boolean;
  unavailable: boolean;
  unavailableReason?: string | null;
}

export interface CartTaxGroup {
  categoryId: number | null;
  categoryName: string | null;
  taxRate: number;
  taxableAmount: number;
  taxAmount: number;
}

export interface CartTotals {
  subtotal: number;
  tax: {
    total: number;
    byCategory: CartTaxGroup[];
    preview: boolean;
  };
  grandTotal: number;
}

export interface CartResponse {
  success: true;
  message?: string;
  count: number;
  items: CartItem[];
  totals: CartTotals;
  totalsNotice?: string;
}

export interface WishlistItem {
  id: number;
  productId: number | null;
  name: string;
  price: number | null;
  image: string | null;
  inStock: boolean;
  unavailable: boolean;
}

export interface WishlistResponse {
  success: true;
  count: number;
  items: WishlistItem[];
}

export interface WishlistToggleResponse {
  success: true;
  message: string;
  inWishlist: boolean;
  count?: number;
}

export interface WishlistCheckResponse {
  success: true;
  productId: number;
  inWishlist: boolean;
}

export interface WishlistRemoveResponse {
  success: true;
  message: string;
  inWishlist: false;
}

export type OrderStatus =
  | "placed"
  | "confirmed"
  | "shipped"
  | "delivered"
  | "cancelled";

export interface OrderItem {
  id: number;
  productId: number | null;
  /** Frozen variant snapshots; all null for legacy/base-product lines. */
  variantId?: number | null;
  variantSku?: string | null;
  variantSize?: string | null;
  variantColor?: string | null;
  variantPriceAdjustment?: number | null;
  name: string;
  image?: string | null;
  unitPrice: number;
  qty: number;
  lineTotal: number;
  taxRate?: number;
  taxAmount?: number;
  categoryName?: string | null;
}

export interface OrderStatusEvent {
  id: number;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  note: string | null;
  createdAt: string;
}

export interface ShippingAddressSnapshot {
  label?: string | null;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
}

export interface OrderSummary {
  id: number;
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: "cod";
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  createdAt: string;
  /** Server-derived: true only while the order can still be cancelled. */
  canCancel?: boolean;
  items: OrderItem[];
}

export interface Order extends OrderSummary {
  taxBreakdown: CartTaxGroup[] | null;
  shippingAddress: ShippingAddressSnapshot;
  addressId: number | null;
  notes: string | null;
  statusEvents: OrderStatusEvent[];
}

export interface OrderListResponse {
  success: true;
  count: number;
  orders: OrderSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface OrderDetailResponse {
  success: true;
  order: Order;
}

export interface CreateOrderResponse {
  success: true;
  message?: string;
  idempotentReplay?: boolean;
  order: Order;
}

export interface CancelOrderResponse {
  success: true;
  message: string;
  order: Order;
}

export interface CheckoutConflict {
  productId: number | null;
  name: string;
  requested: number;
  available: number;
  reason: string;
}
