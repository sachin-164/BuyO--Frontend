import type {
  Category,
  Pagination,
  Product,
  ProductImageMeta,
} from "@/types/catalog";
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
  stock: number;
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

export interface AdminCategoryInput {
  name: string;
  slug?: string;
  description?: string;
  taxRate: number;
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
