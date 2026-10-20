import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  CartMutationResponse,
  WishlistCheckResponse,
  WishlistToggleResponse,
} from "@/types/catalog";

export const cartKeys = {
  all: ["cart"] as const,
};

export const wishlistKeys = {
  all: ["wishlist"] as const,
  membership: (productId: number) =>
    [...wishlistKeys.all, "membership", productId] as const,
};

export function useWishlistMembership(productId: number, enabled: boolean) {
  return useQuery({
    queryKey: wishlistKeys.membership(productId),
    queryFn: ({ signal }) =>
      api.get<WishlistCheckResponse>(
        `/api/wishlist/products/${productId}`,
        signal,
      ),
    enabled,
    retry: false,
  });
}

export function useAddToCart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { productId: number; qty: number }) =>
      api.post<CartMutationResponse>("/api/cart", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cartKeys.all }),
  });
}

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
