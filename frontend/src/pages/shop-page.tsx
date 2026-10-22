import { useSearchParams } from "react-router-dom";
import { Breadcrumbs, type Crumb } from "@/components/layout/breadcrumbs";
import { CatalogView } from "@/components/catalog/catalog-view";
import { useCategories } from "@/features/catalog/queries";
import { parseCatalogQuery } from "@/features/catalog/params";
import { usePageTitle } from "@/hooks/use-page-title";
import { categoryPath } from "@/lib/category-tree";

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

  // Ancestors are part of the trail, so a deep link shows where it sits.
  const ancestors = query.category
    ? categoryPath(categories.data?.categories ?? [], query.category)
    : [];
  const breadcrumbs: Crumb[] = [{ label: "Home", to: "/" }, { label: "Shop", to: "/shop" }];
  if (categoryName) {
    if (ancestors.length > 0) {
      for (const [index, category] of ancestors.entries()) {
        const isLast = index === ancestors.length - 1;
        breadcrumbs.push({
          label: category.name,
          to: isLast ? undefined : `/shop?category=${encodeURIComponent(category.slug)}`,
        });
      }
    } else {
      breadcrumbs.push({ label: categoryName });
    }
  }

  return (
    <div className="container-page py-8 sm:py-10">
      <Breadcrumbs items={breadcrumbs} />

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
