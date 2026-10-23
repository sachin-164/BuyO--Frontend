interface VariantLike {
  sku?: string | null;
  size?: string | null;
  color?: string | null;
}

/** Human-readable option summary, e.g. "Size M · Colour Black". */
export function variantLabel(
  variant: VariantLike | null | undefined,
  { includeSku = false }: { includeSku?: boolean } = {},
): string | null {
  if (!variant) return null;
  const parts: string[] = [];
  if (variant.size) parts.push(`Size ${variant.size}`);
  if (variant.color) parts.push(`Colour ${variant.color}`);
  if (includeSku && variant.sku) parts.push(`SKU ${variant.sku}`);
  return parts.length ? parts.join(" · ") : null;
}

export function cartVariantLabel(item: {
  variant?: { size: string | null; color: string | null; sku?: string } | null;
}): string | null {
  return variantLabel(item.variant);
}
