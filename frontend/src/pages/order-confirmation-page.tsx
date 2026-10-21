import { useMemo } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  CircleCheck,
  CircleAlert,
  PackageSearch,
} from "lucide-react";
import { OrderStatusBadge } from "@/components/commerce/order-status-timeline";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrder } from "@/features/orders/queries";
import { getErrorMessage } from "@/lib/errors";
import { formatDateTime, formatPrice } from "@/lib/format";
import { usePageTitle } from "@/hooks/use-page-title";

export default function OrderConfirmationPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const orderId = useMemo(() => {
    const parsed = Number(id);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [id]);

  const orderQuery = useOrder(orderId, Boolean(orderId));
  const order = orderQuery.data?.order;
  const justPlaced = location.state?.justPlaced === true;

  usePageTitle(order ? `Order ${order.orderNumber}` : "Order confirmation");

  if (!orderId) {
    return (
      <div className="container-page py-10">
        <EmptyState
          icon={PackageSearch}
          title="Confirmation unavailable"
          description="This confirmation link is incomplete. Your previous orders are still available."
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
    <div className="container-page py-8 sm:py-12">
      {orderQuery.isLoading ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="mx-auto h-24 w-full max-w-2xl" />
          <Skeleton className="mx-auto h-64 w-full max-w-2xl" />
        </div>
      ) : null}

      {orderQuery.isError && !orderQuery.isPending ? (
        <Alert variant="destructive" className="mx-auto max-w-2xl">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Confirmation was unavailable</AlertTitle>
          <AlertDescription>{getErrorMessage(orderQuery.error)}</AlertDescription>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => void orderQuery.refetch()}
          >
            Retry
          </Button>
        </Alert>
      ) : null}

      {order ? (
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardHeader className="text-left">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="inline-flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
                  <CircleCheck className="size-6" aria-hidden="true" />
                </span>
                <OrderStatusBadge status={order.status} />
              </div>
              <CardTitle className="mt-4 text-2xl sm:text-3xl">
                {justPlaced ? "Thanks! Order placed" : "Order placed"}
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {order.orderNumber} · {formatDateTime(order.createdAt)} · Cash on delivery
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-6">
                  <dt className="text-muted-foreground">Order total</dt>
                  <dd className="font-semibold">{formatPrice(order.grandTotal)}</dd>
                </div>
                <div className="flex justify-between gap-6">
                  <dt className="text-muted-foreground">Items</dt>
                  <dd>{order.items.length}</dd>
                </div>
                <div className="flex justify-between gap-6">
                  <dt className="text-muted-foreground">Deliver to</dt>
                  <dd className="text-right">
                    {order.shippingAddress ? order.shippingAddress.fullName : "Address"}:{" "}
                    {order.shippingAddress ? order.shippingAddress.line1 : ""}
                  </dd>
                </div>
              </dl>

              {justPlaced ? (
                <Alert variant="success" role="status">
                  <AlertTitle>Confirmed</AlertTitle>
                  <AlertDescription>
                    Retrying this checkout cannot duplicate this order; the server uses the same
                    idempotency mechanism.
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link to={`/orders/${order.id}`}>View full details</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/shop">Continue shopping</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
