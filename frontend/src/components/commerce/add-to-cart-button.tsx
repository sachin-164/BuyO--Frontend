import { useLocation, useNavigate } from "react-router-dom";
import { ShoppingBag } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useAddToCart } from "@/features/cart/mutations";
import { loginHref } from "@/lib/auth-return";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/features/auth/auth-context";
import type { Product } from "@/types/catalog";
import { cn } from "@/lib/utils";

interface AddToCartButtonProps extends Omit<ButtonProps, "disabled"> {
  product: Product;
  qty?: number;
}

/**
 * Quick cart action used on product cards. Guests are sent to sign-in with a
 * return-to path; the server remains authoritative about stock and limits.
 */
export function AddToCartButton({
  product,
  qty = 1,
  className,
  children,
  ...props
}: AddToCartButtonProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { hasToken } = useAuth();
  const addToCart = useAddToCart();
  const disabled = product.stock <= 0 || addToCart.isPending;
  const currentPath = `${location.pathname}${location.search}`;

  function handleClick() {
    if (disabled) return;
    if (!hasToken) {
      toast({
        tone: "info",
        title: "Sign in to use your cart",
        description: "Server-backed carts are tied to a BuyO account.",
      });
      navigate(loginHref(currentPath));
      return;
    }

    addToCart.mutate(
      { productId: product.id, qty },
      {
        onSuccess: () => {
          toast({
            tone: "success",
            title: `Added ${qty} × ${product.name} to your cart`,
            description: "Stock and totals are confirmed at checkout.",
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
