import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  CircleCheck,
  MapPin,
  PackageCheck,
  ReceiptText,
  Truck,
  UserRound,
} from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminQueryError } from "@/components/admin/admin-query-error";
import { OrderItems } from "@/components/commerce/order-items";
import { OrderStatusBadge, OrderStatusTimeline } from "@/components/commerce/order-status-timeline";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/form-field";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useAdminOrder } from "@/features/admin/queries";
import { useUpdateAdminOrderStatus } from "@/features/admin/mutations";
import { useAuth } from "@/features/auth/auth-context";
import { ApiError } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { formatDateTime, formatPrice } from "@/lib/format";
import { usePageTitle } from "@/hooks/use-page-title";
import type { OrderStatus } from "@/types/commerce";

interface Transition {
  status: OrderStatus;
  label: string;
  variant: "secondary" | "default" | "destructive";
  confirmTitle: string;
  description: string;
  icon: typeof CircleCheck;
}

function transitionsFor(orderNumber: string): Record<OrderStatus, Transition[]> {
  return {
    placed: [
      {
        status: "confirmed",
        label: "Confirm order",
        variant: "secondary",
        confirmTitle: "Confirm this order?",
        description: `Record confirmation for ${orderNumber}. The customer will see the updated status and this event in the timeline.`,
        icon: CircleCheck,
      },
      {
        status: "cancelled",
        label: "Cancel order",
        variant: "destructive",
        confirmTitle: "Cancel this order?",
        description: `Cancel ${orderNumber}? Every item will be restocked once in the same transaction. This cannot be undone.`,
        icon: Ban,
      },
    ],
    confirmed: [
      {
        status: "shipped",
        label: "Mark shipped",
        variant: "secondary",
        confirmTitle: "Mark this order as shipped?",
        description: `Record shipment for ${orderNumber}. The API has no carrier or tracking fields, so none will be invented.`,
        icon: Truck,
      },
      {
        status: "cancelled",
        label: "Cancel order",
        variant: "destructive",
        confirmTitle: "Cancel this order?",
        description: `Cancel ${orderNumber}? Every item will be restocked once in the same transaction. This cannot be undone.`,
        icon: Ban,
      },
    ],
    shipped: [
      {
        status: "delivered",
        label: "Mark delivered",
        variant: "default",
        confirmTitle: "Mark this order as delivered?",
        description: `Mark ${orderNumber} as delivered. Delivered is a terminal status and cannot be changed again.`,
        icon: PackageCheck,
      },
    ],
    delivered: [],
    cancelled: [],
  };
}

function DetailSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]" aria-busy="true" aria-label="Loading order">
      <div className="space-y-6">
        <Card className="space-y-4 p-6">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </Card>
        <Card className="space-y-4 p-6">
          <Skeleton className="h-5 w-32" />
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </Card>
      </div>
      <div className="space-y-6">
        <Card className="space-y-4 p-6">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </Card>
        <Card className="space-y-3 p-6">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-16 w-full" />
        </Card>
      </div>
    </div>
  );
}

export default function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const numericId = id && /^\d+$/.test(id) && Number(id) > 0 ? Number(id) : null;
  const orderQuery = useAdminOrder(numericId);
  const updateStatus = useUpdateAdminOrderStatus(numericId);
  const { refresh } = useAuth();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [pendingTransition, setPendingTransition] = useState<Transition | null>(null);

  const order = orderQuery.data?.order;
  usePageTitle(order ? `Order ${order.orderNumber}` : "Order details");

  const headerTitle = order ? `Order ${order.orderNumber}` : "Order details";
  const headerDescription = order
    ? `Placed ${formatDateTime(order.createdAt)} · ${order.items.reduce((sum, item) => sum + item.qty, 0)} item(s) · Cash on delivery`
    : "Review the server-recorded order, customer and timeline.";

  const header = (
    <AdminPageHeader
      title={headerTitle}
      description={headerDescription}
      breadcrumbs={[
        { label: "Admin", to: "/admin" },
        { label: "Orders", to: "/admin/orders" },
        { label: order?.orderNumber ?? "Detail" },
      ]}
      actions={
        <>
          {order ? <OrderStatusBadge status={order.status} /> : null}
          <Button asChild variant="outline">
            <Link to="/admin/orders">
              <ArrowLeft aria-hidden="true" />
              Back to orders
            </Link>
          </Button>
        </>
      }
    />
  );

  if (numericId === null) {
    return (
      <>
        {header}
        <EmptyState
          icon={ReceiptText}
          title="Invalid order link"
          description="The order id in this URL is not valid."
          action={
            <Button asChild variant="outline">
              <Link to="/admin/orders">Back to orders</Link>
            </Button>
          }
        />
      </>
    );
  }

  if (orderQuery.isPending) {
    return (
      <>
        {header}
        <DetailSkeleton />
      </>
    );
  }

  if (orderQuery.isError) {
    if (orderQuery.error instanceof ApiError && orderQuery.error.status === 404) {
      return (
        <>
          {header}
          <EmptyState
            icon={ReceiptText}
            title="Order not found"
            description="This order does not exist or is not available to this admin account."
            action={
              <Button asChild variant="outline">
                <Link to="/admin/orders">Back to orders</Link>
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
          error={orderQuery.error}
          title="Couldn't load the order"
          onRetry={() => void orderQuery.refetch()}
        />
      </>
    );
  }

  if (!order) {
    return (
      <>
        {header}
        <EmptyState
          icon={ReceiptText}
          title="Order unavailable"
          description="The server returned no order data for this request."
        />
      </>
    );
  }

  const transitions = transitionsFor(order.orderNumber)[order.status];
  const isTerminal = order.status === "delivered" || order.status === "cancelled";

  function confirmTransition() {
    if (!pendingTransition) return;
    const target = pendingTransition;
    updateStatus.mutate(
      { status: target.status, note: note.trim() || undefined },
      {
        onSuccess: (data) => {
          toast({
            title: "Order status updated",
            description: data.message || `The order is now ${target.label.toLowerCase()}.`,
            tone: "success",
          });
          setNote("");
          setPendingTransition(null);
        },
        onError: (error) => {
          setPendingTransition(null);
          toast({
            title: "Couldn't update the order",
            description: getErrorMessage(error),
            tone: "error",
          });
          if (error instanceof ApiError && error.status === 403) refresh();
          // A 409 means the order moved underneath us; onSettled in the hook
          // invalidates the detail query so the UI shows the real state.
        },
      },
    );
  }

  const activeTaxGroups = (order.taxBreakdown ?? []).filter((group) => group.taxAmount > 0);

  return (
    <>
      {header}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Items</CardTitle>
            </CardHeader>
            <CardContent>
              <OrderItems items={order.items} showTax />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Status history</CardTitle>
            </CardHeader>
            <CardContent>
              <OrderStatusTimeline events={order.statusEvents} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Order notes</CardTitle>
            </CardHeader>
            <CardContent>
              {order.notes ? (
                <p className="whitespace-pre-line text-sm">{order.notes}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No checkout notes were provided.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className={isTerminal ? undefined : "lg:sticky lg:top-24"}>
            <CardHeader>
              <CardTitle className="text-lg">Update status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isTerminal ? (
                <Alert variant={order.status === "cancelled" ? "destructive" : "success"}>
                  {order.status === "cancelled" ? (
                    <Ban aria-hidden="true" />
                  ) : (
                    <PackageCheck aria-hidden="true" />
                  )}
                  <AlertTitle>
                    {order.status === "cancelled" ? "Order cancelled" : "Order delivered"}
                  </AlertTitle>
                  <AlertDescription>
                    This is a terminal status. The API exposes no further transitions, so no
                    actions are shown.
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <Field
                    id="order-status-note"
                    label="Status note"
                    optional
                    hint="Stored in the order's status history. Up to 500 characters."
                  >
                    <Textarea
                      id="order-status-note"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      maxLength={500}
                      rows={3}
                      placeholder="Optional context for this change"
                    />
                  </Field>
                  <div className="grid gap-2">
                    {transitions.map((transition) => (
                      <Button
                        key={transition.status}
                        type="button"
                        variant={transition.variant === "default" ? "default" : transition.variant}
                        onClick={() => setPendingTransition(transition)}
                        className="w-full justify-start"
                      >
                        <transition.icon aria-hidden="true" />
                        {transition.label}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Only transitions the server permits are shown. The API re-validates every change
                    and returns a conflict if the order moved first.
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
                {order.user?.name ?? "Unknown customer"}
              </p>
              <p className="break-all text-muted-foreground">{order.user?.email ?? "—"}</p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Account #{order.user?.id ?? order.userId}</Badge>
                <Badge variant="secondary">Cash on delivery</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                The API exposes no customer profile or editing endpoints; only order-linked details
                are shown.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Delivery address</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="flex items-start gap-2 font-medium">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {order.shippingAddress.fullName}
              </p>
              {order.shippingAddress.label ? (
                <p className="text-xs text-muted-foreground">{order.shippingAddress.label}</p>
              ) : null}
              <p className="text-muted-foreground">{order.shippingAddress.phone}</p>
              <p className="text-muted-foreground">{order.shippingAddress.line1}</p>
              {order.shippingAddress.line2 ? (
                <p className="text-muted-foreground">{order.shippingAddress.line2}</p>
              ) : null}
              <p className="text-muted-foreground">
                {order.shippingAddress.city}, {order.shippingAddress.state}{" "}
                {order.shippingAddress.pincode}
              </p>
              {order.addressId ? (
                <p className="pt-1 text-xs text-muted-foreground">Address #{order.addressId}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Order summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{formatPrice(order.subtotal)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Tax</span>
                <span className="tabular-nums">{formatPrice(order.taxTotal)}</span>
              </div>
              {activeTaxGroups.length > 0 ? (
                <ul className="space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
                  {activeTaxGroups.map((group, index) => (
                    <li key={`${group.categoryId ?? "none"}-${index}`} className="flex justify-between gap-3">
                      <span>
                        {group.categoryName ?? "Uncategorised"} ({group.taxRate}%)
                      </span>
                      <span className="tabular-nums">{formatPrice(group.taxAmount)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex justify-between gap-3 border-t border-border pt-2 text-base font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatPrice(order.grandTotal)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Cash on delivery. The server owns all totals; this view never recalculates them.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={pendingTransition !== null}
        onOpenChange={(open) => {
          if (!open && !updateStatus.isPending) setPendingTransition(null);
        }}
        title={pendingTransition?.confirmTitle ?? "Update order status?"}
        description={pendingTransition?.description ?? ""}
        confirmLabel={pendingTransition?.label ?? "Update status"}
        tone={pendingTransition?.status === "cancelled" ? "destructive" : "default"}
        isPending={updateStatus.isPending}
        onConfirm={confirmTransition}
      />
    </>
  );
}
