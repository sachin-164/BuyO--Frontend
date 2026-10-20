import { useState } from "react";
import { ImageOff } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { discountPercent, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/catalog";

interface ProductCardProps {
  product: Product;
  className?: string;
}

export function ProductCard({ product, className }: ProductCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const discount = discountPercent(product.mrpPrice, product.sellingPrice);
  const hasImage = Boolean(product.image) && !imageFailed;
  const lowStock = product.stock > 0 && product.stock <= 5;

  return (
    <article className={cn("group h-full", className)}>
      <Link
        to={`/product/${encodeURIComponent(product.slug)}`}
        className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card transition-[border-color] duration-200 ease-out-strong hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <div className="relative aspect-square overflow-hidden bg-secondary">
          {hasImage ? (
            <img
              src={product.image ?? ""}
              alt={product.imageMeta?.alt || product.name}
              loading="lazy"
              decoding="async"
              className="size-full object-cover transition-transform duration-300 ease-out-strong group-hover:scale-[1.03]"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div
              className="flex size-full items-center justify-center text-muted-foreground"
              aria-hidden="true"
            >
              <ImageOff className="size-8" />
            </div>
          )}
          {discount !== null ? (
            <Badge variant="accent" className="absolute left-3 top-3">
              {discount}% off
            </Badge>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col gap-1 p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {product.category}
          </p>
          <h3 className="line-clamp-2 font-sans text-sm font-semibold leading-snug transition-colors group-hover:text-primary">
            {product.name}
          </h3>
          <div className="mt-auto flex items-baseline gap-2 pt-2">
            <span className="text-base font-semibold">
              {formatPrice(product.sellingPrice)}
            </span>
            {discount !== null ? (
              <s className="text-xs text-muted-foreground">
                {formatPrice(product.mrpPrice)}
              </s>
            ) : null}
          </div>
          {product.stock <= 0 ? (
            <p className="text-xs font-medium text-destructive">Out of stock</p>
          ) : lowStock ? (
            <p className="text-xs font-medium text-amber-700">
              Only {product.stock} left
            </p>
          ) : null}
        </div>
      </Link>
    </article>
  );
}
