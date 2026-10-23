import type { OrderStatus } from "@/types/commerce";
import type { AdminOrderListResponse, AdminOrderDetailResponse } from "@/types/admin";

export const adminKeys = {
  all: ["admin"] as const,
  dashboard: () => [...adminKeys.all, "dashboard"] as const,
  analytics: (days: number) => [...adminKeys.all, "analytics", days] as const,
  ordersRoot: () => [...adminKeys.all, "orders"] as const,
  orders: (search: string) => [...adminKeys.ordersRoot(), "list", search] as const,
  order: (id: number | null) => [...adminKeys.ordersRoot(), "detail", id] as const,
  customersRoot: () => [...adminKeys.all, "customers"] as const,
  customers: (search: string) => [...adminKeys.customersRoot(), "list", search] as const,
  customer: (id: number | null) => [...adminKeys.customersRoot(), "detail", id] as const,
  variantsRoot: () => [...adminKeys.all, "variants"] as const,
  variants: (productId: number | null) => [...adminKeys.variantsRoot(), productId] as const,
  reviewsRoot: () => [...adminKeys.all, "reviews"] as const,
  reviews: (search: string) => [...adminKeys.reviewsRoot(), "list", search] as const,
};

export interface AdminReviewListParams {
  page?: number;
  status?: "pending" | "approved" | "rejected" | "all";
  q?: string;
}

export function adminReviewsSearch(params: AdminReviewListParams): string {
  const search = new URLSearchParams();
  if (params.page && params.page > 1) search.set("page", String(params.page));
  search.set("status", params.status ?? "pending");
  const term = params.q?.trim();
  if (term) search.set("q", term);
  search.set("limit", "20");
  return search.toString();
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  placed: "Placed",
  confirmed: "Confirmed",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export interface AdminOrderListParams {
  page?: number;
  status?: OrderStatus | "";
  /** Free-text search: order number, customer name or customer email. */
  q?: string;
}

/** GET /api/admin/orders supports server pagination, status filtering and `q`. */
export function adminOrdersSearch(params: AdminOrderListParams): string {
  const search = new URLSearchParams();
  if (params.page && params.page > 1) search.set("page", String(params.page));
  if (params.status) search.set("status", params.status);
  const term = params.q?.trim();
  if (term) search.set("q", term);
  search.set("limit", "20");
  return search.toString();
}

export interface AdminCustomerListParams {
  page?: number;
  /** Free-text search: customer name or email. */
  q?: string;
}

export function adminCustomersSearch(params: AdminCustomerListParams): string {
  const search = new URLSearchParams();
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const term = params.q?.trim();
  if (term) search.set("q", term);
  search.set("limit", "20");
  return search.toString();
}

export type { AdminOrderListResponse, AdminOrderDetailResponse };
