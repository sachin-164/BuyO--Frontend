import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CartItem, CartResponse } from "@/types/commerce";
import { cartKeys } from "@/features/cart/queries";

/**
 * Cart responses always carry the authoritative totals, so every mutation
 * response can be adopted immediately. Quantity changes additionally update
 * the line in flight before the response arrives; totals stay until the
 * server reconciles because tax grouping is server-authoritative.
 */
export function useAddToCart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { productId: number; qty: number }) =>
      api.post<CartResponse>("/api/cart", input),
    onSuccess: (data) => queryClient.setQueryData(cartKeys.all, data),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: cartKeys.all }),
  });
}

export function useUpdateCartItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: number; qty: number }) =>
      api.put<CartResponse>(`/api/cart/${input.id}`, { qty: input.qty }),
    onMutate: async (input: { id: number; qty: number }) => {
      await queryClient.cancelQueries({ queryKey: cartKeys.all });
      const previous = queryClient.getQueryData<CartResponse>(cartKeys.all);

      queryClient.setQueryData<CartResponse>(cartKeys.all, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((item: CartItem): CartItem =>
                item.id === input.id
                  ? {
                      ...item,
                      qty: input.qty,
                      lineTotal:
                        item.price === null
                          ? item.lineTotal
                          : Math.round(item.price * input.qty * 100) / 100,
                    }
                  : item,
              ),
            }
          : old,
      );

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(cartKeys.all, context.previous);
      }
    },
    onSuccess: (data) => queryClient.setQueryData(cartKeys.all, data),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: cartKeys.all }),
  });
}

export function useRemoveCartItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<CartResponse>(`/api/cart/${id}`),
    onSuccess: (data) => queryClient.setQueryData(cartKeys.all, data),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: cartKeys.all }),
  });
}
