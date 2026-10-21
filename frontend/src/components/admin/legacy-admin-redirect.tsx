import { Navigate, useSearchParams } from "react-router-dom";

function numericId(value: string | null): string | null {
  return value && /^\d+$/.test(value) && Number(value) > 0 ? value : null;
}

/** `/admin/product-form.html?id=7` -> `/admin/products/7/edit` (Phase 5). */
export function LegacyAdminProductRedirect() {
  const [searchParams] = useSearchParams();
  const id = numericId(searchParams.get("id"));
  return (
    <Navigate to={id ? `/admin/products/${id}/edit` : "/admin/products"} replace />
  );
}

/** `/admin/order-detail.html?id=23` -> `/admin/orders/23` (Phase 5). */
export function LegacyAdminOrderRedirect() {
  const [searchParams] = useSearchParams();
  const id = numericId(searchParams.get("id"));
  return <Navigate to={id ? `/admin/orders/${id}` : "/admin/orders"} replace />;
}
