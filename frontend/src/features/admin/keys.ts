import type { OrderStatus } from "@/types/commerce";
import type { AdminOrderListResponse, AdminOrderDetailResponse } from "@/types/admin";

export const adminKeys = {
  all: ["admin"] as const,
  dashboard: () => [...adminKeys.all, "dashboard"] as const,
  ordersRoot: () => [...adminKeys.all, "orders"] as const,
  orders: (search: string) => [...adminKeys.ordersRoot(), "list", search] as const,
  order: (id: number | null) => [...adminKeys.ordersRoot(), "detail", id] as const,
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
}

/** GET /api/admin/orders supports server pagination + status filtering only. */
export function adminOrdersSearch(params: AdminOrderListParams): string {
  const search = new URLSearchParams();
  if (params.page && params.page > 1) search.set("page", String(params.page));
  if (params.status) search.set("status", params.status);
  search.set("limit", "20");
  return search.toString();
}

export type { AdminOrderListResponse, AdminOrderDetailResponse };
