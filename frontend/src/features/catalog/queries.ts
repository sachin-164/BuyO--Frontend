import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  CategoryListResponse,
  ProductDetailResponse,
  ProductListResponse,
  ProductQuery,
} from "@/types/catalog";

export const catalogKeys = {
  all: ["catalog"] as const,
  categories: () => [...catalogKeys.all, "categories"] as const,
  products: (search: string) => [...catalogKeys.all, "products", search] as const,
  product: (identifier: string) => [...catalogKeys.all, "product", identifier] as const,
};

function productSearch(params: ProductQuery): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.category) search.set("category", params.category);
  if (params.minPrice !== undefined) search.set("minPrice", String(params.minPrice));
  if (params.maxPrice !== undefined) search.set("maxPrice", String(params.maxPrice));
  if (params.inStock !== undefined) search.set("inStock", String(params.inStock));
  if (params.sort) search.set("sort", params.sort);
  if (params.page !== undefined) search.set("page", String(params.page));
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  return search.toString();
}

export function useProducts(
  params: ProductQuery = {},
  options: { enabled?: boolean } = {},
) {
  const search = productSearch(params);
  return useQuery({
    queryKey: catalogKeys.products(search),
    queryFn: ({ signal }) =>
      api.get<ProductListResponse>(
        search ? `/api/products?${search}` : "/api/products",
        signal,
      ),
    enabled: options.enabled ?? true,
  });
}

export function useProduct(identifier: string | undefined) {
  return useQuery({
    queryKey: catalogKeys.product(identifier ?? ""),
    queryFn: ({ signal }) =>
      api.get<ProductDetailResponse>(
        `/api/products/${encodeURIComponent(identifier ?? "")}`,
        signal,
      ),
    enabled: Boolean(identifier),
    // Missing products should surface immediately, not after retries.
    retry: false,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: catalogKeys.categories(),
    queryFn: ({ signal }) => api.get<CategoryListResponse>("/api/categories", signal),
  });
}

export function useLatestProducts(limit = 8) {
  return useProducts({ limit, sort: "newest", page: 1 });
}
