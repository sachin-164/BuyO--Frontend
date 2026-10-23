import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { reviewKeys } from "@/features/reviews/queries";
import type {
  CreatedReviewResponse,
  CreateReviewInput,
  ProductReviewsResponse,
} from "@/types/reviews";

export function useCreateReview(identifier: string | undefined, productId: number | null) {
  const queryClient = useQueryClient();
  return useMutation<CreatedReviewResponse, unknown, CreateReviewInput>({
    mutationFn: (body) =>
      api.post<CreatedReviewResponse>(
        `/api/products/${encodeURIComponent(identifier ?? "")}/reviews`,
        body,
      ),
    onSuccess: () => {
      if (productId) {
        void queryClient.invalidateQueries({ queryKey: reviewKeys.mine(productId) });
      }
      // Pending reviews are never public, but another approved review could
      // change the visible aggregate after moderation; refetch is cheap.
      void queryClient.invalidateQueries({
        queryKey: [...reviewKeys.all, "product", identifier ?? ""],
      });
    },
  });
}

export type { ProductReviewsResponse };
