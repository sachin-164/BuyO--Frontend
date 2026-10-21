import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CreateOrderResponse } from "@/types/commerce";
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
