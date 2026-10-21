import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminQueryError } from "@/components/admin/admin-query-error";
import { AdminTableSkeleton } from "@/components/admin/admin-table-skeleton";
import { ProductThumb } from "@/components/admin/product-thumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useCategories, useProducts } from "@/features/catalog/queries";
import { useDeleteProduct } from "@/features/admin/mutations";
import { getErrorMessage } from "@/lib/errors";
import { discountPercent, formatPrice } from "@/lib/format";
import { usePageTitle } from "@/hooks/use-page-title";
import type { Product, ProductSort } from "@/types/catalog";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

const SORT_VALUES: ProductSort[] = [
  "newest",
  "oldest",
  "price_asc",
  "price_desc",
  "name_asc",
  "name_desc",
];

const SORT_LABELS: Record<ProductSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
  name_asc: "Name: A to Z",
  name_desc: "Name: Z to A",
};

function parsePage(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parsePrice(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseSort(value: string | null): ProductSort {
  return SORT_VALUES.includes(value as ProductSort) ? (value as ProductSort) : "newest";
}

function stockState(stock: number): { label: string; variant: "success" | "outline" | "destructive" } {
  if (stock <= 0) return { label: "Out of stock", variant: "destructive" };
  if (stock <= 5) return { label: "Low stock", variant: "outline" };
  return { label: "Active", variant: "success" };
}

function SortHeader({
  label,
  field,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  field: "name" | "price";
  sort: ProductSort;
  onSort: (sort: ProductSort) => void;
  align?: "left" | "right";
}) {
  const ascending = field === "name" ? "name_asc" : "price_asc";
  const descending = field === "name" ? "name_desc" : "price_desc";
  const active = sort === ascending || sort === descending;
  const ariaSort = sort === ascending ? "ascending" : sort === descending ? "descending" : "none";
  const next = sort === ascending ? descending : ascending;
  const Icon = !active ? ArrowUpDown : sort === ascending ? ArrowUp : ArrowDown;

  return (
    <th scope="col" aria-sort={ariaSort} className={cn("pb-2 pr-3 font-medium", align === "right" && "text-right")}>
      <button
        type="button"
        onClick={() => onSort(next)}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm font-medium uppercase tracking-wide transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          align === "right" && "flex-row-reverse",
        )}
      >
        {label}
        <Icon className="size-3.5" aria-hidden="true" />
      </button>
    </th>
  );
}

export default function AdminProductsPage() {
  usePageTitle("Products");
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const deleteMutation = useDeleteProduct();
  const [deleting, setDeleting] = useState<Product | null>(null);

  const page = parsePage(searchParams.get("page"));
  const q = searchParams.get("q")?.trim() ?? "";
  const category = searchParams.get("category") ?? "";
  const stock = searchParams.get("stock") ?? "";
  const minPrice = parsePrice(searchParams.get("min"));
  const maxPrice = parsePrice(searchParams.get("max"));
  const sort = parseSort(searchParams.get("sort"));

  const inStock = stock === "in" ? true : stock === "out" ? false : undefined;
  const productsQuery = useProducts({
    q: q || undefined,
    category: category || undefined,
    minPrice,
    maxPrice,
    inStock,
    sort,
    page,
    limit: PAGE_SIZE,
  });
  const categoriesQuery = useCategories();

  const hasFilters = Boolean(q || category || stock || minPrice !== undefined || maxPrice !== undefined);
  const filterKey = useMemo(
    () => [q, category, stock, minPrice ?? "", maxPrice ?? "", sort].join("|"),
    [q, category, stock, minPrice, maxPrice, sort],
  );

  function commitFilters(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams);
    next.delete("page");
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next);
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? "").trim();
    const nextMin = value("min");
    const nextMax = value("max");
    commitFilters({
      q: value("q") || undefined,
      category: value("category") || undefined,
      stock: value("stock") || undefined,
      min: nextMin || undefined,
      max: nextMax || undefined,
      sort: value("sort") === "newest" ? undefined : value("sort"),
    });
  }

  function changeSort(nextSort: ProductSort) {
    commitFilters({ sort: nextSort === "newest" ? undefined : nextSort });
  }

  function hrefFor(nextPage: number) {
    const next = new URLSearchParams(searchParams);
    if (nextPage <= 1) next.delete("page");
    else next.set("page", String(nextPage));
    const search = next.toString();
    return search ? `/admin/products?${search}` : "/admin/products";
  }

  function confirmDelete() {
    if (!deleting) return;
    deleteMutation.mutate(deleting.id, {
      onSuccess: (data) => {
        toast({ title: data.message || "Product deleted", tone: "success" });
        setDeleting(null);
      },
      onError: (error) => {
        toast({ title: "Couldn't delete product", description: getErrorMessage(error), tone: "error" });
        setDeleting(null);
      },
    });
  }

  const data = productsQuery.data;
  const products = data?.products ?? [];
  const pagination = data?.pagination;

  return (
    <>
      <AdminPageHeader
        title="Products"
        description="Search, filter and edit the live catalog. Prices, stock and slugs are validated by the server."
        breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Products" }]}
        actions={
          <Button asChild>
            <Link to="/admin/products/new">
              <Plus aria-hidden="true" />
              Add product
            </Link>
          </Button>
        }
      />

      <Card className="mb-6 p-4">
        <form key={filterKey} onSubmit={applyFilters} className="space-y-4" aria-label="Product filters">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <Field id="product-search" label="Search" className="xl:col-span-2">
              <Input
                id="product-search"
                name="q"
                type="search"
                defaultValue={q}
                placeholder="Name or description"
                autoComplete="off"
              />
            </Field>

            <Field id="product-category" label="Category">
              <Select id="product-category" name="category" defaultValue={category}>
                <option value="">All categories</option>
                {(categoriesQuery.data?.categories ?? []).map((item) => (
                  <option key={item.id} value={item.slug}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field id="product-stock" label="Stock">
              <Select id="product-stock" name="stock" defaultValue={stock}>
                <option value="">Any stock</option>
                <option value="in">In stock</option>
                <option value="out">Out of stock</option>
              </Select>
            </Field>

            <Field id="product-min" label="Min price (₹)">
              <Input
                id="product-min"
                name="min"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                defaultValue={minPrice ?? ""}
                placeholder="0"
              />
            </Field>

            <Field id="product-max" label="Max price (₹)">
              <Input
                id="product-max"
                name="max"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                defaultValue={maxPrice ?? ""}
                placeholder="Any"
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Field id="product-sort" label="Sort" className="w-full sm:w-56">
              <Select id="product-sort" name="sort" defaultValue={sort}>
                {SORT_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {SORT_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex flex-wrap gap-2 pb-0.5">
              <Button type="submit">
                <Search aria-hidden="true" />
                Apply filters
              </Button>
              {hasFilters ? (
                <Button asChild type="button" variant="ghost">
                  <Link to="/admin/products">
                    <X aria-hidden="true" />
                    Clear
                  </Link>
                </Button>
              ) : null}
            </div>
            {categoriesQuery.isError ? (
              <p className="pb-1 text-xs text-muted-foreground">
                Categories could not be loaded; the category filter is limited.
              </p>
            ) : null}
          </div>
        </form>
      </Card>

      {productsQuery.isPending ? (
        <AdminTableSkeleton rows={6} columns={6} />
      ) : productsQuery.isError ? (
        <AdminQueryError
          error={productsQuery.error}
          title="Couldn't load products"
          onRetry={() => void productsQuery.refetch()}
        />
      ) : products.length === 0 ? (
        <EmptyState
          icon={Package}
          title={hasFilters ? "No products match these filters" : "No products yet"}
          description={
            hasFilters
              ? "Try a different search, category or price range."
              : "Add the first product to make it available in the storefront."
          }
          action={
            hasFilters ? (
              <Button asChild variant="outline">
                <Link to="/admin/products">Clear filters</Link>
              </Button>
            ) : (
              <Button asChild>
                <Link to="/admin/products/new">
                  <Plus aria-hidden="true" />
                  Add product
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <p aria-live="polite">
              {pagination?.total.toLocaleString("en-IN") ?? products.length} product
              {(pagination?.total ?? products.length) === 1 ? "" : "s"}
              {hasFilters ? " matching filters" : ""}
            </p>
            {productsQuery.isFetching ? <p role="status">Refreshing…</p> : null}
          </div>

          <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-sm">
                <caption className="sr-only">Products in the catalog</caption>
                <thead>
                  <tr className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <SortHeader label="Product" field="name" sort={sort} onSort={changeSort} />
                    <th scope="col" className="px-3 py-3 font-medium">Category</th>
                    <SortHeader
                      label="Price"
                      field="price"
                      sort={sort}
                      onSort={changeSort}
                      align="right"
                    />
                    <th scope="col" className="px-3 py-3 font-medium">Stock</th>
                    <th scope="col" className="px-3 py-3 font-medium">Status</th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {products.map((product) => {
                    const state = stockState(product.stock);
                    const discount = discountPercent(product.mrpPrice, product.sellingPrice);
                    return (
                      <tr key={product.id} className="transition-colors hover:bg-secondary/30">
                        <td className="px-3 py-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <ProductThumb src={product.image} name={product.name} />
                            <div className="min-w-0">
                              <p className="max-w-[18rem] truncate font-medium">{product.name}</p>
                              <p className="max-w-[18rem] truncate text-xs text-muted-foreground">
                                /{product.slug}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {product.Category?.name ?? product.category}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          <span className="font-medium">{formatPrice(product.sellingPrice)}</span>
                          {discount !== null ? (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              <span className="line-through">{formatPrice(product.mrpPrice)}</span>{" "}
                              −{discount}%
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 tabular-nums">{product.stock}</td>
                        <td className="px-3 py-3">
                          <Badge variant={state.variant}>{state.label}</Badge>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button asChild variant="ghost" size="sm">
                              <Link to={`/admin/products/${product.id}/edit`}>
                                <Pencil aria-hidden="true" />
                                Edit
                              </Link>
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Delete ${product.name}`}
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => {
                                deleteMutation.reset();
                                setDeleting(product);
                              }}
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <ul className="space-y-3 md:hidden">
            {products.map((product) => {
              const state = stockState(product.stock);
              return (
                <li key={product.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start gap-3">
                    <ProductThumb src={product.image} name={product.name} />
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/admin/products/${product.id}/edit`}
                        className="block truncate font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {product.name}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {product.Category?.name ?? product.category}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium tabular-nums">
                          {formatPrice(product.sellingPrice)}
                        </span>
                        <Badge variant={state.variant}>{state.label}</Badge>
                        <span className="text-xs text-muted-foreground">{product.stock} in stock</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-end gap-1 border-t border-border pt-2">
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/admin/products/${product.id}/edit`}>
                        <Pencil aria-hidden="true" />
                        Edit
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => {
                        deleteMutation.reset();
                        setDeleting(product);
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                      Delete
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>

          {pagination ? (
            <Pagination page={pagination.page} totalPages={pagination.totalPages} hrefFor={hrefFor} />
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) setDeleting(null);
        }}
        title="Delete product?"
        description={
          deleting
            ? `“${deleting.name}” will be permanently removed from the catalog. Existing orders keep their own item snapshots.`
            : ""
        }
        confirmLabel="Delete product"
        tone="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={confirmDelete}
      />
    </>
  );
}
