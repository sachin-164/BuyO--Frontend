import { useMemo } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Banknote,
  CircleCheck,
  Info,
  PackageOpen,
  Receipt,
} from "lucide-react";
import { OrderItems } from "@/components/commerce/order-items";
import { OrderStatusBadge, OrderStatusTimeline } from "@/components/commerce/order-status-timeline";
import { addressLines } from "@/components/commerce/address-utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrder } from "@/features/orders/queries";
import { ApiError } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { formatDateTime, formatPrice } from "@/lib/format";
import { usePageTitle } from "@/hooks/use-page-title";

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const orderId = useMemo(() => {
    const parsed = Number(id);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [id]);

  const orderQuery = useOrder(orderId, Boolean(orderId));
  const order = orderQuery.data?.order;
  const justPlaced = location.state?.justPlaced === true;

  usePageTitle(order ? `Order ${order.orderNumber}` : "Order details");

  if (!orderId) {
    return (
      <div className="container-page py-8 sm:py-10">
        <EmptyState
          icon={Receipt}
          title={`"${id}" is not a valid order identifier`}
          description="Order identifiers are positive whole numbers in the API."
          action={
            <Button asChild>
              <Link to="/orders">Browse your orders</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="container-page py-8 sm:py-10">
      {orderQuery.isLoading ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-48 rounded-lg" />
        </div>
      ) : null}

      {orderQuery.isError && !orderQuery.isPending ? (
        <div className="mt-6">
          {orderQuery.error instanceof ApiError && orderQuery.error.status === 404 ? (
            <EmptyState
              icon={PackageOpen}
              title="Order not found"
              description="This order either does not exist in your account history or the link is stale. The server strictly scopes order access by user."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button asChild>
                    <Link to="/orders">All orders</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/shop">Continue shopping</Link>
                  </Button>
                </div>
              }
            />
          ) : (
            <Alert variant="destructive">
              <AlertTitle>Order details could not be loaded</AlertTitle>
              <AlertDescription>{getErrorMessage(orderQuery.error)}</AlertDescription>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => void orderQuery.refetch()}
              >
                Try again
              </Button>
            </Alert>
          )}
        </div>
      ) : null}

      {order ? (
        <div className="space-y-6">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Order
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                {order.orderNumber}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Placed {formatDateTime(order.createdAt)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <OrderStatusBadge status={order.status} />
              <Badge variant="outline" className="inline-flex items-center gap-1">
                <Banknote className="size-3.5" aria-hidden="true" />
                Cash on delivery
              </Badge>
            </div>
          </header>

          {justPlaced ? (
            <Alert variant="success" role="status">
              <CircleCheck aria-hidden="true" />
              <AlertTitle>Order confirmed</AlertTitle>
              <AlertDescription>
                Your order has been recorded. You can safely reload this page; this is not a new
                checkout submission.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-[2fr,1fr] lg:items-start">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Items</CardTitle>
                </CardHeader>
                <CardContent>
                  <OrderItems items={order.items} showTax />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Status history</CardTitle>
                </CardHeader>
                <CardContent>
                  <OrderStatusTimeline events={order.statusEvents ?? []} />
                </CardContent>
              </Card>

              <section aria-labelledby="delivery-detail-heading">
                <Card>
                  <CardHeader>
                    <CardTitle id="delivery-detail-heading">Delivery address</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {order.shippingAddress ? (
                      <div>
                        <ul className="space-y-1">
                          {addressLines(order.shippingAddress).map((line, index) => (
                            <li key={index}>{line}</li>
                          ))}
                        </ul>
                        {order.shippingAddress.label ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Label: {order.shippingAddress.label}
                          </p>
                        ) : null}
                        {order.addressId ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Address snapshot, from address #{order.addressId}.
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p>No address snapshot was returned by the API for this order.</p>
                    )}
                  </CardContent>
                </Card>
              </section>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Totals</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between gap-6">
                      <dt className="text-muted-foreground">Subtotal</dt>
                      <dd className="font-medium">{formatPrice(order.subtotal)}</dd>
                    </div>
                    <div className="flex justify-between gap-6">
                      <dt className="text-muted-foreground">GST</dt>
                      <dd className="font-medium">{formatPrice(order.taxTotal)}</dd>
                    </div>
                    <div className="flex justify-between gap-6 border-t border-border pt-3">
                      <dt className="font-semibold">Order total</dt>
                      <dd className="text-lg font-semibold">
                        {formatPrice(order.grandTotal)}
                      </dd>
                    </div>
                  </dl>
                  {order.notes ? (
                    <div className="mt-5">
                      <p className="text-xs font-medium text-muted-foreground">Delivery notes</p>
                      <p className="mt-1 whitespace-pre-line text-sm">{order.notes}</p>
                    </div>
                  ) : null}
                  {order.taxBreakdown && order.taxBreakdown.length > 0 ? (
                    <ul className="mt-5 space-y-1 text-xs text-muted-foreground">
                      {order.taxBreakdown.map((group, index) => (
                        <li key={index}>
                          {group.categoryName ?? "Uncategorised"} ({group.taxRate}%):{" "}
                          {formatPrice(group.taxAmount)} on {formatPrice(group.taxableAmount)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </CardContent>
              </Card>

              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <Link to="/orders">
                    <ArrowLeft aria-hidden="true" />
                    All orders
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/shop">Continue shopping</Link>
                </Button>
              </div>
              {order.status === "cancelled" ? (
                <Alert variant="warning">
                  <Info aria-hidden="true" />
                  <AlertTitle>Cancelled order</AlertTitle>
                  <AlertDescription>
                    The server marked this order cancelled. There is no customer-facing cancellation
                    request endpoint in the current API.
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
