import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CancelOrderResponse, CreateOrderResponse } from "@/types/commerce";
import { cartKeys } from "@/features/cart/queries";
import { orderKeys } from "@/features/orders/queries";

export function useCreateOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { addressId: number; idempotencyKey: string; notes?: string }) =>
      api.post<CreateOrderResponse>("/api/orders", input),
    onSuccess: (data) => {
      // The full order graph is trusted and reusable by the confirmation page.
      queryClient.setQueryData(orderKeys.detail(data.order.id), {
        success: true,
        order: data.order,
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: cartKeys.all });
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}

/**
 * Cancels an owned order.
 *
 * The server is the only authority on eligibility (it re-derives it from the
 * order's real status under a row lock and can return 409 if the order moved on
 * between render and click). The client never pre-emptively "fixes" that race:
 * it surfaces the conflict and refetches, so the UI converges on the truth.
 *
 * On success the returned order graph replaces the cached detail immediately,
 * so the cancelled status and the new history event appear without a refetch.
 */
export function useCancelOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (orderId: number) =>
      api.post<CancelOrderResponse>(`/api/orders/${orderId}/cancel`),
    onSuccess: (data) => {
      queryClient.setQueryData(orderKeys.detail(data.order.id), {
        success: true,
        order: data.order,
      });
    },
    onSettled: () => {
      // The list shows status + canCancel, and other orders may share the
      // product rows that were just restocked.
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}
