import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { RefreshCw, Users } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminQueryError } from "@/components/admin/admin-query-error";
import { AdminTableSkeleton } from "@/components/admin/admin-table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { useAdminCustomers } from "@/features/admin/queries";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDate, formatDateTime, formatPrice } from "@/lib/format";
import { usePageTitle } from "@/hooks/use-page-title";

function parsePage(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export default function AdminCustomersPage() {
  usePageTitle("Customers");
  const [searchParams, setSearchParams] = useSearchParams();
  const page = parsePage(searchParams.get("page"));
  const urlQuery = searchParams.get("q") ?? "";
  const [term, setTerm] = useState(urlQuery);
  const debouncedTerm = useDebouncedValue(term, 300);

  // Keep the URL in sync with the debounced term so the view stays
  // deep-linkable and back/forward safe. `replace` avoids one history entry
  // per keystroke.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (debouncedTerm.trim()) next.set("q", debouncedTerm.trim());
    else next.delete("q");
    // Any search change resets pagination.
    if (debouncedTerm.trim() !== urlQuery) next.delete("page");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedTerm]);

  const customersQuery = useAdminCustomers({ page, q: debouncedTerm });

  function hrefFor(nextPage: number) {
    const next = new URLSearchParams();
    if (debouncedTerm.trim()) next.set("q", debouncedTerm.trim());
    if (nextPage > 1) next.set("page", String(nextPage));
    const search = next.toString();
    return search ? `/admin/customers?${search}` : "/admin/customers";
  }

  const data = customersQuery.data;
  const customers = data?.customers ?? [];
  const pagination = data?.pagination;
  const searching = debouncedTerm.trim() !== "";

  return (
    <>
      <AdminPageHeader
        title="Customers"
        description="Every registered customer with server-computed order counts and spend. Customer records never include credential fields."
        breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Customers" }]}
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => void customersQuery.refetch()}
            disabled={customersQuery.isFetching}
          >
            <RefreshCw className={customersQuery.isFetching ? "animate-spin" : undefined} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      <Card className="mb-6 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field id="customer-search" label="Search" className="w-full sm:w-80">
            <Input
              id="customer-search"
              type="search"
              value={term}
              placeholder="Name or email"
              autoComplete="off"
              onChange={(event) => setTerm(event.target.value)}
            />
          </Field>
          {searching ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setTerm("");
                setSearchParams(new URLSearchParams(), { replace: true });
              }}
            >
              Reset search
            </Button>
          ) : null}
          <p className="pb-2 text-xs text-muted-foreground" aria-live="polite">
            {customersQuery.isFetching && !customersQuery.isPending
              ? "Searching…"
              : searching
                ? "Matching name or email, case-insensitive."
                : "Newest customers first."}
          </p>
        </div>
      </Card>

      {customersQuery.isPending ? (
        <AdminTableSkeleton rows={6} columns={6} />
      ) : customersQuery.isError ? (
        <AdminQueryError
          error={customersQuery.error}
          title="Couldn't load customers"
          onRetry={() => void customersQuery.refetch()}
        />
      ) : customers.length === 0 ? (
        <EmptyState
          icon={Users}
          title={searching ? "No customers match that search" : "No customers yet"}
          description={
            searching
              ? "Try a shorter term, or clear the search to see every registered customer."
              : "Customers appear here after they sign up and verify their email."
          }
          action={
            searching ? (
              <Button type="button" variant="outline" onClick={() => setTerm("")}>
                Clear search
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <p aria-live="polite">
              {pagination?.total.toLocaleString("en-IN") ?? customers.length} customer
              {(pagination?.total ?? customers.length) === 1 ? "" : "s"}
              {searching ? ` matching “${debouncedTerm.trim()}”` : ""}
            </p>
          </div>

          <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-sm">
                <caption className="sr-only">Customers, newest first</caption>
                <thead>
                  <tr className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-3 py-3 font-medium">Customer</th>
                    <th scope="col" className="px-3 py-3 font-medium">Joined</th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">Orders</th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">Spend</th>
                    <th scope="col" className="px-3 py-3 font-medium">Last order</th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {customers.map((customer) => (
                    <tr key={customer.id} className="transition-colors hover:bg-secondary/30">
                      <td className="px-3 py-3">
                        <span className="block max-w-[16rem] truncate font-medium">{customer.name}</span>
                        <span className="block max-w-[16rem] truncate text-xs text-muted-foreground">
                          {customer.email}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{formatDate(customer.createdAt)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {customer.orderCount}
                        {customer.cancelledCount > 0 ? (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({customer.cancelledCount} cancelled)
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums">
                        {formatPrice(customer.totalSpend)}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {customer.lastOrderAt ? formatDateTime(customer.lastOrderAt) : "—"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link to={`/admin/customers/${customer.id}`}>View</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <ul className="space-y-3 md:hidden">
            {customers.map((customer) => (
              <li key={customer.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{customer.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{customer.email}</p>
                  </div>
                  <Badge variant="outline">{customer.orderCount} orders</Badge>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-sm">
                  <span className="text-muted-foreground">{formatPrice(customer.totalSpend)} spent</span>
                  <Button asChild variant="ghost" size="sm">
                    <Link to={`/admin/customers/${customer.id}`}>View</Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          {pagination ? (
            <Pagination page={pagination.page} totalPages={pagination.totalPages} hrefFor={hrefFor} />
          ) : null}
        </>
      )}
    </>
  );
}
