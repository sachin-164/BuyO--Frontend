import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { OrderDetailResponse, OrderListResponse } from "@/types/commerce";

export const orderKeys = {
  all: ["orders"] as const,
  list: (search: string) => [...orderKeys.all, "list", search] as const,
  detail: (id: number | null) => [...orderKeys.all, "detail", id] as const,
};

export interface OrderListParams {
  page?: number;
  status?: string;
}

function ordersSearch(params: OrderListParams): string {
  const search = new URLSearchParams();
  if (params.page !== undefined) search.set("page", String(params.page));
  if (params.status) search.set("status", params.status);
  return search.toString();
}

export function useOrders(params: OrderListParams, enabled = true) {
  const search = ordersSearch(params);
  const query = search ? `?${search}` : "";
  return useQuery<OrderListResponse>({
    queryKey: orderKeys.list(query),
    queryFn: ({ signal }) => api.get<OrderListResponse>(`/api/orders${query}`, signal),
    enabled,
    retry: false,
  });
}

export function useOrder(id: number | null, enabled = true) {
  return useQuery<OrderDetailResponse>({
    queryKey: orderKeys.detail(id),
    queryFn: ({ signal }) =>
      api.get<OrderDetailResponse>(`/api/orders/${id as number}`, signal),
    enabled: Boolean(id) && enabled,
    retry: false,
    staleTime: 30_000,
  });
}
