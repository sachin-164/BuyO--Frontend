import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PackageOpen, Receipt } from "lucide-react";
import { OrderStatusBadge } from "@/components/commerce/order-status-timeline";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrders } from "@/features/orders/queries";
import { getErrorMessage } from "@/lib/errors";
import { formatDate, formatPrice } from "@/lib/format";
import { usePageTitle } from "@/hooks/use-page-title";
import type { OrderStatus } from "@/types/commerce";

const ORDER_STATUSES: OrderStatus[] = [
  "placed",
  "confirmed",
  "shipped",
  "delivered",
  "cancelled",
];

function parseNumericSearch(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 1000 ? parsed : 1;
}

function isOrderStatus(value: string | null): value is OrderStatus {
  return value !== null && (ORDER_STATUSES as string[]).includes(value);
}

export default function OrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = parseNumericSearch(searchParams.get("page"));
  const rawStatus = searchParams.get("status");
  const status = isOrderStatus(rawStatus) ? rawStatus : null;
  const ordersQuery = useOrders({ page, status: status ?? undefined });

  usePageTitle(
    status
      ? `${status.charAt(0).toUpperCase()}${status.slice(1)} orders`
      : "Order history",
  );

  const orders = ordersQuery.data?.orders ?? [];
  const pagination = ordersQuery.data?.pagination;

  const ordersHref = useMemo(
    () => (nextPage: number) => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (nextPage > 1) params.set("page", String(nextPage));
      const search = params.toString();
      return search ? `/orders?${search}` : "/orders";
    },
    [status],
  );

  function handleStatusChange(value: string) {
    const params = new URLSearchParams();
    if (value) params.set("status", value);
    const search = params.toString();
    setSearchParams(search ? `?${search}` : "", { replace: false });
  }

  return (
    <div className="container-page py-8 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Account
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Order history</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every order placed through this storefront.
          </p>
        </div>
        <div className="w-full max-w-xs">
          <Select
            id="orders-status"
            value={status ?? ""}
            onChange={(event) => handleStatusChange(event.target.value)}
            aria-label="Filter orders by status"
          >
            <option value="">All statuses</option>
            {ORDER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value.charAt(0).toUpperCase() + value.slice(1)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {ordersQuery.isLoading ? (
        <div className="mt-8 space-y-4" aria-busy="true">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-36 rounded-lg" />
          ))}
        </div>
      ) : null}

      {ordersQuery.isError && !ordersQuery.isPending ? (
        <Alert variant="destructive" className="mt-8">
          <Receipt aria-hidden="true" />
          <AlertTitle>Orders could not be loaded</AlertTitle>
          <AlertDescription>{getErrorMessage(ordersQuery.error)}</AlertDescription>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => void ordersQuery.refetch()}
          >
            Try again
          </Button>
        </Alert>
      ) : null}

      {ordersQuery.isSuccess && orders.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={PackageOpen}
          title={status ? `No ${status} orders` : "No orders yet"}
          description={
            status
              ? `No orders match this filter right now.`
              : "Complete a COD checkout to see your order history here."
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link to="/shop">Browse products</Link>
              </Button>
              {status ? (
                <Button asChild variant="outline">
                  <Link to="/orders">All orders</Link>
                </Button>
              ) : null}
            </div>
          }
        />
      ) : null}

      {ordersQuery.isSuccess && orders.length > 0 ? (
        <>
          <ul className="mt-8 space-y-4">
            {orders.map((order) => (
              <li key={order.id}>
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-lg">
                          <Link
                            to={`/orders/${order.id}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {order.orderNumber}
                          </Link>
                        </CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {formatDate(order.createdAt)} · Cash on delivery
                        </p>
                      </div>
                      <OrderStatusBadge status={order.status} />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {order.items.map((item) => (
                        <li key={item.id} className="flex flex-wrap justify-between gap-2">
                          <span className="min-w-0 flex-1 truncate">
                            {item.name} · x{item.qty}
                          </span>
                          <span className="font-medium">{formatPrice(item.lineTotal)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                      <p className="text-sm text-muted-foreground">
                        Order total:
                        <span className="ml-1 text-base font-semibold text-foreground">
                          {formatPrice(order.grandTotal)}
                        </span>
                      </p>
                      <Button asChild size="sm">
                        <Link to={`/orders/${order.id}`}>View details</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          {pagination ? (
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              hrefFor={ordersHref}
              className="mt-10"
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
