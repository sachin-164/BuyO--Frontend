import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  adminKeys,
  adminOrdersSearch,
  adminCustomersSearch,
  adminReviewsSearch,
  type AdminOrderListParams,
  type AdminCustomerListParams,
  type AdminReviewListParams,
} from "@/features/admin/keys";
import type {
  AdminAnalyticsSummary,
  AdminCustomerDetailResponse,
  AdminCustomerListResponse,
  AdminOrder,
  AdminOrderDetailResponse,
  AdminOrderListResponse,
  AdminOrderSummary,
  AdminVariantsResponse,
} from "@/types/admin";
import type { AdminReviewsResponse } from "@/types/reviews";

/**
 * Server-side aggregate dashboard.
 *
 * Replaces the previous client-side page walk (which capped at 2,500 products
 * and 5,000 orders and silently reported partial figures past those limits).
 * One request, no truncation.
 */
export function useAdminDashboard(days = 30) {
  return useQuery<AdminAnalyticsSummary>({
    queryKey: adminKeys.analytics(days),
    queryFn: ({ signal }) =>
      api.get<AdminAnalyticsSummary>(`/api/admin/analytics/summary?days=${days}`, signal),
  });
}

export function useAdminOrders(params: AdminOrderListParams) {
  const search = adminOrdersSearch(params);
  return useQuery<AdminOrderListResponse>({
    queryKey: adminKeys.orders(search),
    queryFn: ({ signal }) =>
      api.get<AdminOrderListResponse>(`/api/admin/orders?${search}`, signal),
  });
}

export function useAdminOrder(id: number | null) {
  return useQuery<AdminOrderDetailResponse>({
    queryKey: adminKeys.order(id),
    queryFn: ({ signal }) => api.get<AdminOrderDetailResponse>(`/api/admin/orders/${id}`, signal),
    enabled: id !== null && id > 0,
    retry: false,
  });
}

export function useAdminCustomers(params: AdminCustomerListParams) {
  const search = adminCustomersSearch(params);
  return useQuery<AdminCustomerListResponse>({
    queryKey: adminKeys.customers(search),
    queryFn: ({ signal }) =>
      api.get<AdminCustomerListResponse>(`/api/admin/customers?${search}`, signal),
  });
}

export function useAdminCustomer(id: number | null) {
  return useQuery<AdminCustomerDetailResponse>({
    queryKey: adminKeys.customer(id),
    queryFn: ({ signal }) =>
      api.get<AdminCustomerDetailResponse>(`/api/admin/customers/${id}`, signal),
    enabled: id !== null && id > 0,
    retry: false,
  });
}

/** Admin variant list includes inactive variants (public reads do not). */
export function useAdminVariants(productId: number | null) {
  return useQuery<AdminVariantsResponse>({
    queryKey: adminKeys.variants(productId),
    queryFn: ({ signal }) =>
      api.get<AdminVariantsResponse>(`/api/products/${productId}/variants`, signal),
    enabled: productId !== null && productId > 0,
    retry: false,
  });
}

export function useAdminReviews(params: AdminReviewListParams) {
  const search = adminReviewsSearch(params);
  return useQuery<AdminReviewsResponse>({
    queryKey: adminKeys.reviews(search),
    queryFn: ({ signal }) =>
      api.get<AdminReviewsResponse>(`/api/admin/reviews?${search}`, signal),
  });
}

export type { AdminOrder, AdminOrderSummary };
