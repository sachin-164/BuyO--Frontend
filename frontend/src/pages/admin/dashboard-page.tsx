import { Link } from "react-router-dom";
import {
  ArrowRight,
  IndianRupee,
  Package,
  PackageX,
  Plus,
  ReceiptText,
  Tags,
} from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminQueryError } from "@/components/admin/admin-query-error";
import { AdminStat } from "@/components/admin/admin-stat";
import { ProductThumb } from "@/components/admin/product-thumb";
import { OrderStatusBadge } from "@/components/commerce/order-status-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminDashboard } from "@/features/admin/queries";
import { ORDER_STATUS_LABELS } from "@/features/admin/keys";
import { ORDER_STATUS_VALUES } from "@/types/admin";
import { formatDateTime, formatPrice } from "@/lib/format";
import { usePageTitle } from "@/hooks/use-page-title";

const LOW_STOCK_THRESHOLD = 5;

function StatSkeletons() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-busy="true" aria-label="Loading dashboard">
      {Array.from({ length: 5 }, (_, index) => (
        <Card key={index} className="flex items-start gap-4 p-5">
          <Skeleton className="size-10 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3 w-24" />
          </div>
        </Card>
      ))}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <StatSkeletons />
      <div className="grid gap-6 lg:grid-cols-2">
        {[0, 1].map((index) => (
          <Card key={index}>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: 4 }, (_, row) => (
                <Skeleton key={row} className="h-10 w-full" />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-36" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }, (_, row) => (
            <Skeleton key={row} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminDashboardPage() {
  usePageTitle("Admin dashboard");
  const dashboard = useAdminDashboard();

  const header = (
    <AdminPageHeader
      title="Dashboard"
      description="Live catalog and order health. Every figure below comes from the existing API and is labelled when a safety cap applies."
      actions={
        <>
          <Button asChild variant="outline">
            <Link to="/admin/orders">
              <ReceiptText aria-hidden="true" />
              Manage orders
            </Link>
          </Button>
          <Button asChild>
            <Link to="/admin/products/new">
              <Plus aria-hidden="true" />
              Add product
            </Link>
          </Button>
        </>
      }
    />
  );

  if (dashboard.isPending) {
    return (
      <>
        {header}
        <DashboardSkeleton />
      </>
    );
  }

  if (dashboard.isError) {
    return (
      <>
        {header}
        <AdminQueryError
          error={dashboard.error}
          title="Couldn't load the dashboard"
          onRetry={() => void dashboard.refetch()}
        />
      </>
    );
  }

  const data = dashboard.data;
  const productsNote = data.productsTruncated
    ? `Counted in the first ${data.products.length.toLocaleString("en-IN")} products`
    : "Total catalog records";
  const orderValueNote = data.ordersTruncated
    ? `Non-cancelled, first ${data.orders.length.toLocaleString("en-IN")} orders`
    : "Non-cancelled gross order value (COD)";

  return (
    <>
      {header}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <AdminStat
          label="Products"
          value={data.productTotal.toLocaleString("en-IN")}
          note={productsNote}
          icon={Package}
          to="/admin/products"
        />
        <AdminStat
          label="Categories"
          value={String(data.categories.length)}
          note="Configured catalog taxonomy"
          icon={Tags}
          to="/admin/categories"
        />
        <AdminStat
          label="Orders"
          value={data.orderTotal.toLocaleString("en-IN")}
          note={
            data.ordersTruncated
              ? `Status/value based on ${data.orders.length.toLocaleString("en-IN")} fetched`
              : "All statuses"
          }
          icon={ReceiptText}
          to="/admin/orders"
        />
        <AdminStat
          label="Order value"
          value={formatPrice(data.orderValue)}
          note={orderValueNote}
          icon={IndianRupee}
        />
        <AdminStat
          label="Out of stock"
          value={String(data.outOfStock)}
          note={
            data.productsTruncated
              ? `In the first ${data.products.length.toLocaleString("en-IN")} products`
              : "Products with zero stock"
          }
          icon={PackageX}
          to="/admin/products?stock=out"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Orders by status</CardTitle>
            <Link
              to="/admin/orders"
              className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              View all
            </Link>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {ORDER_STATUS_VALUES.map((status) => (
                <li key={status}>
                  <Link
                    to={status === "placed" ? "/admin/orders" : `/admin/orders?status=${status}`}
                    className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <OrderStatusBadge status={status} />
                      <span className="text-muted-foreground">{ORDER_STATUS_LABELS[status]}</span>
                    </span>
                    <span className="inline-flex items-center gap-2 text-sm font-semibold tabular-nums">
                      {data.statusCounts[status].toLocaleString("en-IN")}
                      <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {data.ordersTruncated ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Counts cover the first {data.orders.length.toLocaleString("en-IN")} orders; the API
                has no aggregate analytics endpoint.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Low stock</CardTitle>
            <Badge variant="outline">≤ {LOW_STOCK_THRESHOLD} units</Badge>
          </CardHeader>
          <CardContent>
            {data.lowStock.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-4 py-8 text-center">
                <p className="text-sm font-medium">No low-stock products</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.productsTruncated
                    ? "Checked across the fetched products only."
                    : "Every product has more than five units available."}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {data.lowStock.map((product) => (
                  <li key={product.id} className="flex items-center gap-3 py-2.5">
                    <ProductThumb src={product.image} name={product.name} className="size-9" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{product.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {product.Category?.name ?? product.category}
                      </p>
                    </div>
                    <Badge variant={product.stock === 0 ? "destructive" : "outline"}>
                      {product.stock === 0 ? "Out" : `${product.stock} left`}
                    </Badge>
                    <Link
                      to={`/admin/products/${product.id}/edit`}
                      className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Edit
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4">
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/products?stock=in">Manage inventory</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg">Recent orders</CardTitle>
          <Link
            to="/admin/orders"
            className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            View all
          </Link>
        </CardHeader>
        <CardContent>
          {data.recentOrders.length === 0 ? (
            <EmptyState
              icon={ReceiptText}
              title="No orders yet"
              description="Orders will appear here as customers complete checkout. The dashboard only shows real server data."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link to="/admin/products">Review products</Link>
                </Button>
              }
            />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[40rem] text-sm">
                  <caption className="sr-only">Five most recent orders</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="pb-2 pr-3 font-medium">Order</th>
                      <th scope="col" className="pb-2 pr-3 font-medium">Customer</th>
                      <th scope="col" className="pb-2 pr-3 font-medium">Placed</th>
                      <th scope="col" className="pb-2 pr-3 text-right font-medium">Total</th>
                      <th scope="col" className="pb-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.recentOrders.map((order) => (
                      <tr key={order.id}>
                        <td className="py-3 pr-3">
                          <Link
                            to={`/admin/orders/${order.id}`}
                            className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {order.orderNumber}
                          </Link>
                        </td>
                        <td className="py-3 pr-3">
                          <span className="block max-w-[14rem] truncate">
                            {order.user?.name ?? "Unknown customer"}
                          </span>
                          <span className="block max-w-[14rem] truncate text-xs text-muted-foreground">
                            {order.user?.email ?? "—"}
                          </span>
                        </td>
                        <td className="py-3 pr-3 text-muted-foreground">
                          {formatDateTime(order.createdAt)}
                        </td>
                        <td className="py-3 pr-3 text-right font-medium tabular-nums">
                          {formatPrice(order.grandTotal)}
                        </td>
                        <td className="py-3">
                          <OrderStatusBadge status={order.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="space-y-3 md:hidden">
                {data.recentOrders.map((order) => (
                  <li key={order.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        to={`/admin/orders/${order.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {order.orderNumber}
                      </Link>
                      <OrderStatusBadge status={order.status} />
                    </div>
                    <p className="mt-1 truncate text-sm">{order.user?.name ?? "Unknown customer"}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(order.createdAt)}</p>
                    <p className="mt-1 text-sm font-semibold tabular-nums">
                      {formatPrice(order.grandTotal)}
                    </p>
                  </li>
                ))}
              </ul>
              {data.ordersTruncated ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  This preview uses the fetched order set, not an analytics endpoint.
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
