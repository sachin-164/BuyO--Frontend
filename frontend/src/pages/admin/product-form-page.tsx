import { ArrowLeft, PackageSearch } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminQueryError } from "@/components/admin/admin-query-error";
import { ProductForm } from "@/components/admin/product-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategories, useProduct } from "@/features/catalog/queries";
import { ApiError } from "@/lib/api";
import { usePageTitle } from "@/hooks/use-page-title";

function FormSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]" aria-busy="true" aria-label="Loading product form">
      <div className="space-y-6">
        {[0, 1, 2].map((index) => (
          <Card key={index} className="space-y-4 p-6">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </Card>
        ))}
      </div>
      <Card className="h-fit space-y-4 p-6">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="aspect-square w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-6 w-1/2" />
      </Card>
    </div>
  );
}

export default function AdminProductFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = id !== undefined;
  const numericId = id && /^\d+$/.test(id) && Number(id) > 0 ? Number(id) : null;
  usePageTitle(isEdit ? "Edit product" : "New product");

  const productQuery = useProduct(isEdit && numericId ? String(numericId) : undefined);
  const categoriesQuery = useCategories();

  const header = (
    <AdminPageHeader
      title={isEdit ? "Edit product" : "Add product"}
      description={
        isEdit
          ? "Update catalog details, inventory and imagery. The server validates every change."
          : "Create a catalog product. Images can be uploaded with a short-lived storage authorization."
      }
      breadcrumbs={[
        { label: "Admin", to: "/admin" },
        { label: "Products", to: "/admin/products" },
        { label: isEdit ? "Edit" : "New" },
      ]}
      actions={
        <Button asChild variant="outline">
          <Link to="/admin/products">
            <ArrowLeft aria-hidden="true" />
            Back to products
          </Link>
        </Button>
      }
    />
  );

  if (isEdit && numericId === null) {
    return (
      <>
        {header}
        <EmptyState
          icon={PackageSearch}
          title="Invalid product link"
          description="The product id in this URL is not valid."
          action={
            <Button asChild variant="outline">
              <Link to="/admin/products">Back to products</Link>
            </Button>
          }
        />
      </>
    );
  }

  const productError = productQuery.error;
  if (isEdit && productQuery.isError) {
    if (productError instanceof ApiError && productError.status === 404) {
      return (
        <>
          {header}
          <EmptyState
            icon={PackageSearch}
            title="Product not found"
            description="This product does not exist or has been removed."
            action={
              <Button asChild variant="outline">
                <Link to="/admin/products">Back to products</Link>
              </Button>
            }
          />
        </>
      );
    }
    return (
      <>
        {header}
        <AdminQueryError
          error={productError}
          title="Couldn't load the product"
          onRetry={() => void productQuery.refetch()}
        />
      </>
    );
  }

  const productReady = !isEdit || productQuery.isSuccess;
  const categoriesReady = categoriesQuery.isSuccess || categoriesQuery.isError;

  if (!productReady || !categoriesReady) {
    return (
      <>
        {header}
        <FormSkeleton />
      </>
    );
  }

  return (
    <>
      {header}
      <ProductForm
        key={productQuery.data?.product.id ?? "new"}
        product={productQuery.data?.product}
        categories={categoriesQuery.data?.categories ?? []}
        categoriesUnavailable={categoriesQuery.isError}
      />
    </>
  );
}
