import { CircleAlert, CircleCheck, PackageSearch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import type { OrderStatus, OrderStatusEvent } from "@/types/commerce";

const STATUS_TONES: Record<OrderStatus, "success" | "destructive" | "secondary" | "default"> = {
  placed: "default",
  confirmed: "secondary",
  shipped: "secondary",
  delivered: "success",
  cancelled: "destructive",
};

const STATUS_LABELS: Record<OrderStatus, string> = {
  placed: "Placed",
  confirmed: "Confirmed",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge variant={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}

/** Real history only; no invented future steps or carrier data. */
export function OrderStatusTimeline({ events }: { events: OrderStatusEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
        <PackageSearch className="mb-1 size-4 text-primary" aria-hidden="true" />
        No status events have been recorded yet beyond current status.
      </div>
    );
  }

  return (
    <ol className="space-y-3">
      {events.map((event) => {
        const first = event.fromStatus === null;
        const produced = STATUS_LABELS[event.toStatus];
        const cancellation = event.toStatus === "cancelled";
        return (
          <li
            key={event.id}
            className="flex items-start gap-3 rounded-md border border-border bg-card p-3"
          >
            {cancellation ? (
              <CircleAlert className="mt-0.5 size-4 text-destructive" aria-hidden="true" />
            ) : (
              <CircleCheck className="mt-0.5 size-4 text-primary" aria-hidden="true" />
            )}
            <div>
              <p className="text-sm font-medium">
                {first ? "Order placed" : `Status moved from ${STATUS_LABELS[event.fromStatus as OrderStatus]} to ${produced}`}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</p>
              {event.note ? (
                <p className="mt-1 text-sm text-muted-foreground">{event.note}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
