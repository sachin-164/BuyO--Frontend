import { ArrowRight, Clock3, Search, X } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { CatalogView } from "@/components/catalog/catalog-view";
import { SearchCombobox } from "@/components/catalog/search-combobox";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategories } from "@/features/catalog/queries";
import { useRecentSearches } from "@/features/search/recent-searches";
import { usePageTitle } from "@/hooks/use-page-title";

function SearchLanding() {
  const { searches, clear } = useRecentSearches();
  const categories = useCategories();

  return (
    <div className="mt-8 space-y-10">
      <div className="max-w-2xl">
        <SearchCombobox size="large" />
        <p className="mt-2 text-xs text-muted-foreground">
          Suggestions come from the live catalog. Your recent searches stay on this device.
        </p>
      </div>

      {searches.length > 0 ? (
        <section aria-labelledby="recent-searches-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2
              id="recent-searches-heading"
              className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            >
              Recent searches
            </h2>
            <Button variant="ghost" size="sm" onClick={clear}>
              <X aria-hidden="true" />
              Clear
            </Button>
          </div>
          <ul className="mt-3 flex flex-wrap gap-2">
            {searches.map((term) => (
              <li key={term}>
                <Link
                  to={`/search?q=${encodeURIComponent(term)}`}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
                >
                  <Clock3 className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  {term}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="search-categories-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2
            id="search-categories-heading"
            className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Browse by category
          </h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/categories">
              All categories
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>

        {categories.isLoading ? (
          <div className="mt-4 flex flex-wrap gap-2" aria-busy="true">
            <span className="sr-only" role="status" aria-label="Loading categories">
              Loading categories
            </span>
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-32 rounded-full" />
            ))}
          </div>
        ) : categories.isSuccess && categories.data.categories.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {categories.data.categories.map((category) => (
              <Link
                key={category.id}
                to={`/search?q=${encodeURIComponent(category.name)}`}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
              >
                {category.name}
                {typeof category.productCount === "number" ? (
                  <span className="rounded-full bg-secondary px-1.5 text-xs text-muted-foreground">
                    {category.productCount}
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        ) : categories.isSuccess ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No categories have been published yet. Search the catalog above or{" "}
            <Link to="/shop" className="font-medium text-primary underline underline-offset-2">
              browse all products
            </Link>
            .
          </p>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            Categories are unavailable right now. You can still search the catalog above.
          </p>
        )}
      </section>
    </div>
  );
}

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const q = (searchParams.get("q") ?? "").trim();
  usePageTitle(q ? `Search: ${q}` : "Search");

  return (
    <div className="container-page py-8 sm:py-10">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Search" }]} />

      <header className="mt-6 max-w-2xl">
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <Search className="size-3.5" aria-hidden="true" />
          Search
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          {q ? (
            <>
              Results for <span className="text-primary">“{q}”</span>
            </>
          ) : (
            "Find what you need"
          )}
        </h1>
        {!q ? (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
            Search by product name or category. Filters and sorting are kept in the URL so
            you can share a result page or return to it later.
          </p>
        ) : null}
      </header>

      {q ? <CatalogView className="mt-8" /> : <SearchLanding />}
    </div>
  );
}
