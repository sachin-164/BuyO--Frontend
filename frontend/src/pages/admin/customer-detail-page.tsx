import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Mail, MapPin, ReceiptText, ShieldCheck, UserRound } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminQueryError } from "@/components/admin/admin-query-error";
import { OrderStatusBadge } from "@/components/commerce/order-status-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminCustomer } from "@/features/admin/queries";
import { formatDate, formatDateTime, formatPrice } from "@/lib/format";
import { usePageTitle } from "@/hooks/use-page-title";

function parseId(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading customer">
      <Card className="p-6">
        <div className="space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        {[0, 1].map((index) => (
          <Card key={index}>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
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

export default function AdminCustomerDetailPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const id = parseId(rawId);
  const customerQuery = useAdminCustomer(id);
  usePageTitle("Customer details");

  if (id === null) {
    return (
      <EmptyState
        icon={UserRound}
        title="Customer not found"
        description="That customer id is not valid."
        action={
          <Button asChild variant="outline">
            <Link to="/admin/customers">Back to customers</Link>
          </Button>
        }
      />
    );
  }

  if (customerQuery.isPending) {
    return (
      <>
        <AdminPageHeader
          title="Customer"
          breadcrumbs={[
            { label: "Admin", to: "/admin" },
            { label: "Customers", to: "/admin/customers" },
            { label: `#${id}` },
          ]}
        />
        <DetailSkeleton />
      </>
    );
  }

  if (customerQuery.isError) {
    return (
      <>
        <AdminPageHeader
          title="Customer"
          breadcrumbs={[
            { label: "Admin", to: "/admin" },
            { label: "Customers", to: "/admin/customers" },
            { label: `#${id}` },
          ]}
        />
        <AdminQueryError
          error={customerQuery.error}
          title="Couldn't load this customer"
          onRetry={() => void customerQuery.refetch()}
        />
      </>
    );
  }

  const { customer, orders } = customerQuery.data;

  return (
    <>
      <AdminPageHeader
        title={customer.name}
        description={customer.email}
        breadcrumbs={[
          { label: "Admin", to: "/admin" },
          { label: "Customers", to: "/admin/customers" },
          { label: `#${customer.id}` },
        ]}
        actions={
          <Button asChild variant="outline">
            <Link to="/admin/customers">
              <ArrowLeft aria-hidden="true" />
              All customers
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Email</dt>
                <dd className="mt-1 flex items-center gap-2 text-sm">
                  <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="break-all">{customer.email}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Verification</dt>
                <dd className="mt-1 flex items-center gap-2 text-sm">
                  {customer.isVerified ? (
                    <>
                      <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
                      Verified
                    </>
                  ) : (
                    <Badge variant="outline">Not verified</Badge>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Joined</dt>
                <dd className="mt-1 text-sm">{formatDate(customer.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Last order</dt>
                <dd className="mt-1 text-sm">
                  {customer.lastOrderAt ? formatDateTime(customer.lastOrderAt) : "No orders yet"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Orders</dt>
                <dd className="mt-1 text-sm tabular-nums">
                  {customer.orderCount}
                  {customer.cancelledCount > 0 ? (
                    <span className="ml-1 text-muted-foreground">
                      ({customer.cancelledCount} cancelled)
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Non-cancelled spend
                </dt>
                <dd className="mt-1 text-sm font-semibold tabular-nums">
                  {formatPrice(customer.totalSpend)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Addresses</CardTitle>
            <Badge variant="outline">{customer.addresses.length}</Badge>
          </CardHeader>
          <CardContent>
            {customer.addresses.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                This customer has not saved an address.
              </p>
            ) : (
              <ul className="space-y-3">
                {customer.addresses.map((address) => (
                  <li key={address.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{address.fullName}</p>
                      {address.isDefault ? <Badge variant="secondary">Default</Badge> : null}
                    </div>
                    <p className="mt-1 flex items-start gap-2 text-muted-foreground">
                      <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      <span>
                        {address.line1}
                        {address.line2 ? `, ${address.line2}` : ""}
                        <br />
                        {address.city}, {address.state} {address.pincode}
                        <br />
                        {address.phone}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-lg">Recent orders</CardTitle>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <EmptyState
              icon={ReceiptText}
              title="No orders yet"
              description="This customer has not completed a checkout."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <caption className="sr-only">Recent orders for {customer.name}</caption>
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-medium">Order</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Placed</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Items</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Total</th>
                    <th scope="col" className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td className="py-3 pr-3">
                        <Link
                          to={`/admin/orders/${order.id}`}
                          className="rounded font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {order.orderNumber}
                        </Link>
                      </td>
                      <td className="py-3 pr-3 text-muted-foreground">
                        {formatDateTime(order.createdAt)}
                      </td>
                      <td className="py-3 pr-3 text-right tabular-nums">{order.itemCount}</td>
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
          )}
        </CardContent>
      </Card>
    </>
  );
}
