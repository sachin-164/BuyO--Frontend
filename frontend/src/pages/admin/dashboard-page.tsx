import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  IndianRupee,
  Package,
  PackageX,
  Plus,
  ReceiptText,
  Tags,
  TrendingUp,
  Users,
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

const RANGE_OPTIONS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

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
    </div>
  );
}

/**
 * A day-by-day revenue strip. Bars are decorative (aria-hidden) and every value
 * is repeated in an accessible table caption, so the chart never carries
 * information that a screen reader cannot reach. No motion is used: the data is
 * static once fetched, so animating it would be decoration on a dashboard.
 */
function RevenueStrip({ series }: { series: Array<{ day: string; revenue: number; orders: number }> }) {
  if (series.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        No revenue recorded in this range.
      </p>
    );
  }

  const peak = Math.max(...series.map((point) => point.revenue), 1);
  const total = series.reduce((sum, point) => sum + point.revenue, 0);
  const orderCount = series.reduce((sum, point) => sum + point.orders, 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-2xl font-semibold tabular-nums">{formatPrice(total)}</p>
        <p className="text-xs text-muted-foreground">
          {orderCount.toLocaleString("en-IN")} order{orderCount === 1 ? "" : "s"} ·{" "}
          {series.length} day{series.length === 1 ? "" : "s"} with revenue
        </p>
      </div>
      <div
        className="flex h-24 items-end gap-1 overflow-hidden rounded-md border border-border bg-secondary/30 p-2"
        aria-hidden="true"
      >
        {series.map((point, index) => (
          <div
            key={`${point.day}-${index}`}
            className="min-w-0 flex-1 rounded-sm bg-primary/70"
            style={{ height: `${Math.max(4, Math.round((point.revenue / peak) * 100))}%` }}
            title={`${point.day}: ${formatPrice(point.revenue)}`}
          />
        ))}
      </div>
      <table className="sr-only">
        <caption>Revenue by day for the selected range</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Revenue</th>
            <th scope="col">Orders</th>
          </tr>
        </thead>
        <tbody>
          {series.map((point) => (
            <tr key={point.day}>
              <th scope="row">{point.day}</th>
              <td>{formatPrice(point.revenue)}</td>
              <td>{point.orders}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminDashboardPage() {
  usePageTitle("Admin dashboard");
  const [days, setDays] = useState(30);
  const dashboard = useAdminDashboard(days);

  const header = (
    <AdminPageHeader
      title="Dashboard"
      description="Server-side aggregates over the real catalog and order tables. No capped page walks, no estimated figures."
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

  return (
    <>
      {header}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <AdminStat
          label="Products"
          value={data.products.total.toLocaleString("en-IN")}
          note={`${data.products.lowStockCount} low · ${data.products.outOfStock} out of stock`}
          icon={Package}
          to="/admin/products"
        />
        <AdminStat
          label="Customers"
          value={data.customers.total.toLocaleString("en-IN")}
          note={`${data.customers.newInRange.toLocaleString("en-IN")} new in ${days} days`}
          icon={Users}
          to="/admin/customers"
        />
        <AdminStat
          label="Orders"
          value={data.orders.total.toLocaleString("en-IN")}
          note={`${data.orders.nonCancelledCount.toLocaleString("en-IN")} non-cancelled`}
          icon={ReceiptText}
          to="/admin/orders"
        />
        <AdminStat
          label="Order value"
          value={formatPrice(data.orders.grossOrderValue)}
          note="Non-cancelled gross value (COD)"
          icon={IndianRupee}
        />
        <AdminStat
          label="Average order"
          value={formatPrice(data.orders.averageOrderValue)}
          note="Non-cancelled gross ÷ orders"
          icon={TrendingUp}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-lg">Revenue</CardTitle>
            <div className="flex gap-1" role="group" aria-label="Revenue range">
              {RANGE_OPTIONS.map((option) => (
                <Button
                  key={option.days}
                  type="button"
                  size="sm"
                  variant={option.days === days ? "secondary" : "ghost"}
                  aria-pressed={option.days === days}
                  onClick={() => setDays(option.days)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {dashboard.isFetching ? (
              <p role="status" className="mb-2 text-xs text-muted-foreground">
                Refreshing…
              </p>
            ) : null}
            <RevenueStrip series={data.revenueSeries} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Orders by status</CardTitle>
            <Link
              to="/admin/orders"
              className="rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                      {data.orders.byStatus[status].toLocaleString("en-IN")}
                      <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Low stock</CardTitle>
            <Badge variant="outline">≤ {data.products.lowStockThreshold} units</Badge>
          </CardHeader>
          <CardContent>
            {data.products.lowStock.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-4 py-8 text-center">
                <p className="text-sm font-medium">No low-stock products</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.products.outOfStock === 0
                    ? "Every product is above the low-stock threshold."
                    : "Only out-of-stock products remain; none are low but in stock."}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {data.products.lowStock.map((product) => (
                  <li key={product.id} className="flex items-center gap-3 py-2.5">
                    <ProductThumb src={product.image} name={product.name} className="size-9" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{product.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{product.category ?? "—"}</p>
                    </div>
                    <Badge variant="outline">{product.stock} left</Badge>
                    <Link
                      to={`/admin/products/${product.id}/edit`}
                      className="rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Edit
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {data.products.outOfStock > 0 ? (
              <div className="mt-4">
                <Button asChild variant="outline" size="sm">
                  <Link to="/admin/products?stock=out">
                    <PackageX aria-hidden="true" />
                    {data.products.outOfStock} out of stock
                  </Link>
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Top products</CardTitle>
            <Badge variant="outline">By revenue</Badge>
          </CardHeader>
          <CardContent>
            {data.topProducts.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                No sales recorded yet. Figures appear after the first non-cancelled order.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {data.topProducts.map((product, index) => (
                  <li key={`${product.productId ?? "deleted"}-${index}`} className="flex items-center gap-3 py-2.5">
                    <span className="w-4 text-xs tabular-nums text-muted-foreground" aria-hidden="true">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{product.name}</p>
                      <p className="text-xs text-muted-foreground">{product.units} sold</p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums">
                      {formatPrice(product.revenue)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Computed from purchase snapshots, so renamed or deleted products still report their
              historical revenue.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Catalog</CardTitle>
            <Tags className="size-4 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              <li className="flex items-center justify-between py-2.5 text-sm">
                <span>Categories</span>
                <span className="font-semibold tabular-nums">{data.categories.total}</span>
              </li>
              <li className="flex items-center justify-between py-2.5 text-sm">
                <span>Products</span>
                <span className="font-semibold tabular-nums">{data.products.total}</span>
              </li>
              <li className="flex items-center justify-between py-2.5 text-sm">
                <span>In stock</span>
                <span className="font-semibold tabular-nums">
                  {Math.max(0, data.products.total - data.products.outOfStock)}
                </span>
              </li>
              <li className="flex items-center justify-between py-2.5 text-sm">
                <span>Out of stock</span>
                <span className="font-semibold tabular-nums">{data.products.outOfStock}</span>
              </li>
            </ul>
            <div className="mt-4 flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/categories">Categories</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/products">Products</Link>
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
            className="rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                            className="rounded font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                        className="rounded font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
