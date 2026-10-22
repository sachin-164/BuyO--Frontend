import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Search, SlidersHorizontal, X } from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ProductCard } from "@/components/product/product-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategories, useProducts } from "@/features/catalog/queries";
import {
  PAGE_SIZE,
  SORT_OPTIONS,
  buildCatalogHref,
  buildCatalogSearch,
  hasActiveFilters,
  hasPriceRangeError,
  parseCatalogQuery,
  toApiProductQuery,
  type CatalogQuery,
} from "@/features/catalog/params";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { flattenTree } from "@/lib/category-tree";
import { cn } from "@/lib/utils";
import type { ProductSort } from "@/types/catalog";

function CatalogGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: PAGE_SIZE }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-lg border border-border bg-card">
          <Skeleton className="aspect-square rounded-none" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-5 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface CatalogViewProps {
  className?: string;
}

/**
 * URL is the single source of truth for catalog state: refresh, sharing and
 * browser back/forward all restore exactly what the API was asked for.
 */
export function CatalogView({ className }: CatalogViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const searchKey = searchParams.toString();
  const query = useMemo(
    () => parseCatalogQuery(new URLSearchParams(searchKey)),
    [searchKey],
  );
  const queryRef = useRef(query);
  queryRef.current = query;

  const priceError = hasPriceRangeError(query);
  const activeFilters = hasActiveFilters(query);
  const products = useProducts(toApiProductQuery(query), { enabled: !priceError });
  const categories = useCategories();

  const [searchText, setSearchText] = useState(query.q);
  const [minText, setMinText] = useState(query.minPrice?.toString() ?? "");
  const [maxText, setMaxText] = useState(query.maxPrice?.toString() ?? "");
  const [priceInputError, setPriceInputError] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(searchText, 350);

  useEffect(() => {
    setSearchText(query.q);
  }, [query.q]);

  useEffect(() => {
    setMinText(query.minPrice?.toString() ?? "");
    setMaxText(query.maxPrice?.toString() ?? "");
    setPriceInputError(null);
  }, [query.minPrice, query.maxPrice]);

  function update(patch: Partial<CatalogQuery>, replace = false) {
    const current = queryRef.current;
    const next: CatalogQuery = { ...current, ...patch };
    if (patch.page === undefined) next.page = 1;
    setSearchParams(buildCatalogSearch(next), { replace });
  }

  function commitSearch(nextValue: string, replace = true) {
    const nextQuery = nextValue.trim();
    if (nextQuery === queryRef.current.q) return;
    setSearchParams(
      buildCatalogSearch({ ...queryRef.current, q: nextQuery, page: 1 }),
      { replace },
    );
  }

  useEffect(() => {
    commitSearch(debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  function clearFilters() {
    setSearchText("");
    setPriceInputError(null);
    update({
      q: "",
      category: "",
      minPrice: null,
      maxPrice: null,
      inStock: false,
    });
  }

  function applyPriceRange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const min = minText.trim() === "" ? null : Number(minText);
    const max = maxText.trim() === "" ? null : Number(maxText);

    if (
      (min !== null && (!Number.isFinite(min) || min < 0)) ||
      (max !== null && (!Number.isFinite(max) || max < 0))
    ) {
      setPriceInputError("Enter prices as positive numbers.");
      return;
    }
    if (min !== null && max !== null && min > max) {
      setPriceInputError("The minimum price cannot be higher than the maximum.");
      return;
    }

    setPriceInputError(null);
    update({ minPrice: min, maxPrice: max });
  }

  const selectedCategory = categories.data?.categories.find(
    (category) =>
      category.slug === query.category ||
      category.name === query.category ||
      String(category.id) === query.category,
  );
  const categoryLabel = selectedCategory?.name ?? query.category;

  // Parent/child navigation for the current filter. Filtering itself stays
  // exact (the API's contract); these links let a shopper widen or narrow it.
  const allCategories = categories.data?.categories ?? [];
  const childCategories = selectedCategory
    ? allCategories.filter((category) => category.parentId === selectedCategory.id)
    : [];
  const parentCategory =
    selectedCategory?.parentId !== null && selectedCategory?.parentId !== undefined
      ? allCategories.find((category) => category.id === selectedCategory.parentId)
      : undefined;
  const categoryOptions = flattenTree(allCategories);

  const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
  if (query.q) {
    chips.push({
      key: "q",
      label: `Search: “${query.q}”`,
      onRemove: () => {
        setSearchText("");
        update({ q: "" });
      },
    });
  }
  if (query.category) {
    chips.push({
      key: "category",
      label: `Category: ${categoryLabel}`,
      onRemove: () => update({ category: "" }),
    });
  }
  if (query.minPrice !== null || query.maxPrice !== null) {
    const label =
      query.minPrice !== null && query.maxPrice !== null
        ? `Price: ₹${query.minPrice}–₹${query.maxPrice}`
        : query.minPrice !== null
          ? `Price: from ₹${query.minPrice}`
          : `Price: up to ₹${query.maxPrice}`;
    chips.push({
      key: "price",
      label,
      onRemove: () => {
        setPriceInputError(null);
        update({ minPrice: null, maxPrice: null });
      },
    });
  }
  if (query.inStock) {
    chips.push({
      key: "inStock",
      label: "In stock only",
      onRemove: () => update({ inStock: false }),
    });
  }

  const pagination = products.data?.pagination;
  const rangeStart = pagination ? (pagination.page - 1) * pagination.limit + 1 : 0;
  const rangeEnd = pagination
    ? rangeStart + Math.max(products.data?.products.length ?? 0, 1) - 1
    : 0;

  return (
    <div className={cn("space-y-6", className)}>
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_14rem]">
          <div className="relative">
            <label htmlFor="catalog-search" className="sr-only">
              Search products
            </label>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="catalog-search"
              type="search"
              value={searchText}
              placeholder="Search products, categories…"
              autoComplete="off"
              className="pl-9 pr-9"
              onChange={(event) => setSearchText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitSearch(searchText, false);
                }
              }}
            />
            {searchText ? (
              <button
                type="button"
                aria-label="Clear search"
                className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                onClick={() => {
                  setSearchText("");
                  commitSearch("", false);
                }}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="catalog-sort"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Sort by
            </label>
            <Select
              id="catalog-sort"
              value={query.sort}
              onChange={(event) => update({ sort: event.target.value as ProductSort })}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="w-full sm:w-52">
              <label
                htmlFor="catalog-category"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                Category
              </label>
              <Select
                id="catalog-category"
                value={query.category}
                disabled={categories.isLoading}
                onChange={(event) => update({ category: event.target.value })}
              >
                <option value="">All categories</option>
                {selectedCategory && selectedCategory.slug !== query.category ? (
                  <option value={query.category}>{selectedCategory.name}</option>
                ) : null}
                {query.category && !selectedCategory ? (
                  <option value={query.category}>{query.category}</option>
                ) : null}
                {categoryOptions.map((category) => {
                  const depth = category.depth ?? 1;
                  return (
                    <option key={category.id} value={category.slug}>
                      {`${"— ".repeat(Math.max(0, depth - 1))}${category.name}`}
                      {typeof category.productCount === "number"
                        ? ` (${category.productCount})`
                        : ""}
                    </option>
                  );
                })}
              </Select>
              {categories.isError ? (
                <p className="mt-1 text-xs text-muted-foreground" role="status">
                  Categories unavailable — all products are still browsable.
                </p>
              ) : null}
            </div>

            <form
              onSubmit={applyPriceRange}
              className="flex flex-wrap items-end gap-2"
              aria-describedby={
                priceInputError || priceError ? "price-range-error" : undefined
              }
            >
              <div className="w-24">
                <label
                  htmlFor="catalog-min-price"
                  className="mb-1 block text-xs font-medium text-muted-foreground"
                >
                  Min ₹
                </label>
                <Input
                  id="catalog-min-price"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={minText}
                  onChange={(event) => setMinText(event.target.value)}
                  aria-invalid={Boolean(priceInputError || priceError)}
                />
              </div>
              <div className="w-24">
                <label
                  htmlFor="catalog-max-price"
                  className="mb-1 block text-xs font-medium text-muted-foreground"
                >
                  Max ₹
                </label>
                <Input
                  id="catalog-max-price"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={maxText}
                  onChange={(event) => setMaxText(event.target.value)}
                  aria-invalid={Boolean(priceInputError || priceError)}
                />
              </div>
              <Button type="submit" variant="outline" size="sm" className="h-10">
                Apply price
              </Button>
            </form>

            <label className="flex h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={query.inStock}
                onChange={(event) => update({ inStock: event.target.checked })}
                className="size-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              In stock only
            </label>
          </div>

          {activeFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="self-start">
              <X aria-hidden="true" />
              Clear all filters
            </Button>
          ) : null}
        </div>

        {priceInputError || priceError ? (
          <p id="price-range-error" className="mt-3 text-sm text-destructive" role="alert">
            {priceInputError ??
              "This shared price range is invalid. Reset it to see products."}
          </p>
        ) : null}
      </div>

      {selectedCategory && (parentCategory || childCategories.length > 0) ? (
        <nav
          aria-label={`Category navigation for ${selectedCategory.name}`}
          className="flex flex-col gap-3 rounded-lg border border-border bg-secondary/30 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          {parentCategory ? (
            <Link
              to={buildCatalogHref(location.pathname, {
                ...query,
                category: parentCategory.slug,
                page: 1,
              })}
              className="inline-flex items-center gap-1.5 self-start rounded-md text-sm font-medium text-foreground/80 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              {parentCategory.name}
            </Link>
          ) : null}

          {childCategories.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Subcategories
              </span>
              {childCategories.map((child) => (
                <Link
                  key={child.id}
                  to={buildCatalogHref(location.pathname, {
                    ...query,
                    category: child.slug,
                    page: 1,
                  })}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {child.name}
                  <span className="tabular-nums text-muted-foreground">
                    {child.productCount ?? 0}
                  </span>
                </Link>
              ))}
            </div>
          ) : null}
        </nav>
      ) : null}

      {priceError ? (
        <Alert variant="warning">
          <AlertTitle>That price range cannot be shown</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>The minimum price is higher than the maximum price.</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPriceInputError(null);
                update({ minPrice: null, maxPrice: null });
              }}
            >
              Reset price range
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {!priceError && products.isLoading ? (
        <div aria-busy="true">
          <span className="sr-only" role="status" aria-label="Loading products">
            Loading products
          </span>
          <CatalogGridSkeleton />
        </div>
      ) : null}

      {!priceError && products.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Products could not load</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>
              {products.error instanceof Error
                ? products.error.message
                : "The catalog is temporarily unavailable."}
            </span>
            <Button variant="outline" size="sm" onClick={() => void products.refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {!priceError && products.isSuccess ? (
        <div className="space-y-4" aria-busy={products.isFetching || undefined}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {pagination && pagination.total > 0 && products.data.products.length > 0
                ? `Showing ${rangeStart}–${Math.min(rangeEnd, pagination.total)} of ${
                    pagination.total
                  } ${pagination.total === 1 ? "product" : "products"}${
                    query.q ? ` for “${query.q}”` : ""
                  }`
                : pagination && pagination.total > 0
                  ? `No products on page ${pagination.page} of ${pagination.totalPages}`
                  : "No products to show"}
            </p>
            {products.isFetching ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <SlidersHorizontal className="size-3.5" aria-hidden="true" />
                Updating…
              </span>
            ) : null}
          </div>

          {chips.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
              {chips.map((chip) => (
                <span
                  key={chip.key}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-1 pl-3 pr-1 text-xs font-medium"
                >
                  {chip.label}
                  <button
                    type="button"
                    onClick={chip.onRemove}
                    aria-label={`Remove filter: ${chip.label}`}
                    className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {products.data.products.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 animate-fade-in sm:grid-cols-3 lg:grid-cols-4">
              {products.data.products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          ) : query.page > 1 && (pagination?.total ?? 0) > 0 ? (
            <EmptyState
              title="This page is empty"
              description="The catalog has changed since this link was shared. Go back to the first page to keep browsing."
              action={
                <Button asChild>
                  <Link to={buildCatalogHref(location.pathname, { ...query, page: 1 })}>
                    Go to page 1
                  </Link>
                </Button>
              }
            />
          ) : activeFilters ? (
            <EmptyState
              title={query.q ? `No results for “${query.q}”` : "No products match these filters"}
              description={
                query.q
                  ? "Check the spelling, try a broader term, or remove a filter. The catalog shows products as soon as they are published."
                  : "Try widening the price range, choosing another category, or clearing the filters."
              }
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button onClick={clearFilters}>Clear all filters</Button>
                  <Button asChild variant="outline">
                    <Link to="/categories">Browse categories</Link>
                  </Button>
                </div>
              }
            />
          ) : (
            <EmptyState
              title="The catalog is being restocked"
              description="No products are published yet. New arrivals will appear here automatically."
              action={
                <Button asChild variant="outline">
                  <Link to="/categories">Browse categories</Link>
                </Button>
              }
            />
          )}

          {pagination ? (
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              hrefFor={(page) => buildCatalogHref(location.pathname, { ...query, page })}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
