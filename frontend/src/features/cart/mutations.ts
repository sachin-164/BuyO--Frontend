import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cartKeys } from "@/features/cart/queries";
import {
  addGuestLine,
  buildGuestCart,
  removeGuestLine,
  setGuestQty,
} from "@/features/cart/guest-cart";
import { useAuth } from "@/features/auth/auth-context";
import type { Product, ProductVariant } from "@/types/catalog";
import type { CartItem, CartResponse } from "@/types/commerce";

/**
 * Cart responses always carry the authoritative totals, so every mutation
 * response can be adopted immediately. Quantity changes additionally update
 * the line in flight before the response arrives; totals stay until the
 * server reconciles because tax grouping is server-authoritative.
 *
 * When there is no token the same hooks operate on the localStorage guest
 * cart, so callers never need a guest-specific code path.
 */
export function useAddToCart() {
  const queryClient = useQueryClient();
  const { hasToken } = useAuth();
  return useMutation<
    CartResponse,
    unknown,
    {
      productId: number;
      qty: number;
      product?: Product;
      variant?: ProductVariant | null;
    }
  >({
    mutationFn: async (input) => {
      if (hasToken) {
        return api.post<CartResponse>("/api/cart", {
          productId: input.productId,
          ...(input.variant ? { variantId: input.variant.id } : {}),
          qty: input.qty,
        });
      }
      if (!input.product) {
        throw new Error("Product details are required to save a guest cart item.");
      }
      addGuestLine(input.product, input.qty, input.variant ?? null);
      return buildGuestCart();
    },
    onSuccess: (data) => queryClient.setQueryData(cartKeys.all, data),
    onSettled: () => {
      if (hasToken) void queryClient.invalidateQueries({ queryKey: cartKeys.all });
    },
  });
}

export function useUpdateCartItem() {
  const queryClient = useQueryClient();
  const { hasToken } = useAuth();

  return useMutation<
    CartResponse,
    unknown,
    { id: number; qty: number; productId?: number | null; variantId?: number | null },
    { previous?: CartResponse } | undefined
  >({
    mutationFn: async (input) => {
      if (hasToken) {
        return api.put<CartResponse>(`/api/cart/${input.id}`, { qty: input.qty });
      }
      if (!input.productId) throw new Error("Cart item not found");
      setGuestQty(input.productId, input.qty, input.variantId ?? null);
      return buildGuestCart();
    },
    onMutate: async (input): Promise<{ previous?: CartResponse } | undefined> => {
      if (!hasToken) return undefined;
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
    onSettled: () => {
      if (hasToken) void queryClient.invalidateQueries({ queryKey: cartKeys.all });
    },
  });
}

export function useRemoveCartItem() {
  const queryClient = useQueryClient();
  const { hasToken } = useAuth();

  return useMutation<
    CartResponse,
    unknown,
    { id: number; productId?: number | null; variantId?: number | null }
  >({
    mutationFn: async (input) => {
      if (hasToken) return api.delete<CartResponse>(`/api/cart/${input.id}`);
      if (!input.productId) throw new Error("Cart item not found");
      removeGuestLine(input.productId, input.variantId ?? null);
      return buildGuestCart();
    },
    onSuccess: (data) => queryClient.setQueryData(cartKeys.all, data),
    onSettled: () => {
      if (hasToken) void queryClient.invalidateQueries({ queryKey: cartKeys.all });
    },
  });
}
