import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  WishlistCheckResponse,
  WishlistResponse,
} from "@/types/commerce";

export const wishlistKeys = {
  all: ["wishlist"] as const,
  membership: (productId: number) =>
    [...wishlistKeys.all, "membership", productId] as const,
};

export function useWishlist({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<WishlistResponse>({
    queryKey: wishlistKeys.all,
    queryFn: ({ signal }) => api.get<WishlistResponse>("/api/wishlist", signal),
    enabled,
    retry: false,
    staleTime: 15_000,
  });
}

export function useWishlistMembership(productId: number, enabled: boolean) {
  return useQuery<WishlistCheckResponse>({
    queryKey: wishlistKeys.membership(productId),
    queryFn: ({ signal }) =>
      api.get<WishlistCheckResponse>(`/api/wishlist/products/${productId}`, signal),
    enabled,
    retry: false,
  });
}
