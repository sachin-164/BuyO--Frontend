import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CornerDownRight, Pencil, Plus, Search, Tags, Trash2 } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminQueryError } from "@/components/admin/admin-query-error";
import { AdminTableSkeleton } from "@/components/admin/admin-table-skeleton";
import { CategoryFormDialog } from "@/components/admin/category-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useCategories } from "@/features/catalog/queries";
import { useDeleteCategory } from "@/features/admin/mutations";
import { flattenTree } from "@/lib/category-tree";
import { getErrorMessage } from "@/lib/errors";
import { usePageTitle } from "@/hooks/use-page-title";
import type { Category } from "@/types/catalog";

function taxLabel(value: number | undefined): string {
  const rate = Number(value ?? 0);
  return `${Number.isInteger(rate) ? rate : rate.toFixed(2)}%`;
}

function depthOf(category: Category): number {
  return Math.max(1, category.depth ?? 1);
}

export default function AdminCategoriesPage() {
  usePageTitle("Categories");
  const toast = useToast();
  const categoriesQuery = useCategories();
  const deleteMutation = useDeleteCategory();
  const [filter, setFilter] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Category | undefined>(undefined);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const categories = categoriesQuery.data?.categories ?? [];
  const ordered = useMemo(() => flattenTree(categories), [categories]);
  const byId = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return ordered;
    return ordered.filter((category) =>
      [category.name, category.slug, category.description ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [ordered, filter]);

  const subcategoryCount = useMemo(
    () => (deleting ? categories.filter((category) => category.parentId === deleting.id).length : 0),
    [deleting, categories],
  );

  function openCreate() {
    setEditing(undefined);
    setDialogOpen(true);
  }

  function openEdit(category: Category) {
    setEditing(category);
    setDialogOpen(true);
  }

  function confirmDelete() {
    if (!deleting) return;
    deleteMutation.mutate(deleting.id, {
      onSuccess: (data) => {
        const notes: string[] = [];
        if (data.affectedProducts > 0) {
          notes.push(
            `${data.affectedProducts} product${data.affectedProducts === 1 ? "" : "s"} unlinked`,
          );
        }
        if ((data.reparentedChildren ?? 0) > 0) {
          notes.push(
            `${data.reparentedChildren} subcategor${
              data.reparentedChildren === 1 ? "y" : "ies"
            } moved to top level`,
          );
        }
        toast({
          title: "Category deleted",
          description: notes.length
            ? `${notes.join(". ")}. Products themselves were not deleted.`
            : "No products were linked to this category.",
          tone: "success",
        });
        setDeleting(null);
      },
      onError: (error) => {
        toast({ title: "Couldn't delete category", description: getErrorMessage(error), tone: "error" });
        setDeleting(null);
      },
    });
  }

  return (
    <>
      <AdminPageHeader
        title="Categories"
        description="Manage the catalog taxonomy and per-category GST. Categories can be nested up to three levels. Deleting a category never deletes its products or subcategories."
        breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Categories" }]}
        actions={
          <Button type="button" onClick={openCreate}>
            <Plus aria-hidden="true" />
            Add category
          </Button>
        }
      />

      <Card className="mb-6 p-4">
        <Field id="category-filter" label="Filter categories" className="max-w-md">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="category-filter"
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className="pl-9"
              placeholder="Name, slug or description"
              autoComplete="off"
            />
          </div>
        </Field>
      </Card>

      {categoriesQuery.isPending ? (
        <AdminTableSkeleton rows={5} columns={6} />
      ) : categoriesQuery.isError ? (
        <AdminQueryError
          error={categoriesQuery.error}
          title="Couldn't load categories"
          onRetry={() => void categoriesQuery.refetch()}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Tags}
          title={categories.length === 0 ? "No categories yet" : "No categories match this filter"}
          description={
            categories.length === 0
              ? "Create a category to group products and configure GST."
              : "Try a different name, slug or description."
          }
          action={
            categories.length === 0 ? (
              <Button type="button" onClick={openCreate}>
                <Plus aria-hidden="true" />
                Add category
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={() => setFilter("")}>
                Clear filter
              </Button>
            )
          }
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
            {filtered.length} categor{filtered.length === 1 ? "y" : "ies"}
            {filter.trim() ? " matching filter" : ""}
          </p>

          <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[50rem] text-sm">
                <caption className="sr-only">Catalog categories</caption>
                <thead>
                  <tr className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-3 py-3 font-medium">Name</th>
                    <th scope="col" className="px-3 py-3 font-medium">Parent</th>
                    <th scope="col" className="px-3 py-3 font-medium">Slug</th>
                    <th scope="col" className="px-3 py-3 font-medium">GST</th>
                    <th scope="col" className="px-3 py-3 font-medium">Products</th>
                    <th scope="col" className="px-3 py-3 font-medium">Description</th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((category) => {
                    const depth = depthOf(category);
                    const parent = category.parentId != null ? byId.get(category.parentId) : undefined;
                    return (
                      <tr key={category.id} className="transition-colors hover:bg-secondary/30">
                        <td className="px-3 py-3 font-medium">
                          <span
                            className="inline-flex items-center gap-1.5"
                            style={{ paddingLeft: `${(depth - 1) * 14}px` }}
                          >
                            {depth > 1 ? (
                              <CornerDownRight
                                className="size-3.5 shrink-0 text-muted-foreground"
                                aria-hidden="true"
                              />
                            ) : null}
                            {category.name}
                            {depth > 1 ? <span className="sr-only"> (subcategory)</span> : null}
                          </span>
                        </td>
                        <td className="max-w-[12rem] truncate px-3 py-3 text-muted-foreground">
                          {parent ? parent.name : category.parentId != null ? "Unknown parent" : "Top level"}
                        </td>
                        <td className="px-3 py-3">
                          <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">{category.slug}</code>
                        </td>
                        <td className="px-3 py-3 tabular-nums">{taxLabel(category.taxRate)}</td>
                        <td className="px-3 py-3">
                          <Badge
                            variant="outline"
                            title={
                              typeof category.totalProductCount === "number" &&
                              category.totalProductCount !== (category.productCount ?? 0)
                                ? `${category.productCount ?? 0} direct, ${category.totalProductCount} including subcategories`
                                : undefined
                            }
                          >
                            {category.productCount ?? 0}
                          </Badge>
                        </td>
                        <td className="max-w-[18rem] px-3 py-3">
                          <p className="truncate text-muted-foreground">
                            {category.description || "—"}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(category)}>
                              <Pencil aria-hidden="true" />
                              Edit
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Delete ${category.name}`}
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => {
                                deleteMutation.reset();
                                setDeleting(category);
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
            {filtered.map((category) => (
              <li key={category.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate font-medium">
                      {depthOf(category) > 1 ? (
                        <CornerDownRight
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      ) : null}
                      {category.name}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {category.parentId != null
                        ? `in ${byId.get(category.parentId)?.name ?? "Unknown parent"}`
                        : "Top level"}
                    </p>
                    <code className="mt-1 inline-block rounded bg-secondary px-1.5 py-0.5 text-xs">
                      {category.slug}
                    </code>
                  </div>
                  <Badge variant="outline">{category.productCount ?? 0} products</Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                  {category.description || "No description."}
                </p>
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
                  <span className="text-xs text-muted-foreground">GST {taxLabel(category.taxRate)}</span>
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(category)}>
                      <Pencil aria-hidden="true" />
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => {
                        deleteMutation.reset();
                        setDeleting(category);
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                      Delete
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <CategoryFormDialog open={dialogOpen} onOpenChange={setDialogOpen} category={editing} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) setDeleting(null);
        }}
        title="Delete category?"
        description={
          deleting
            ? `“${deleting.name}” will be removed. ${
                (deleting.productCount ?? 0) > 0
                  ? `${deleting.productCount} linked product${deleting.productCount === 1 ? "" : "s"} keep their existing free-text category name but lose the taxonomy link. `
                  : ""
              }${
                subcategoryCount > 0
                  ? `${subcategoryCount} subcategor${subcategoryCount === 1 ? "y" : "ies"} move to top level instead of being deleted. `
                  : ""
              }Products are never deleted.`
            : ""
        }
        confirmLabel="Delete category"
        tone="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={confirmDelete}
      />

      <p className="mt-6 text-xs text-muted-foreground">
        Looking for products?{" "}
        <Link to="/admin/products" className="font-medium text-primary hover:underline">
          Manage the catalog
        </Link>
        .
      </p>
    </>
  );
}
