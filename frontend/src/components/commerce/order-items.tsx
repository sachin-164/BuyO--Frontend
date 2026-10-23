import { ImageOff } from "lucide-react";
import { Link } from "react-router-dom";
import { formatPrice } from "@/lib/format";
import { variantLabel } from "@/lib/variant";
import type { OrderItem } from "@/types/commerce";

interface OrderItemsProps {
  items: OrderItem[];
  showTax?: boolean;
}

export function OrderItems({ items, showTax = false }: OrderItemsProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-full text-sm">
        <thead>
          <tr className="sr-only">
            <th scope="col">Product</th>
            <th scope="col">Quantity</th>
            <th scope="col">Unit price</th>
            <th scope="col">Line total</th>
            {showTax ? <th scope="col">GST per line</th> : null}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const productHref = item.productId ? `/product/${item.productId}` : null;
            const options = variantLabel({
              sku: item.variantSku,
              size: item.variantSize,
              color: item.variantColor,
            });
            const content = (
              <div className="flex min-w-0 items-center gap-3">
                {item.image !== undefined ? (
                  <span
                    className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-secondary"
                    aria-hidden="true"
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
                      <ImageOff className="size-4 text-muted-foreground" />
                    )}
                  </span>
                ) : null}
                <span className="min-w-0">
                  <span className="block font-medium">
                    {productHref ? (
                      <Link to={productHref} className="hover:text-primary">
                        {item.name}
                      </Link>
                    ) : (
                      item.name
                    )}
                  </span>
                  {options ? (
                    <span className="block text-xs text-muted-foreground">{options}</span>
                  ) : null}
                  {item.variantSku ? (
                    <span className="block text-[0.7rem] text-muted-foreground">
                      SKU {item.variantSku}
                    </span>
                  ) : null}
                  {showTax && item.categoryName ? (
                    <span className="block text-xs text-muted-foreground">{item.categoryName}</span>
                  ) : null}
                </span>
              </div>
            );

            return (
              <tr key={item.id} className="border-b border-border/70 last:border-0">
                <td className="py-3 pr-3">{content}</td>
                <td className="px-3 py-3 text-muted-foreground">{item.qty}</td>
                <td className="px-3 py-3 text-muted-foreground">{formatPrice(item.unitPrice)}</td>
                <td className="py-3 pl-3 text-right font-medium">{formatPrice(item.lineTotal)}</td>
                {showTax ? (
                  <td className="py-3 pl-3 text-right text-muted-foreground">
                    {formatPrice(item.taxAmount ?? 0)}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
