import { ArrowRight, FolderOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategories } from "@/features/catalog/queries";
import { usePageTitle } from "@/hooks/use-page-title";

export default function CategoriesPage() {
  const categories = useCategories();
  usePageTitle("Categories");

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
          Every published category, with live product counts. Pick one to see only the
          products that belong to it.
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

        {categories.isSuccess && categories.data.categories.length === 0 ? (
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

        {categories.isSuccess && categories.data.categories.length > 0 ? (
          <ul className="grid grid-cols-1 gap-4 animate-fade-in sm:grid-cols-2 lg:grid-cols-3">
            {categories.data.categories.map((category) => (
              <li key={category.id}>
                <Link
                  to={`/shop?category=${encodeURIComponent(category.slug)}`}
                  className="group flex h-full flex-col rounded-lg border border-border bg-card p-6 transition-[border-color,transform] duration-200 ease-out-strong hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <div className="flex items-start justify-between gap-4">
                    <span
                      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary font-display text-lg font-semibold text-primary"
                      aria-hidden="true"
                    >
                      {category.name.charAt(0).toUpperCase()}
                    </span>
                    <ArrowRight
                      className="size-4 text-muted-foreground transition-transform duration-200 ease-out-strong group-hover:translate-x-0.5 group-hover:text-primary"
                      aria-hidden="true"
                    />
                  </div>
                  <h2 className="mt-4 text-lg font-semibold tracking-tight transition-colors group-hover:text-primary">
                    {category.name}
                  </h2>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {category.description || "Explore products in this category."}
                  </p>
                  <p className="mt-auto pt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {typeof category.productCount === "number"
                      ? `${category.productCount} ${
                          category.productCount === 1 ? "product" : "products"
                        }`
                      : "View products"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
