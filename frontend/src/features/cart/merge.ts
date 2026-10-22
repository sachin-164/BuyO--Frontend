import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cartKeys } from "@/features/cart/keys";
import { clearGuestCart, readGuestCart } from "@/features/cart/guest-cart";
import type { CartResponse } from "@/types/commerce";

export interface MergeReport {
  merged: Array<{ productId: number; qty: number; added: number }>;
  skipped: Array<{ productId: number; reason: "not_found" | "out_of_stock" }>;
  clamped: Array<{ productId: number; available: number; requested: number }>;
}

export type MergeCartResponse = CartResponse & MergeReport;

/**
 * Replays the browser's guest cart onto the signed-in account.
 *
 * The local copy is cleared ONLY after the server confirmed the merge, so a
 * network failure leaves the shopper's items intact for the next attempt. An
 * empty guest cart is a no-op (no request at all).
 */
export async function mergeGuestCart(queryClient: QueryClient): Promise<boolean> {
  const lines = readGuestCart();
  if (!lines.length) return false;

  try {
    const response = await api.post<MergeCartResponse>("/api/cart/merge", {
      items: lines.map((line) => ({ productId: line.productId, qty: line.qty })),
    });
    clearGuestCart();
    queryClient.setQueryData(cartKeys.all, response);
    return true;
  } catch {
    // Keep the guest cart. A later sign-in or app load retries.
    return false;
  }
}
