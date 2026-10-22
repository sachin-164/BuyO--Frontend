import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  CategoryListResponse,
  ProductDetailResponse,
  ProductListResponse,
  ProductQuery,
  RelatedProductsResponse,
  SearchSuggestionsResponse,
} from "@/types/catalog";

export const catalogKeys = {
  all: ["catalog"] as const,
  categories: () => [...catalogKeys.all, "categories"] as const,
  products: (search: string) => [...catalogKeys.all, "products", search] as const,
  product: (identifier: string) => [...catalogKeys.all, "product", identifier] as const,
  suggestions: (term: string) => [...catalogKeys.all, "suggestions", term] as const,
  related: (identifier: string, limit: number) =>
    [...catalogKeys.all, "related", identifier, limit] as const,
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

/**
 * Typeahead suggestions. The term is part of the query key, so a slower
 * response for an older term can never overwrite a newer one.
 */
export function useSearchSuggestions(term: string, { enabled = true }: { enabled?: boolean } = {}) {
  const query = term.trim();
  return useQuery({
    queryKey: catalogKeys.suggestions(query),
    queryFn: ({ signal }) =>
      api.get<SearchSuggestionsResponse>(
        `/api/products/suggestions?q=${encodeURIComponent(query)}`,
        signal,
      ),
    enabled: enabled && query.length >= 2,
    staleTime: 30_000,
    retry: false,
  });
}

/** Same-category siblings, excluding the product itself (server-side rule). */
export function useRelatedProducts(identifier: number | string | undefined, limit = 4) {
  return useQuery({
    queryKey: catalogKeys.related(String(identifier ?? ""), limit),
    queryFn: ({ signal }) =>
      api.get<RelatedProductsResponse>(
        `/api/products/${encodeURIComponent(String(identifier ?? ""))}/related?limit=${limit}`,
        signal,
      ),
    enabled: Boolean(identifier),
    retry: false,
    staleTime: 60_000,
  });
}
