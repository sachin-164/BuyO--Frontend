import { useState } from "react";
import { CircleAlert, Pencil, Plus, Power, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  useCreateVariant,
  useDeactivateVariant,
  useUpdateVariant,
} from "@/features/admin/mutations";
import { useAdminVariants } from "@/features/admin/queries";
import { getApiErrorDetails, getErrorMessage } from "@/lib/errors";
import { formatPrice } from "@/lib/format";
import { variantLabel } from "@/lib/variant";
import type { ProductVariant } from "@/types/catalog";

interface VariantEditorProps {
  productId: number;
  basePrice: number;
}

interface VariantForm {
  sku: string;
  size: string;
  color: string;
  stock: string;
  priceAdjustment: string;
  isActive: boolean;
}

const EMPTY_FORM: VariantForm = {
  sku: "",
  size: "",
  color: "",
  stock: "0",
  priceAdjustment: "0",
  isActive: true,
};

function formFromVariant(variant: ProductVariant): VariantForm {
  return {
    sku: variant.sku,
    size: variant.size ?? "",
    color: variant.color ?? "",
    stock: String(variant.stock),
    priceAdjustment: String(variant.priceAdjustment),
    isActive: variant.isActive,
  };
}

function validationMessage(error: unknown): string {
  const details = getApiErrorDetails<{ errors?: unknown; code?: string }>(error);
  if (details && Array.isArray(details.errors)) {
    const messages = details.errors.filter((entry): entry is string => typeof entry === "string");
    if (messages.length) return messages.join(" ");
  }
  if (details?.code === "DUPLICATE_SKU") {
    return "That SKU already belongs to another variant.";
  }
  return getErrorMessage(error);
}

export function VariantEditor({ productId, basePrice }: VariantEditorProps) {
  const toast = useToast();
  const variantsQuery = useAdminVariants(productId);
  const createVariant = useCreateVariant(productId);
  const updateVariant = useUpdateVariant(productId);
  const deactivateVariant = useDeactivateVariant(productId);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<VariantForm>(EMPTY_FORM);
  const [showAdd, setShowAdd] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<ProductVariant | null>(null);

  const variants = variantsQuery.data?.variants ?? [];
  const busy =
    createVariant.isPending || updateVariant.isPending || deactivateVariant.isPending;

  function resetForm() {
    setEditingId(null);
    setShowAdd(false);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  function startAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowAdd(true);
  }

  function startEdit(variant: ProductVariant) {
    setShowAdd(false);
    setEditingId(variant.id);
    setForm(formFromVariant(variant));
    setFormError(null);
  }

  function payload() {
    const stock = Number(form.stock);
    const priceAdjustment = Number(form.priceAdjustment);
    return {
      sku: form.sku.trim(),
      size: form.size.trim() || undefined,
      color: form.color.trim() || undefined,
      stock: Number.isFinite(stock) ? stock : 0,
      priceAdjustment: Number.isFinite(priceAdjustment) ? priceAdjustment : 0,
      isActive: form.isActive,
    };
  }

  function save() {
    setFormError(null);
    const body = payload();
    if (!body.sku) {
      setFormError("SKU is required.");
      return;
    }
    if (!body.size && !body.color) {
      setFormError("Add at least a size or a colour.");
      return;
    }
    if (basePrice + body.priceAdjustment <= 0) {
      setFormError("The final price must be greater than zero.");
      return;
    }

    const options = {
      onSuccess: () => {
        toast({
          tone: "success",
          title: editingId === null ? "Variant added" : "Variant updated",
          description: "Variant stock and the product's aggregate stock were updated.",
        });
        resetForm();
      },
      onError: (error: unknown) => setFormError(validationMessage(error)),
    };

    if (editingId === null) {
      createVariant.mutate(body, options);
    } else {
      updateVariant.mutate({ variantId: editingId, body }, options);
    }
  }

  function deactivate() {
    if (!deactivateTarget) return;
    deactivateVariant.mutate(deactivateTarget.id, {
      onSuccess: (data) => {
        toast({
          tone: "success",
          title: "Variant deactivated",
          description: `${deactivateTarget.sku} can no longer be purchased. Order history is unchanged.`,
        });
        setDeactivateTarget(null);
        if (editingId === deactivateTarget.id) resetForm();
        void data;
      },
      onError: (error) => {
        setDeactivateTarget(null);
        toast({
          tone: "error",
          title: "Could not deactivate variant",
          description: getErrorMessage(error),
        });
      },
    });
  }

  const formFields = (
    <div className="space-y-4 rounded-lg border border-border bg-secondary/30 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="variant-sku" label="SKU" required hint="Unique across the catalog.">
          {({ invalid, described }) => (
            <Input
              id="variant-sku"
              value={form.sku}
              aria-invalid={invalid}
              aria-describedby={described}
              onChange={(event) => setForm((current) => ({ ...current, sku: event.target.value }))}
              maxLength={64}
              autoComplete="off"
              placeholder="e.g. TEE-BLK-M"
            />
          )}
        </Field>
        <Field id="variant-size" label="Size" optional>
          {() => (
            <Input
              id="variant-size"
              value={form.size}
              onChange={(event) => setForm((current) => ({ ...current, size: event.target.value }))}
              maxLength={40}
              autoComplete="off"
              placeholder="e.g. M"
            />
          )}
        </Field>
        <Field id="variant-color" label="Colour" optional>
          {() => (
            <Input
              id="variant-color"
              value={form.color}
              onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))}
              maxLength={40}
              autoComplete="off"
              placeholder="e.g. Black"
            />
          )}
        </Field>
        <Field id="variant-stock" label="Stock" required hint="Whole units for this variant.">
          {({ invalid, described }) => (
            <Input
              id="variant-stock"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={form.stock}
              aria-invalid={invalid}
              aria-describedby={described}
              onChange={(event) => setForm((current) => ({ ...current, stock: event.target.value }))}
            />
          )}
        </Field>
        <Field
          id="variant-price-adjustment"
          label="Price adjustment (₹)"
          optional
          hint={`Base ${formatPrice(basePrice)}; use a negative value for a discount.`}
        >
          {() => (
            <Input
              id="variant-price-adjustment"
              type="number"
              step="0.01"
              inputMode="decimal"
              value={form.priceAdjustment}
              onChange={(event) =>
                setForm((current) => ({ ...current, priceAdjustment: event.target.value }))
              }
            />
          )}
        </Field>
        <div className="flex items-end">
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) =>
                setForm((current) => ({ ...current, isActive: event.target.checked }))
              }
            />
            Active (purchasable)
          </label>
        </div>
      </div>

      {formError ? (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Variant not saved</AlertTitle>
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={resetForm} disabled={busy}>
          <X aria-hidden="true" />
          Cancel
        </Button>
        <Button type="button" onClick={save} disabled={busy} isLoading={createVariant.isPending || updateVariant.isPending}>
          <Plus aria-hidden="true" />
          {editingId === null ? "Add variant" : "Save variant"}
        </Button>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-lg">Variants</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Size and colour options with their own SKU, price adjustment and stock. Variants are
            deactivated, never deleted, so order history stays intact.
          </p>
        </div>
        {!showAdd && editingId === null ? (
          <Button type="button" size="sm" variant="outline" onClick={startAdd}>
            <Plus aria-hidden="true" />
            Add variant
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {variantsQuery.isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : variantsQuery.isError ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>Variants could not be loaded</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>{getErrorMessage(variantsQuery.error)}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void variantsQuery.refetch()}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : variants.length === 0 && !showAdd ? (
          <EmptyState
            icon={Plus}
            title="No variants yet"
            description="This product currently sells as a single option using the product-level stock. Add a variant only when there are real size or colour choices."
            action={
              <Button type="button" size="sm" onClick={startAdd}>
                Add the first variant
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {variants.map((variant) => (
              <li key={variant.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {variantLabel(variant) ?? "No options"}
                    <span className="text-xs font-normal text-muted-foreground">{variant.sku}</span>
                    <Badge variant={variant.isActive ? "success" : "secondary"}>
                      {variant.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatPrice(variant.unitPrice)} · {variant.stock} in stock
                    {variant.priceAdjustment !== 0
                      ? ` · adjustment ${variant.priceAdjustment > 0 ? "+" : ""}${formatPrice(
                          variant.priceAdjustment,
                        )}`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => startEdit(variant)}
                    disabled={busy}
                  >
                    <Pencil aria-hidden="true" />
                    Edit
                  </Button>
                  {variant.isActive ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setDeactivateTarget(variant)}
                      disabled={busy}
                    >
                      <Power aria-hidden="true" />
                      Deactivate
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {showAdd || editingId !== null ? formFields : null}

        {variants.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            The product-level stock field is an aggregate maintained by the server. Edit stock per
            variant here; direct product stock changes are refused while variants exist.
          </p>
        ) : null}
      </CardContent>

      <ConfirmDialog
        open={deactivateTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deactivateVariant.isPending) setDeactivateTarget(null);
        }}
        tone="destructive"
        title="Deactivate this variant?"
        description={`${deactivateTarget?.sku ?? "This variant"} will disappear from the storefront. Existing orders keep their snapshot. You can reactivate it by editing and saving.`}
        confirmLabel="Deactivate"
        isPending={deactivateVariant.isPending}
        onConfirm={deactivate}
      />
    </Card>
  );
}
