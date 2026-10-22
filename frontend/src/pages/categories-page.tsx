import { useMemo } from "react";
import { ArrowRight, FolderOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategories } from "@/features/catalog/queries";
import { usePageTitle } from "@/hooks/use-page-title";
import { buildChildrenMap } from "@/lib/category-tree";
import type { Category, CategoryNode } from "@/types/catalog";

function shopHref(slug: string): string {
  return `/shop?category=${encodeURIComponent(slug)}`;
}

function productCountLabel(node: CategoryNode): string {
  const count = node.totalProductCount ?? node.productCount;
  if (typeof count !== "number") return "View products";
  const suffix = node.children.length > 0 ? " including subcategories" : "";
  return `${count} ${count === 1 ? "product" : "products"}${suffix}`;
}

/** Grandchildren are the deepest level the API allows; render them inline. */
function GrandchildLinks({ nodes }: { nodes: CategoryNode[] }) {
  if (nodes.length === 0) return null;
  return (
    <ul className="ml-3 space-y-1 border-l border-border pl-3">
      {nodes.map((node) => (
        <li key={node.id}>
          <Link
            to={shopHref(node.slug)}
            className="group/sub flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span className="truncate">{node.name}</span>
            <span className="shrink-0 text-xs tabular-nums">{node.productCount ?? 0}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function CategoryCard({ node }: { node: CategoryNode }) {
  const initial = node.name.charAt(0).toUpperCase();

  return (
    <li className="flex h-full flex-col rounded-lg border border-border bg-card p-6 transition-[border-color] duration-200 ease-out-strong hover:border-primary/40">
      <div className="flex items-start justify-between gap-4">
        <span
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary font-display text-lg font-semibold text-primary"
          aria-hidden="true"
        >
          {initial}
        </span>
        <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
      </div>

      <h2 className="mt-4 text-lg font-semibold tracking-tight">
        <Link
          to={shopHref(node.slug)}
          className="transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {node.name}
        </Link>
      </h2>
      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
        {node.description || "Explore products in this category."}
      </p>

      {node.children.length > 0 ? (
        <nav aria-label={`Subcategories of ${node.name}`} className="mt-4 border-t border-border pt-3">
          <p className="px-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Subcategories
          </p>
          <ul className="mt-1.5 space-y-1">
            {node.children.map((child) => (
              <li key={child.id}>
                <Link
                  to={shopHref(child.slug)}
                  className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm text-foreground/90 transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <span className="truncate">{child.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {child.productCount ?? 0}
                  </span>
                </Link>
                <GrandchildLinks nodes={child.children} />
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <p className="mt-auto pt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {productCountLabel(node)}
      </p>
    </li>
  );
}

export default function CategoriesPage() {
  const categories = useCategories();
  usePageTitle("Categories");

  // Prefer the server-built tree; a hierarchy-less response (or an older
  // server) still renders every category as a root.
  const tree = useMemo<CategoryNode[]>(() => {
    const payload = categories.data;
    if (!payload) return [];
    if (payload.tree) return payload.tree;
    const children = buildChildrenMap(payload.categories);
    const toNode = (category: Category): CategoryNode => ({
      ...category,
      children: (children.get(category.id) ?? []).map(toNode),
    });
    return (children.get(null) ?? []).map(toNode);
  }, [categories.data]);

  return (
    <div className="container-page py-8 sm:py-10">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Categories" }]} />

      <header className="mt-6 max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Browse
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Shop by category
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          Every published category with live product counts. Open a subcategory to see only
          the products that belong to it.
        </p>
      </header>

      <div className="mt-8">
        {categories.isLoading ? (
          <div
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            aria-busy="true"
          >
            <span className="sr-only" role="status" aria-label="Loading categories">
              Loading categories
            </span>
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="rounded-lg border border-border bg-card p-6">
                <Skeleton className="size-11 rounded-full" />
                <Skeleton className="mt-4 h-5 w-1/2" />
                <Skeleton className="mt-2 h-3 w-4/5" />
              </div>
            ))}
          </div>
        ) : null}

        {categories.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Categories could not load</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>
                {categories.error instanceof Error
                  ? categories.error.message
                  : "The category list is temporarily unavailable."}
              </span>
              <Button variant="outline" size="sm" onClick={() => void categories.refetch()}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {categories.isSuccess && tree.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title="No categories published yet"
            description="Product listings can still be browsed in the full catalog. Category cards will appear here once the owner sets up category records."
            action={
              <Button asChild>
                <Link to="/shop">Browse all products</Link>
              </Button>
            }
          />
        ) : null}

        {categories.isSuccess && tree.length > 0 ? (
          <ul className="grid grid-cols-1 gap-4 animate-fade-in sm:grid-cols-2 lg:grid-cols-3">
            {tree.map((node) => (
              <CategoryCard key={node.id} node={node} />
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
