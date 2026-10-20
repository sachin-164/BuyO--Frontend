import type { ProductQuery, ProductSort } from "@/types/catalog";

export const PAGE_SIZE = 12;

export const SORT_OPTIONS: ReadonlyArray<{ value: ProductSort; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "name_asc", label: "Name: A–Z" },
  { value: "name_desc", label: "Name: Z–A" },
  { value: "oldest", label: "Oldest first" },
];

export interface CatalogQuery {
  q: string;
  category: string;
  sort: ProductSort;
  page: number;
  minPrice: number | null;
  maxPrice: number | null;
  inStock: boolean;
}

export const DEFAULT_CATALOG_QUERY: CatalogQuery = {
  q: "",
  category: "",
  sort: "newest",
  page: 1,
  minPrice: null,
  maxPrice: null,
  inStock: false,
};

function parsePrice(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100_000_000) return null;
  return value;
}

export function parseCatalogQuery(params: URLSearchParams): CatalogQuery {
  const sortParam = params.get("sort");
  const sort = SORT_OPTIONS.some((option) => option.value === sortParam)
    ? (sortParam as ProductSort)
    : DEFAULT_CATALOG_QUERY.sort;

  const rawPage = params.get("page");
  const parsedPage = rawPage === null ? 1 : Number(rawPage);
  const page =
    Number.isInteger(parsedPage) && parsedPage > 0 && parsedPage <= 100_000_000
      ? parsedPage
      : 1;

  const inStockParam = params.get("inStock");

  return {
    q: (params.get("q") ?? "").trim().slice(0, 100),
    category: (params.get("category") ?? "").trim().slice(0, 160),
    sort,
    page,
    minPrice: parsePrice(params.get("minPrice")),
    maxPrice: parsePrice(params.get("maxPrice")),
    inStock: inStockParam === "1" || inStockParam === "true",
  };
}

export function buildCatalogSearch(query: CatalogQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.category) params.set("category", query.category);
  if (query.sort !== DEFAULT_CATALOG_QUERY.sort) params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.minPrice !== null) params.set("minPrice", String(query.minPrice));
  if (query.maxPrice !== null) params.set("maxPrice", String(query.maxPrice));
  if (query.inStock) params.set("inStock", "1");
  return params;
}

export function buildCatalogHref(pathname: string, query: CatalogQuery): string {
  const search = buildCatalogSearch(query).toString();
  return search ? `${pathname}?${search}` : pathname;
}

export function hasActiveFilters(query: CatalogQuery): boolean {
  return Boolean(
    query.q ||
      query.category ||
      query.minPrice !== null ||
      query.maxPrice !== null ||
      query.inStock,
  );
}

export function hasPriceRangeError(query: CatalogQuery): boolean {
  return (
    query.minPrice !== null &&
    query.maxPrice !== null &&
    query.minPrice > query.maxPrice
  );
}

export function toApiProductQuery(query: CatalogQuery, limit = PAGE_SIZE): ProductQuery {
  return {
    q: query.q || undefined,
    category: query.category || undefined,
    minPrice: query.minPrice ?? undefined,
    maxPrice: query.maxPrice ?? undefined,
    inStock: query.inStock || undefined,
    sort: query.sort,
    page: query.page,
    limit,
  };
}
