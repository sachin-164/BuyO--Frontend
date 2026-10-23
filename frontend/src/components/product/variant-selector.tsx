import { useMemo } from "react";
import { Field } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import type { ProductVariant } from "@/types/catalog";

interface VariantSelectorProps {
  variants: ProductVariant[];
  selected: ProductVariant | null;
  onChange: (variant: ProductVariant | null) => void;
  disabled?: boolean;
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

/**
 * Controlled size/colour selector over the real active variants returned by
 * the API. It never fabricates an option: every selectable combination maps to
 * an existing variant id and SKU.
 */
export function VariantSelector({
  variants,
  selected,
  onChange,
  disabled = false,
}: VariantSelectorProps) {
  const sizes = useMemo(() => unique(variants.map((variant) => variant.size)), [variants]);
  const colors = useMemo(() => unique(variants.map((variant) => variant.color)), [variants]);

  function pick(nextSize: string | null, nextColor: string | null) {
    const exact = variants.find(
      (variant) =>
        (nextSize === null || (variant.size ?? null) === nextSize) &&
        (nextColor === null || (variant.color ?? null) === nextColor),
    );
    const bySize = nextSize ? variants.find((variant) => variant.size === nextSize) : null;
    const byColor = nextColor ? variants.find((variant) => variant.color === nextColor) : null;
    onChange(exact ?? bySize ?? byColor ?? variants[0] ?? null);
  }

  if (variants.length === 0) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No size or colour is currently available for this product.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {sizes.length > 0 ? (
        <Field id="variant-size" label="Size">
          {() => (
            <Select
              id="variant-size"
              value={selected?.size ?? ""}
              disabled={disabled}
              onChange={(event) => pick(event.target.value || null, selected?.color ?? null)}
            >
              <option value="">Choose a size</option>
              {sizes.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}

      {colors.length > 0 ? (
        <Field id="variant-color" label="Colour">
          {() => (
            <Select
              id="variant-color"
              value={selected?.color ?? ""}
              disabled={disabled}
              onChange={(event) => pick(selected?.size ?? null, event.target.value || null)}
            >
              <option value="">Choose a colour</option>
              {colors.map((color) => (
                <option key={color} value={color}>
                  {color}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
    </div>
  );
}
