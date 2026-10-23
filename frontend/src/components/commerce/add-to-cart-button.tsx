import { ShoppingBag } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useAddToCart } from "@/features/cart/mutations";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/features/auth/auth-context";
import type { Product } from "@/types/catalog";
import { cn } from "@/lib/utils";

interface AddToCartButtonProps extends Omit<ButtonProps, "disabled"> {
  product: Product;
  qty?: number;
}

/**
 * Quick cart action used on product cards. Guests get a localStorage cart
 * immediately (merged into their account on sign-in) instead of being sent
 * away from the product they were looking at.
 */
export function AddToCartButton({
  product,
  qty = 1,
  className,
  children,
  ...props
}: AddToCartButtonProps) {
  const toast = useToast();
  const { hasToken } = useAuth();
  const addToCart = useAddToCart();
  const disabled = product.stock <= 0 || addToCart.isPending;

  // A variant-managed product cannot be added from a card: the buyer must
  // choose a real size/colour on the product page. Never invent a variant.
  if (product.hasVariants) {
    return (
      <Button asChild className={cn("min-w-36", className)} variant="secondary" size="sm">
        <Link to={`/product/${encodeURIComponent(product.slug)}`}>
          <ShoppingBag aria-hidden="true" />
          Choose options
        </Link>
      </Button>
    );
  }

  function handleClick() {
    if (disabled) return;

    addToCart.mutate(
      { productId: product.id, qty, product },
      {
        onSuccess: () => {
          toast({
            tone: "success",
            title: `Added ${qty} × ${product.name} to your cart`,
            description: hasToken
              ? "Stock and totals are confirmed at checkout."
              : "Saved in this browser — sign in to check out.",
          });
        },
        onError: (error) => {
          toast({ tone: "error", title: "Could not add to cart", description: getErrorMessage(error) });
        },
      },
    );
  }

  return (
    <Button
      type="button"
      className={cn("min-w-36", className)}
      onClick={handleClick}
      disabled={disabled}
      isLoading={addToCart.isPending}
      aria-label={`Add ${product.name} to cart`}
      {...props}
    >
      <ShoppingBag aria-hidden="true" />
      {children ?? (product.stock <= 0 ? "Out of stock" : "Add to cart")}
    </Button>
  );
}
