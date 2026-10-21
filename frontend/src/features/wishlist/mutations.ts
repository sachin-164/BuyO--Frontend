import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  CartResponse,
  WishlistCheckResponse,
  WishlistRemoveResponse,
  WishlistToggleResponse,
} from "@/types/commerce";
import { cartKeys } from "@/features/cart/queries";
import { wishlistKeys } from "@/features/wishlist/queries";

export function useToggleWishlist(productId: number) {
  const queryClient = useQueryClient();
  const membershipKey = wishlistKeys.membership(productId);

  return useMutation({
    mutationFn: () =>
      api.post<WishlistToggleResponse>("/api/wishlist/toggle", { productId }),
    onSuccess: (data) => {
      queryClient.setQueryData<WishlistCheckResponse>(membershipKey, {
        success: true,
        productId,
        inWishlist: data.inWishlist,
      });
      void queryClient.invalidateQueries({ queryKey: wishlistKeys.all });
    },
  });
}

export function useRemoveWishlistItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (productId: number) =>
      api.delete<WishlistRemoveResponse>(`/api/wishlist/${productId}`),
    onSuccess: (_data, productId) => {
      queryClient.setQueryData<WishlistCheckResponse>(
        wishlistKeys.membership(productId),
        {
          success: true,
          productId,
          inWishlist: false,
        },
      );
      void queryClient.invalidateQueries({ queryKey: wishlistKeys.all });
    },
  });
}

export function useAddToCartFromWishlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { productId: number; qty?: number }) =>
      api.post<CartResponse>("/api/cart", { productId: input.productId, qty: input.qty ?? 1 }),
    onSuccess: (data) => queryClient.setQueryData(cartKeys.all, data),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: cartKeys.all }),
  });
}
