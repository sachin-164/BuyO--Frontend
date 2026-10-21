import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import type { CartTaxGroup, CartTotals } from "@/types/commerce";

function TaxBreakdown({ groups }: { groups: CartTaxGroup[] }) {
  const active = groups.filter((group) => group.taxAmount > 0);
  if (active.length === 0) return null;

  return (
    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
      {active.map((group, index) => (
        <li key={`${group.categoryId ?? "none"}-${index}`}>
          {group.categoryName ?? "Uncategorised"} ({group.taxRate}%): {formatPrice(group.taxAmount)}
        </li>
      ))}
    </ul>
  );
}

interface OrderSummaryProps {
  totals: CartTotals;
  itemCount: number;
  totalsNotice?: string;
  className?: string;
}

export function OrderSummary({
  totals,
  itemCount,
  totalsNotice,
  className,
}: OrderSummaryProps) {
  return (
    <Card className={cn("lg:sticky lg:top-24", className)}>
      <CardHeader>
        <CardTitle>Order summary</CardTitle>
        <p className="text-sm text-muted-foreground">
          {itemCount === 1 ? "1 item" : `${itemCount} items`} · Cash on delivery
        </p>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-6">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="font-medium">{formatPrice(totals.subtotal)}</dd>
          </div>
          <div className="flex items-start justify-between gap-6">
            <dt className="text-muted-foreground">Applicable GST (preview)</dt>
            <dd className="text-right font-medium">
              {formatPrice(totals.tax.total)}
              <TaxBreakdown groups={totals.tax.byCategory ?? []} />
            </dd>
          </div>
          <div className="mt-3 flex items-center justify-between gap-6 border-t border-border pt-3">
            <dt className="font-semibold">Total</dt>
            <dd className="text-lg font-semibold">{formatPrice(totals.grandTotal)}</dd>
          </div>
        </dl>
        {totalsNotice ? (
          <p className="mt-4 rounded-md border border-primary/15 bg-primary/5 p-3 text-xs text-muted-foreground">
            {totalsNotice}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
