import type {
  Category,
  Pagination,
  Product,
  ProductImageMeta,
  ProductVariant,
} from "@/types/catalog";
import type { Address } from "@/types/account";
import type {
  Order,
  OrderStatus,
  OrderSummary,
} from "@/types/commerce";

/** The customer fields the admin order API exposes (never tokens/passwords). */
export interface AdminCustomerRef {
  id: number;
  name: string;
  email: string;
}

export interface AdminOrderSummary extends OrderSummary {
  userId: number;
  user: AdminCustomerRef | null;
}

export interface AdminOrder extends Order {
  userId: number;
  user: AdminCustomerRef | null;
}

export interface AdminOrderListResponse {
  success: true;
  count: number;
  orders: AdminOrderSummary[];
  pagination: Pagination;
}

export interface AdminOrderDetailResponse {
  success: true;
  order: AdminOrder;
}

export interface AdminOrderStatusResponse {
  success: true;
  message: string;
  order: AdminOrder;
}

/**
 * JSON payload accepted by POST /api/products and PUT /api/products/:id.
 * The server stays authoritative for validation; `category` is the legacy
 * free-text column that is always mirrored alongside `categoryId`.
 */
export interface AdminProductInput {
  name: string;
  category: string;
  categoryId?: number | null;
  description?: string;
  mrpPrice: number;
  sellingPrice: number;
  /** Omitted on updates once the product is variant-managed. */
  stock?: number;
  slug?: string;
  image?: string;
  imageMeta?: ProductImageMeta;
}

export interface ProductMutationResponse {
  success: true;
  message?: string;
  product: Product;
}

export interface ProductDeleteResponse {
  success: true;
  message: string;
}

export interface AdminVariantInput {
  sku: string;
  size?: string;
  color?: string;
  stock?: number;
  priceAdjustment?: number;
  isActive?: boolean;
}

export interface AdminVariantsResponse {
  success: true;
  productId: number;
  count: number;
  variants: ProductVariant[];
}

export interface AdminVariantResponse {
  success: true;
  message?: string;
  variant: ProductVariant;
}

export interface AdminCategoryInput {
  name: string;
  slug?: string;
  description?: string;
  taxRate: number;
  /** Omit/null = top level. Validated server-side for depth and cycles. */
  parentId?: number | null;
}

export interface CategoryMutationResponse {
  success: true;
  message?: string;
  category: Category;
}

export interface CategoryDeleteResponse {
  success: true;
  message: string;
  affectedProducts: number;
  /** Children promoted to top level instead of being deleted. */
  reparentedChildren?: number;
}

/** POST /api/uploads/authorize response (hosted storage mode only). */
export interface UploadAuthorizationResponse {
  success: true;
  objectPath: string;
  signedUploadUrl: string;
  publicUrl: string;
  expiresAt: string;
  maxBytes: number;
}

export const ORDER_STATUS_VALUES: OrderStatus[] = [
  "placed",
  "confirmed",
  "shipped",
  "delivered",
  "cancelled",
];

/** GET /api/admin/customers — one row per customer with aggregated order stats. */
export interface AdminCustomerSummary {
  id: number;
  name: string;
  email: string;
  isVerified: boolean;
  role: "customer" | "admin";
  createdAt: string;
  orderCount: number;
  cancelledCount: number;
  totalSpend: number;
  lastOrderAt: string | null;
}

export interface AdminCustomerOrderRef {
  id: number;
  orderNumber: string;
  status: OrderStatus;
  grandTotal: number;
  createdAt: string;
  itemCount: number;
}

export interface AdminCustomerDetail extends AdminCustomerSummary {
  addresses: Address[];
}

export interface AdminCustomerListResponse {
  success: true;
  count: number;
  customers: AdminCustomerSummary[];
  pagination: Pagination;
}

export interface AdminCustomerDetailResponse {
  success: true;
  customer: AdminCustomerDetail;
  orders: AdminCustomerOrderRef[];
}

export interface AdminLowStockProduct {
  id: number;
  name: string;
  stock: number;
  image?: string | null;
  category: string | null;
}

export interface AdminRevenuePoint {
  day: string;
  revenue: number;
  orders: number;
}

export interface AdminTopProduct {
  productId: number | null;
  name: string;
  revenue: number;
  units: number;
}

/**
 * GET /api/admin/analytics/summary.
 * Every figure is a server-side SQL aggregate — nothing here is derived from a
 * capped page walk, so there are no "truncated" variants of these numbers.
 */
export interface AdminAnalyticsSummary {
  success: true;
  generatedAt: string;
  range: { days: number; from: string };
  products: {
    total: number;
    outOfStock: number;
    lowStockCount: number;
    lowStockThreshold: number;
    lowStock: AdminLowStockProduct[];
  };
  categories: { total: number };
  customers: { total: number; newInRange: number };
  orders: {
    total: number;
    byStatus: Record<OrderStatus, number>;
    nonCancelledCount: number;
    grossOrderValue: number;
    averageOrderValue: number;
  };
  revenueSeries: AdminRevenuePoint[];
  topProducts: AdminTopProduct[];
  recentOrders: Array<{
    id: number;
    orderNumber: string;
    status: OrderStatus;
    grandTotal: number;
    createdAt: string;
    itemCount: number;
    user: AdminCustomerRef | null;
  }>;
}
