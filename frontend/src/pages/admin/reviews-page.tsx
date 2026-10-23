import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, MessageSquare, Search, X } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminQueryError } from "@/components/admin/admin-query-error";
import { AdminTableSkeleton } from "@/components/admin/admin-table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { useToast } from "@/components/ui/toast";
import { useModerateReview } from "@/features/admin/mutations";
import { useAdminReviews } from "@/features/admin/queries";
import { usePageTitle } from "@/hooks/use-page-title";
import { getErrorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import type { AdminReview, ReviewStatus } from "@/types/reviews";

const TABS: Array<{ value: ReviewStatus | "all"; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

function StatusBadge({ status }: { status: ReviewStatus }) {
  return (
    <Badge
      variant={status === "approved" ? "success" : status === "rejected" ? "destructive" : "accent"}
    >
      {status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Pending"}
    </Badge>
  );
}

interface PendingDecision {
  review: AdminReview;
  status: "approved" | "rejected";
}

export default function AdminReviewsPage() {
  usePageTitle("Review moderation");
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const statusParam = params.get("status");
  const status: ReviewStatus | "all" =
    statusParam === "approved" || statusParam === "rejected" || statusParam === "all"
      ? statusParam
      : "pending";
  const q = params.get("q") ?? "";
  const page = Number(params.get("page")) || 1;
  const [search, setSearch] = useState(q);
  const [decision, setDecision] = useState<PendingDecision | null>(null);

  useEffect(() => setSearch(q), [q]);

  const reviewsQuery = useAdminReviews({ status, q, page });
  const moderate = useModerateReview();

  function updateParams(next: { status?: ReviewStatus | "all"; q?: string; page?: number }) {
    const merged = new URLSearchParams(params);
    const nextStatus = next.status ?? status;
    if (nextStatus === "pending") merged.delete("status");
    else merged.set("status", nextStatus);

    if (next.status !== undefined || next.q !== undefined) merged.delete("page");
    if (next.page && next.page > 1) merged.set("page", String(next.page));
    else if (next.page !== undefined) merged.delete("page");

    if (next.q !== undefined) {
      const term = next.q.trim();
      if (term) merged.set("q", term);
      else merged.delete("q");
    }
    setParams(merged, { replace: true });
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateParams({ q: search, page: 1 });
  }

  /** Pagination renders links, so preserve the active filters in the URL. */
  function hrefForPage(next: number) {
    const merged = new URLSearchParams(params);
    if (next > 1) merged.set("page", String(next));
    else merged.delete("page");
    const suffix = merged.toString();
    return `/admin/reviews${suffix ? `?${suffix}` : ""}`;
  }

  function confirmDecision() {
    if (!decision) return;
    moderate.mutate(
      { id: decision.review.id, status: decision.status },
      {
        onSuccess: (data) => {
          toast({
            tone: "success",
            title: data.unchanged ? "No change needed" : data.message,
            description: data.unchanged
              ? "This review already had that moderation status."
              : "Public reviews and the rating summary have been refreshed.",
          });
          setDecision(null);
        },
        onError: (error) => {
          setDecision(null);
          toast({
            tone: "error",
            title: "Could not update the review",
            description: getErrorMessage(error),
          });
        },
      },
    );
  }

  const counts = reviewsQuery.data?.statusCounts;

  return (
    <>
      <AdminPageHeader
        title="Review moderation"
        description="Approve or reject customer reviews. Only approved reviews are public or counted in product ratings."
        breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Reviews" }]}
      />

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((tab) => (
          <Button
            key={tab.value}
            type="button"
            size="sm"
            variant={status === tab.value ? "default" : "outline"}
            onClick={() => updateParams({ status: tab.value, page: 1 })}
          >
            {tab.label}
            {tab.value !== "all" && counts ? (
              <span className="ml-1 tabular-nums text-xs opacity-80">
                {counts[tab.value]}
              </span>
            ) : null}
          </Button>
        ))}
      </div>

      <form onSubmit={submitSearch} className="mt-4 flex flex-wrap gap-2" role="search">
        <label htmlFor="review-search" className="sr-only">
          Search reviews
        </label>
        <Input
          id="review-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search review text, product or customer"
          className="max-w-sm"
        />
        <Button type="submit" variant="outline">
          <Search aria-hidden="true" />
          Search
        </Button>
        {q ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSearch("");
              updateParams({ q: "", page: 1 });
            }}
          >
            Clear
          </Button>
        ) : null}
      </form>

      <div className="mt-6">
        {reviewsQuery.isPending ? (
          <AdminTableSkeleton rows={5} />
        ) : reviewsQuery.isError ? (
          <AdminQueryError
            error={reviewsQuery.error}
            title="Couldn't load reviews"
            onRetry={() => void reviewsQuery.refetch()}
          />
        ) : reviewsQuery.data && reviewsQuery.data.reviews.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title={q ? "No matching reviews" : `No ${status === "all" ? "" : status} reviews`}
            description={
              q
                ? "Try a different search term or clear the filter."
                : "New customer reviews arrive here as pending. Nothing is published until you approve it."
            }
          />
        ) : (
          <div className="space-y-3">
            {reviewsQuery.data?.reviews.map((review) => (
              <Card key={review.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="text-sm font-semibold"
                          aria-label={`${review.rating} out of 5 stars`}
                        >
                          {review.rating}★
                        </span>
                        <StatusBadge status={review.status} />
                        {review.title ? (
                          <span className="text-sm font-medium">{review.title}</span>
                        ) : null}
                      </div>
                      <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
                        {review.body}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {review.status !== "approved" ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => setDecision({ review, status: "approved" })}
                          disabled={moderate.isPending}
                        >
                          <Check aria-hidden="true" />
                          Approve
                        </Button>
                      ) : null}
                      {review.status !== "rejected" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setDecision({ review, status: "rejected" })}
                          disabled={moderate.isPending}
                        >
                          <X aria-hidden="true" />
                          Reject
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                    <span>
                      Customer:{" "}
                      {review.customer ? (
                        <>
                          <span className="text-foreground">{review.customer.name}</span>{" "}
                          <span className="break-all">{review.customer.email}</span>
                        </>
                      ) : (
                        "Unknown"
                      )}
                    </span>
                    <span>
                      Product:{" "}
                      {review.product ? (
                        <Link
                          to={`/product/${review.product.slug}`}
                          className="text-primary hover:underline"
                        >
                          {review.product.name}
                        </Link>
                      ) : (
                        "Deleted product"
                      )}
                    </span>
                    <span>Submitted {formatDateTime(review.createdAt)}</span>
                    {review.moderatedAt ? (
                      <span>
                        Moderated {formatDateTime(review.moderatedAt)}
                        {review.moderatedBy ? ` by #${review.moderatedBy}` : ""}
                      </span>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}

            {reviewsQuery.data ? (
              <Pagination
                page={reviewsQuery.data.pagination.page}
                totalPages={reviewsQuery.data.pagination.totalPages}
                hrefFor={hrefForPage}
              />
            ) : null}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={decision !== null}
        onOpenChange={(open) => {
          if (!open && !moderate.isPending) setDecision(null);
        }}
        tone={decision?.status === "rejected" ? "destructive" : "default"}
        title={decision?.status === "approved" ? "Publish this review?" : "Reject this review?"}
        description={
          decision?.status === "approved"
            ? "It will appear publicly and count toward the product's rating immediately."
            : "It will be removed from public view and the rating summary immediately. You can approve it later."
        }
        confirmLabel={decision?.status === "approved" ? "Approve" : "Reject"}
        isPending={moderate.isPending}
        onConfirm={confirmDecision}
      />
    </>
  );
}
