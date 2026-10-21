import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Heart,
  ImageOff,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import {
  useAddToCartFromWishlist,
  useRemoveWishlistItem,
} from "@/features/wishlist/mutations";
import { usePageTitle } from "@/hooks/use-page-title";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useWishlist } from "@/features/wishlist/queries";
import { getErrorMessage } from "@/lib/errors";
import { formatPrice } from "@/lib/format";
import type { WishlistItem } from "@/types/commerce";

function WishlistCard({
  item,
  onRemove,
  onAddToCart,
  removeFromCartPending,
  removePending,
  addToCartPending,
}: {
  item: WishlistItem;
  onRemove: (item: WishlistItem) => void;
  onAddToCart: (item: WishlistItem) => void;
  removeFromCartPending: boolean;
  removePending: boolean;
  addToCartPending: boolean;
}) {
  const savedProductsHref = item.productId ? `/product/${item.productId}` : null;

  return (
    <Card key={item.id} className="flex h-full flex-col">
      <CardContent className="flex flex-1 flex-col gap-4 p-4 sm:flex-row sm:p-5">
        {savedProductsHref ? (
          <Link
            to={savedProductsHref}
            className="block size-20 shrink-0 overflow-hidden rounded-lg border border-border bg-secondary sm:size-24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label={`Open ${item.name}`}
          >
            {item.image ? (
              <img
                src={item.image}
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
        ) : (
          <span
            className="flex size-20 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground sm:size-24"
            aria-hidden="true"
          >
            <ImageOff className="size-7" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">
              {savedProductsHref ? (
                <Link to={savedProductsHref} className="hover:text-primary">
                  {item.name || "Unavailable product"}
                </Link>
              ) : (
                item.name || "Unavailable product"
              )}
            </h2>
            {item.price !== null ? (
              <p className="text-base font-semibold">{formatPrice(item.price)}</p>
            ) : (
              <Badge variant="destructive">Unavailable</Badge>
            )}
          </div>

          {item.unavailable ? (
            <p className="mt-1 text-sm text-muted-foreground">
              The linked product is no longer available. You can remove this saved row, but the API
              cannot remove a null productId.
            </p>
          ) : item.inStock ? (
            <Badge variant="success">In stock</Badge>
          ) : (
            <Badge variant="accent">Out of stock</Badge>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={item.unavailable || !item.inStock || addToCartPending}
              onClick={() => onAddToCart(item)}
            >
              <ShoppingBag aria-hidden="true" />
              Add to cart
            </Button>
            {item.productId ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={removePending || removeFromCartPending}
                onClick={() => onRemove(item)}
              >
                <Trash2 aria-hidden="true" />
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function WishlistPage() {
  usePageTitle("Your wishlist");
  const wishlistQuery = useWishlist();
  const removeFromWishlist = useRemoveWishlistItem();
  const addToCart = useAddToCartFromWishlist();
  const toast = useToast();
  const [removeTarget, setRemoveTarget] = useState<WishlistItem | null>(null);
  const mutationInFlight = useRef(false);

  const wishlist = wishlistQuery.data;

  async function handleAddToCart(item: WishlistItem) {
    if (!item.productId || mutationInFlight.current) return;
    mutationInFlight.current = true;
    try {
      await addToCart.mutateAsync({ productId: item.productId });
      toast({
        tone: "success",
        title: "Added to cart",
        description: `${item.name} was added with quantity 1.`,
      });
      setRemoveTarget(null);
    } catch (error) {
      toast({ tone: "error", title: "Could not add to cart", description: getErrorMessage(error) });
    } finally {
      mutationInFlight.current = false;
    }
  }

  async function handleRemove() {
    if (!removeTarget?.productId || mutationInFlight.current) return;
    mutationInFlight.current = true;
    try {
      await removeFromWishlist.mutateAsync(removeTarget.productId);
      toast({
        tone: "success",
        title: "Removed from wishlist",
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
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Saved products
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Your wishlist</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {wishlist?.count !== undefined
            ? `${wishlist.count} saved ${wishlist.count === 1 ? "product" : "products"}`
            : "Loading your wishlist"}
        </p>
      </header>

      {wishlistQuery.isLoading ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2" aria-busy="true">
          {Array.from({ length: 2 }).map((_, index) => (
            <Skeleton key={index} className="h-36 rounded-lg sm:h-40" />
          ))}
        </div>
      ) : null}

      {wishlistQuery.isError && !wishlistQuery.isPending ? (
        <Alert variant="destructive" className="mt-8">
          <Heart aria-hidden="true" />
          <AlertTitle>Your wishlist could not be loaded</AlertTitle>
          <AlertDescription>{getErrorMessage(wishlistQuery.error)}</AlertDescription>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => void wishlistQuery.refetch()}
          >
            Try again
          </Button>
        </Alert>
      ) : null}

      {wishlistQuery.isSuccess && wishlist?.items.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={Heart}
          title="Your wishlist is empty"
          description="Save products from the storefront to find them again later."
          action={
            <Button asChild>
              <Link to="/shop">Browse products</Link>
            </Button>
          }
        />
      ) : null}

      {wishlistQuery.isSuccess && wishlist && wishlist.items.length > 0 ? (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {wishlist.items.map((item) => (
            <li key={item.id} className="h-full">
              <WishlistCard
                item={item}
                onRemove={setRemoveTarget}
                onAddToCart={(cartItem) => void handleAddToCart(cartItem)}
                removeFromCartPending={Boolean(removeTarget && removeTarget.id === item.id && removeFromWishlist.isPending)}
                removePending={removeFromWishlist.isPending}
                addToCartPending={addToCart.isPending}
              />
            </li>
          ))}
        </ul>
      ) : null}

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        tone="destructive"
        title="Remove saved product?"
        description={`This removes ${removeTarget?.name ?? "the selected product"} from your wishlist.`}
        confirmLabel="Remove"
        isPending={removeFromWishlist.isPending}
        onConfirm={() => void handleRemove()}
      />
    </div>
  );
}
