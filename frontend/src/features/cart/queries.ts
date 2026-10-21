import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CartResponse } from "@/types/commerce";

export const cartKeys = {
  all: ["cart"] as const,
  item: (id: number) => [...cartKeys.all, "item", id] as const,
};

export function useCart({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<CartResponse>({
    queryKey: cartKeys.all,
    queryFn: ({ signal }) => api.get<CartResponse>("/api/cart", signal),
    enabled,
    retry: false,
    staleTime: 15_000,
  });
}
