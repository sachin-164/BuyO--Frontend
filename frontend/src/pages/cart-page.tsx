import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  CircleAlert,
  ImageOff,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { OrderSummary } from "@/components/commerce/order-summary";
import { QuantitySelector } from "@/components/product/quantity-selector";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useCart } from "@/features/cart/queries";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  useRemoveCartItem,
  useUpdateCartItem,
} from "@/features/cart/mutations";
import { getErrorMessage } from "@/lib/errors";
import { formatPrice } from "@/lib/format";
import type { CartItem } from "@/types/commerce";

function CartLineSkeleton() {
  return (
    <Card className="animate-pulse" aria-hidden="true">
      <CardContent className="flex gap-4 p-4">
        <Skeleton className="aspect-square size-20 sm:size-24" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-8 w-36" />
        </div>
      </CardContent>
    </Card>
  );
}

function CartLine({
  item,
  index,
  onUpdate,
  onRemove,
  pending,
}: {
  item: CartItem;
  index: number;
  onUpdate: (id: number, qty: number) => void;
  onRemove: (item: CartItem) => void;
  pending: boolean;
}) {
  const productHref = item.productId ? `/product/${item.productId}` : null;
  const hasImage = Boolean(item.image);
  const quantitySelectable = !item.unavailable && item.stock !== null;
  const maxQty = Math.max(
    1,
    Math.min(99, item.stock !== null ? item.stock : 99),
  );
  const stockWarning =
    item.unavailable
      ? "No longer available"
      : item.stockExceeded && item.stock !== null
        ? `Only ${item.stock} in stock`
        : item.stock === 0
          ? "Out of stock"
          : null;

  return (
    <Card key={item.id}>
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:p-5">
        <Link
          to={productHref ?? "/shop"}
          className="block size-20 shrink-0 overflow-hidden rounded-lg border border-border bg-secondary sm:size-24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={productHref ? `Open ${item.name}` : "Browse products"}
        >
          {hasImage ? (
            <img
              src={item.image ?? ""}
              alt=""
              className="size-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span
              className="flex size-full items-center justify-center text-muted-foreground"
              aria-hidden="true"
            >
              <ImageOff className="size-7" />
            </span>
          )}
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">
              <Link to={productHref ?? "/shop"} className="hover:text-primary">
                {item.name || "Unavailable item"}
              </Link>
            </h2>
            <p className="text-base font-semibold">{formatPrice(item.lineTotal)}</p>
          </div>

          {item.price !== null ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {formatPrice(item.price)} each
            </p>
          ) : null}

          {stockWarning ? (
            <Alert variant="warning" className="mt-3">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>{stockWarning}</AlertTitle>
              <AlertDescription>
                {item.unavailable
                  ? "Remove this line or wait for the seller to restock."
                  : "Reduce the quantity below the available stock."}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
            {quantitySelectable ? (
              <QuantitySelector
                id={`cart-qty-${index}`}
                value={item.qty}
                min={1}
                max={Math.max(item.qty, maxQty)}
                disabled={pending}
                onChange={(quantity) => onUpdate(item.id, quantity)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Quantity: {item.qty}</p>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={pending}
              onClick={() => onRemove(item)}
            >
              <Trash2 aria-hidden="true" />
              Remove
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CartPage() {
  usePageTitle("Your cart");
  const cartQuery = useCart();
  const updateCart = useUpdateCartItem();
  const removeCart = useRemoveCartItem();
  const toast = useToast();
  const [removeTarget, setRemoveTarget] = useState<CartItem | null>(null);
  const mutationInFlight = useRef(false);

  const cart = cartQuery.data;
  const pending = updateCart.isPending || removeCart.isPending;
  const stockProblem = Boolean(
    cart?.items.some((item) => !item.unavailable && item.stockExceeded) ?? false,
  );
  const unavailableItems = cart?.items.filter((item) => item.unavailable).length ?? 0;

  async function handleUpdate(id: number, qty: number) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    try {
      await updateCart.mutateAsync({ id, qty });
      toast({ tone: "success", title: "Quantity updated" });
    } catch (error) {
      toast({ tone: "error", title: "Could not update quantity", description: getErrorMessage(error) });
    } finally {
      mutationInFlight.current = false;
    }
  }

  async function handleRemove() {
    if (!removeTarget || mutationInFlight.current) return;
    mutationInFlight.current = true;
    try {
      await removeCart.mutateAsync(removeTarget.id);
      toast({
        tone: "success",
        title: "Removed from cart",
        description: removeTarget.name,
      });
      setRemoveTarget(null);
    } catch (error) {
      toast({ tone: "error", title: "Could not remove item", description: getErrorMessage(error) });
      setRemoveTarget(null);
    } finally {
      mutationInFlight.current = false;
    }
  }

  return (
    <div className="container-page py-8 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Shopping bag
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Your cart</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {cart?.count !== undefined
              ? `${cart.count} ${cart.count === 1 ? "line" : "lines"}`
              : "Loading your cart"}
          </p>
        </div>
      </header>

      {cartQuery.isLoading ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-[2fr,1fr]" aria-busy="true">
          <div className="space-y-4">
            {Array.from({ length: 2 }).map((_, index) => (
              <CartLineSkeleton key={index} />
            ))}
          </div>
          <Skeleton className="h-64 rounded-lg" />
        </div>
      ) : null}

      {cartQuery.isError && !cartQuery.isPending ? (
        <Alert variant="destructive" className="mt-8">
          <ShoppingBag aria-hidden="true" />
          <AlertTitle>Your cart could not be loaded</AlertTitle>
          <AlertDescription>{getErrorMessage(cartQuery.error)}</AlertDescription>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => void cartQuery.refetch()}
          >
            Try again
          </Button>
        </Alert>
      ) : null}

      {cartQuery.isSuccess && cart && cart.items.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={ShoppingBag}
          title="Your cart is empty"
          description="Add products from the storefront to continue with cash-on-delivery checkout."
          action={
            <Button asChild>
              <Link to="/shop">Browse products</Link>
            </Button>
          }
        />
      ) : null}

      {cartQuery.isSuccess && cart && cart.items.length > 0 ? (
        <div className="mt-8 grid gap-6 sm:grid-cols-[2fr,1fr] sm:items-start">
          <div className="space-y-4">
            {cart.items.map((item, index) => (
              <CartLine
                key={item.id}
                item={item}
                index={index}
                onUpdate={(id, qty) => void handleUpdate(id, qty)}
                onRemove={setRemoveTarget}
                pending={pending}
              />
            ))}
          </div>
          <div className="space-y-4">
            <OrderSummary
              totals={cart.totals}
              itemCount={cart.count}
              totalsNotice={cart.totalsNotice}
            />
            {unavailableItems > 0 ? (
              <Alert variant="warning">
                <CircleAlert aria-hidden="true" />
                <AlertTitle>Remove unavailable items</AlertTitle>
                <AlertDescription>
                  {unavailableItems} line{unavailableItems === 1 ? " is" : "s are"} no longer
                  available and cannot be ordered.
                </AlertDescription>
              </Alert>
            ) : null}
            {stockProblem ? (
              <Alert variant="warning">
                <CircleAlert aria-hidden="true" />
                <AlertTitle>Stock changed</AlertTitle>
                <AlertDescription>
                  Lower the quantities above before continuing.
                </AlertDescription>
              </Alert>
            ) : null}
            <Button
              asChild={!stockProblem && unavailableItems === 0}
              className="w-full"
              disabled={stockProblem || unavailableItems > 0 || pending}
              isLoading={pending}
            >
              {stockProblem || unavailableItems > 0 ? (
                <span>Resolve cart items</span>
              ) : (
                <Link to="/checkout">Proceed to checkout</Link>
              )}
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        tone="destructive"
        title="Remove this item?"
        description={`This removes ${removeTarget?.name ?? "the selected item"} from your cart.`}
        confirmLabel="Remove"
        isPending={removeCart.isPending}
        onConfirm={() => void handleRemove()}
      />
    </div>
  );
}
