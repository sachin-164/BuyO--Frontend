import { useSearchParams } from "react-router-dom";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CatalogView } from "@/components/catalog/catalog-view";
import { useCategories } from "@/features/catalog/queries";
import { parseCatalogQuery } from "@/features/catalog/params";
import { usePageTitle } from "@/hooks/use-page-title";

export default function ShopPage() {
  const [searchParams] = useSearchParams();
  const query = parseCatalogQuery(searchParams);
  const categories = useCategories();
  const selectedCategory = categories.data?.categories.find(
    (category) =>
      category.slug === query.category ||
      category.name === query.category ||
      String(category.id) === query.category,
  );

  // The API also accepts legacy category names that have no Category record.
  // Never claim a category is unavailable just because it is missing from that
  // list; the filtered product response is the source of truth.
  const categoryName = selectedCategory?.name ?? query.category;
  const title = categoryName || "Shop all products";
  usePageTitle(title);

  return (
    <div className="container-page py-8 sm:py-10">
      <Breadcrumbs
        items={
          categoryName
            ? [
                { label: "Home", to: "/" },
                { label: "Shop", to: "/shop" },
                { label: categoryName },
              ]
            : [{ label: "Home", to: "/" }, { label: "Shop" }]
        }
      />

      <header className="mt-6 max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {categoryName ? "Category" : "Catalog"}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          {selectedCategory?.description ||
            "Browse the full catalog, narrow it down with filters, and share the exact view you are looking at."}
        </p>
      </header>

      <CatalogView className="mt-8" />
    </div>
  );
}
