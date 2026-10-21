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
};

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
