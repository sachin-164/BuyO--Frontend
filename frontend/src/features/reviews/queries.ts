import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  MyReviewsResponse,
  ProductReviewsResponse,
} from "@/types/reviews";

export const reviewKeys = {
  all: ["reviews"] as const,
  product: (identifier: string, page: number, limit: number) =>
    [...reviewKeys.all, "product", identifier, page, limit] as const,
  mine: (productId: number | null) =>
    [...reviewKeys.all, "mine", productId] as const,
};

/** Public reviews: the server returns approved rows only. */
export function useProductReviews(
  identifier: string | undefined,
  page = 1,
  limit = 10,
) {
  return useQuery<ProductReviewsResponse>({
    queryKey: reviewKeys.product(identifier ?? "", page, limit),
    queryFn: ({ signal }) =>
      api.get<ProductReviewsResponse>(
        `/api/products/${encodeURIComponent(identifier ?? "")}/reviews?page=${page}&limit=${limit}`,
        signal,
      ),
    enabled: Boolean(identifier),
    retry: false,
  });
}

/** The signed-in customer's own review for one product, including status. */
export function useMyProductReview(productId: number | null, enabled = true) {
  return useQuery<MyReviewsResponse>({
    queryKey: reviewKeys.mine(productId),
    queryFn: ({ signal }) =>
      api.get<MyReviewsResponse>(
        `/api/reviews/mine?productId=${productId}`,
        signal,
      ),
    enabled: Boolean(enabled && productId && productId > 0),
    retry: false,
  });
}
