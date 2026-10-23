import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { adminKeys } from "@/features/admin/keys";
import { catalogKeys } from "@/features/catalog/queries";
import { orderKeys } from "@/features/orders/queries";
import type {
  AdminCategoryInput,
  AdminOrderDetailResponse,
  AdminOrderStatusResponse,
  AdminProductInput,
  AdminVariantInput,
  AdminVariantResponse,
  CategoryDeleteResponse,
  CategoryMutationResponse,
  ProductDeleteResponse,
  ProductMutationResponse,
} from "@/types/admin";
import type { OrderStatus } from "@/types/commerce";
import type { ModerationResponse, ReviewStatus } from "@/types/reviews";

function useInvalidateAdminCatalog() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
    void queryClient.invalidateQueries({ queryKey: adminKeys.dashboard() });
  };
}

export function useCreateProduct() {
  const invalidate = useInvalidateAdminCatalog();
  return useMutation<ProductMutationResponse, unknown, AdminProductInput | FormData>({
    mutationFn: (body) => api.post<ProductMutationResponse>("/api/products", body),
    onSuccess: invalidate,
  });
}

export function useUpdateProduct(id: number) {
  const invalidate = useInvalidateAdminCatalog();
  return useMutation<ProductMutationResponse, unknown, Partial<AdminProductInput> | FormData>({
    mutationFn: (body) => api.put<ProductMutationResponse>(`/api/products/${id}`, body),
    onSuccess: invalidate,
  });
}

export function useDeleteProduct() {
  const invalidate = useInvalidateAdminCatalog();
  return useMutation<ProductDeleteResponse, unknown, number>({
    mutationFn: (id) => api.delete<ProductDeleteResponse>(`/api/products/${id}`),
    onSuccess: invalidate,
  });
}

export interface AppendProductImageInput {
  url?: string;
  alt?: string;
}

/** Append one gallery image: a JSON URL, or one local multipart file. */
export function useAppendProductImage(id: number) {
  const invalidate = useInvalidateAdminCatalog();
  return useMutation<ProductMutationResponse, unknown, AppendProductImageInput | FormData>({
    mutationFn: (body) => api.post<ProductMutationResponse>(`/api/products/${id}/images`, body),
    onSuccess: invalidate,
  });
}

/** Replace the ordered gallery (reorder, alt edits, removals) in one request. */
export function useReplaceProductImages(id: number) {
  const invalidate = useInvalidateAdminCatalog();
  return useMutation<
    ProductMutationResponse,
    unknown,
    Array<{ url: string; alt?: string | null }>
  >({
    mutationFn: (images) => api.put<ProductMutationResponse>(`/api/products/${id}/images`, { images }),
    onSuccess: invalidate,
  });
}

export function useDeleteProductImage(id: number) {
  const invalidate = useInvalidateAdminCatalog();
  return useMutation<ProductMutationResponse, unknown, number>({
    mutationFn: (imageId) => api.delete<ProductMutationResponse>(`/api/products/${id}/images/${imageId}`),
    onSuccess: invalidate,
  });
}

function useInvalidateVariants(productId: number) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.variants(productId) });
    void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
    void queryClient.invalidateQueries({ queryKey: adminKeys.dashboard() });
  };
}

export function useCreateVariant(productId: number) {
  const invalidate = useInvalidateVariants(productId);
  return useMutation<AdminVariantResponse, unknown, AdminVariantInput>({
    mutationFn: (body) =>
      api.post<AdminVariantResponse>(`/api/products/${productId}/variants`, body),
    onSuccess: invalidate,
  });
}

export function useUpdateVariant(productId: number) {
  const invalidate = useInvalidateVariants(productId);
  return useMutation<
    AdminVariantResponse,
    unknown,
    { variantId: number; body: Partial<AdminVariantInput> }
  >({
    mutationFn: ({ variantId, body }) =>
      api.put<AdminVariantResponse>(`/api/products/${productId}/variants/${variantId}`, body),
    onSuccess: invalidate,
  });
}

/** DELETE is a soft deactivation; order history keeps its snapshots. */
export function useDeactivateVariant(productId: number) {
  const invalidate = useInvalidateVariants(productId);
  return useMutation<AdminVariantResponse, unknown, number>({
    mutationFn: (variantId) =>
      api.delete<AdminVariantResponse>(`/api/products/${productId}/variants/${variantId}`),
    onSuccess: invalidate,
  });
}

export function useModerateReview() {
  const queryClient = useQueryClient();
  return useMutation<
    ModerationResponse,
    unknown,
    { id: number; status: Exclude<ReviewStatus, "pending"> }
  >({
    mutationFn: ({ id, status }) =>
      api.patch<ModerationResponse>(`/api/admin/reviews/${id}`, { status }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.reviewsRoot() });
      void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
      void queryClient.invalidateQueries({ queryKey: adminKeys.dashboard() });
    },
  });
}

export function useCreateCategory() {
  const invalidate = useInvalidateAdminCatalog();
  return useMutation<CategoryMutationResponse, unknown, AdminCategoryInput>({
    mutationFn: (body) => api.post<CategoryMutationResponse>("/api/categories", body),
    onSuccess: invalidate,
  });
}

export function useUpdateCategory(id: number) {
  const invalidate = useInvalidateAdminCatalog();
  return useMutation<CategoryMutationResponse, unknown, Partial<AdminCategoryInput>>({
    mutationFn: (body) => api.put<CategoryMutationResponse>(`/api/categories/${id}`, body),
    onSuccess: invalidate,
  });
}

export function useDeleteCategory() {
  const invalidate = useInvalidateAdminCatalog();
  return useMutation<CategoryDeleteResponse, unknown, number>({
    mutationFn: (id) => api.delete<CategoryDeleteResponse>(`/api/categories/${id}`),
    onSuccess: invalidate,
  });
}

export interface UpdateOrderStatusInput {
  status: OrderStatus;
  note?: string;
}

export function useUpdateAdminOrderStatus(orderId: number | null) {
  const queryClient = useQueryClient();
  return useMutation<AdminOrderStatusResponse, unknown, UpdateOrderStatusInput>({
    mutationFn: (body) =>
      api.put<AdminOrderStatusResponse>(`/api/admin/orders/${orderId}/status`, body),
    onSuccess: (data) => {
      if (orderId !== null) {
        queryClient.setQueryData<AdminOrderDetailResponse>(adminKeys.order(orderId), {
          success: true,
          order: data.order,
        });
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.ordersRoot() });
      void queryClient.invalidateQueries({ queryKey: adminKeys.dashboard() });
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}

export { useInvalidateAdminCatalog };
