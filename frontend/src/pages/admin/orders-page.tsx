import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ReceiptText, RefreshCw, Search } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminQueryError } from "@/components/admin/admin-query-error";
import { AdminTableSkeleton } from "@/components/admin/admin-table-skeleton";
import { OrderStatusBadge } from "@/components/commerce/order-status-timeline";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { useAdminOrders } from "@/features/admin/queries";
import { ORDER_STATUS_LABELS } from "@/features/admin/keys";
import { ORDER_STATUS_VALUES } from "@/types/admin";
import type { OrderStatus } from "@/types/commerce";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDateTime, formatPrice } from "@/lib/format";
import { usePageTitle } from "@/hooks/use-page-title";

function parsePage(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseStatus(value: string | null): OrderStatus | "" {
  return ORDER_STATUS_VALUES.includes(value as OrderStatus) ? (value as OrderStatus) : "";
}

export default function AdminOrdersPage() {
  usePageTitle("Orders");
  const [searchParams, setSearchParams] = useSearchParams();
  const page = parsePage(searchParams.get("page"));
  const status = parseStatus(searchParams.get("status"));
  const urlQuery = searchParams.get("q") ?? "";
  const [term, setTerm] = useState(urlQuery);
  const debouncedTerm = useDebouncedValue(term, 300);

  // Debounced search is mirrored into the URL (replace, so typing does not
  // flood history) and resets pagination whenever the term changes.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (debouncedTerm.trim()) next.set("q", debouncedTerm.trim());
    else next.delete("q");
    if (debouncedTerm.trim() !== urlQuery) next.delete("page");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedTerm]);

  const ordersQuery = useAdminOrders({ page, status, q: debouncedTerm });

  function hrefFor(nextPage: number) {
    const next = new URLSearchParams();
    if (status) next.set("status", status);
    if (debouncedTerm.trim()) next.set("q", debouncedTerm.trim());
    if (nextPage > 1) next.set("page", String(nextPage));
    const search = next.toString();
    return search ? `/admin/orders?${search}` : "/admin/orders";
  }

  function changeStatus(nextStatus: string) {
    const next = new URLSearchParams();
    if (nextStatus) next.set("status", nextStatus);
    if (debouncedTerm.trim()) next.set("q", debouncedTerm.trim());
    setSearchParams(next);
  }

  const data = ordersQuery.data;
  const orders = data?.orders ?? [];
  const pagination = data?.pagination;
  const searching = debouncedTerm.trim() !== "";

  return (
    <>
      <AdminPageHeader
        title="Orders"
        description="Server-searched order queue. Search by order number, customer name or email, then open an order to record the next permitted status."
        breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Orders" }]}
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => void ordersQuery.refetch()}
            disabled={ordersQuery.isFetching}
          >
            <RefreshCw className={ordersQuery.isFetching ? "animate-spin" : undefined} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      <Card className="mb-6 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field id="order-search" label="Search" className="w-full sm:w-80">
            <Input
              id="order-search"
              type="search"
              value={term}
              placeholder="Order number, customer name or email"
              autoComplete="off"
              onChange={(event) => setTerm(event.target.value)}
            />
          </Field>
          <Field id="order-status-filter" label="Status" className="w-full sm:w-56">
            <Select
              id="order-status-filter"
              value={status}
              onChange={(event) => changeStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              {ORDER_STATUS_VALUES.map((value) => (
                <option key={value} value={value}>
                  {ORDER_STATUS_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          {status || searching ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setTerm("");
                setSearchParams(new URLSearchParams());
              }}
            >
              Reset filters
            </Button>
          ) : null}
          <p className="pb-2 text-xs text-muted-foreground" aria-live="polite">
            {ordersQuery.isFetching && !ordersQuery.isPending
              ? "Searching…"
              : searching
                ? "Matching order number, customer name or email."
                : "Newest orders first."}
          </p>
        </div>
      </Card>

      {ordersQuery.isPending ? (
        <AdminTableSkeleton rows={6} columns={6} />
      ) : ordersQuery.isError ? (
        <AdminQueryError
          error={ordersQuery.error}
          title="Couldn't load orders"
          onRetry={() => void ordersQuery.refetch()}
        />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={searching ? Search : ReceiptText}
          title={
            searching
              ? "No orders match that search"
              : status
                ? `No ${ORDER_STATUS_LABELS[status].toLowerCase()} orders`
                : "No orders yet"
          }
          description={
            searching
              ? "Try a different order number, customer name or email — or clear the search."
              : status
                ? "No orders currently have this status. Clear the filter to see every order."
                : "Orders will appear here after customers check out with cash on delivery."
          }
          action={
            searching || status ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setTerm("");
                  setSearchParams(new URLSearchParams());
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button asChild variant="outline">
                <Link to="/admin/products">Review products</Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <p aria-live="polite">
              {pagination?.total.toLocaleString("en-IN") ?? orders.length} order
              {(pagination?.total ?? orders.length) === 1 ? "" : "s"}
              {status ? ` with status ${ORDER_STATUS_LABELS[status].toLowerCase()}` : ""}
              {searching ? ` matching “${debouncedTerm.trim()}”` : ""}
            </p>
            {ordersQuery.isFetching ? <p role="status">Refreshing…</p> : null}
          </div>

          <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-sm">
                <caption className="sr-only">Orders, newest first</caption>
                <thead>
                  <tr className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-3 py-3 font-medium">Order</th>
                    <th scope="col" className="px-3 py-3 font-medium">Customer</th>
                    <th scope="col" className="px-3 py-3 font-medium">Placed</th>
                    <th scope="col" className="px-3 py-3 font-medium">Items</th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">Total</th>
                    <th scope="col" className="px-3 py-3 font-medium">Status</th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orders.map((order) => {
                    const itemCount = order.items.reduce((sum, item) => sum + item.qty, 0);
                    return (
                      <tr key={order.id} className="transition-colors hover:bg-secondary/30">
                        <td className="px-3 py-3">
                          <Link
                            to={`/admin/orders/${order.id}`}
                            className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {order.orderNumber}
                          </Link>
                          <span className="mt-0.5 block text-xs text-muted-foreground">#{order.id}</span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="block max-w-[13rem] truncate">
                            {order.user?.name ?? "Unknown customer"}
                          </span>
                          <span className="block max-w-[13rem] truncate text-xs text-muted-foreground">
                            {order.user?.email ?? "—"}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">{formatDateTime(order.createdAt)}</td>
                        <td className="px-3 py-3 tabular-nums">
                          {itemCount} item{itemCount === 1 ? "" : "s"}
                        </td>
                        <td className="px-3 py-3 text-right font-medium tabular-nums">
                          {formatPrice(order.grandTotal)}
                        </td>
                        <td className="px-3 py-3">
                          <OrderStatusBadge status={order.status} />
                        </td>
                        <td className="px-3 py-3 text-right">
                          <Button asChild variant="ghost" size="sm">
                            <Link to={`/admin/orders/${order.id}`}>View</Link>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <ul className="space-y-3 md:hidden">
            {orders.map((order) => {
              const itemCount = order.items.reduce((sum, item) => sum + item.qty, 0);
              return (
                <li key={order.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link
                        to={`/admin/orders/${order.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {order.orderNumber}
                      </Link>
                      <p className="text-xs text-muted-foreground">{formatDateTime(order.createdAt)}</p>
                    </div>
                    <OrderStatusBadge status={order.status} />
                  </div>
                  <div className="mt-2 text-sm">
                    <p className="truncate">{order.user?.name ?? "Unknown customer"}</p>
                    <p className="truncate text-xs text-muted-foreground">{order.user?.email ?? "—"}</p>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
                    <span className="text-xs text-muted-foreground">
                      {itemCount} item{itemCount === 1 ? "" : "s"}
                    </span>
                    <span className="font-semibold tabular-nums">{formatPrice(order.grandTotal)}</span>
                  </div>
                </li>
              );
            })}
          </ul>

          {pagination ? (
            <Pagination page={pagination.page} totalPages={pagination.totalPages} hrefFor={hrefFor} />
          ) : null}
        </>
      )}
    </>
  );
}
