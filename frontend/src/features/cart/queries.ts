import { useMemo, useSyncExternalStore } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/features/auth/auth-context";
import { cartKeys } from "@/features/cart/keys";
import {
  buildGuestCart,
  readGuestCart,
  subscribeGuestCart,
  type GuestCartLine,
} from "@/features/cart/guest-cart";
import type { CartResponse } from "@/types/commerce";

export { cartKeys };

const EMPTY_LINES: GuestCartLine[] = [];

/** Reactive view of the localStorage guest cart (same tab writes + cross-tab). */
export function useGuestCart(): CartResponse {
  const lines = useSyncExternalStore(subscribeGuestCart, readGuestCart, () => EMPTY_LINES);
  return useMemo(() => buildGuestCart(lines), [lines]);
}

/**
 * One cart view for both audiences:
 *  - signed in  → the server cart (authoritative)
 *  - anonymous  → the localStorage guest cart, in the same response shape
 *
 * Consumers therefore never branch on authentication for rendering.
 */
export function useCart({ enabled = true }: { enabled?: boolean } = {}) {
  const { hasToken } = useAuth();
  const guestCart = useGuestCart();

  const query = useQuery<CartResponse>({
    queryKey: cartKeys.all,
    queryFn: ({ signal }) => api.get<CartResponse>("/api/cart", signal),
    enabled: enabled && hasToken,
    retry: false,
    staleTime: 15_000,
  });

  if (hasToken) return query;

  // A query object with the same public fields the pages read. `refetch` is a
  // no-op because the guest cart lives in this tab and is already reactive.
  return {
    ...query,
    data: guestCart,
    error: null,
    isError: false,
    isLoading: false,
    isPending: false,
    isSuccess: true,
    status: "success" as const,
    refetch: async () => ({ data: guestCart }),
  } as unknown as UseQueryResult<CartResponse>;
}
