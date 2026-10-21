import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  useCreateAddress,
  useUpdateAddress,
} from "@/features/addresses/mutations";
import { getFieldErrors, getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import type { Address, AddressInput } from "@/types/account";

export const addressFormSchema = z.object({
  label: z.string().trim().max(50, "Label must be 50 characters or fewer"),
  fullName: z
    .string()
    .trim()
    .min(2, "Full name needs at least 2 characters")
    .max(100, "Full name must be 100 characters or fewer"),
  phone: z
    .string()
    .trim()
    .refine(
      (value) => /^\+?\d{10,15}$/.test(value.replace(/[\s-]/g, "")),
      "Enter 10-15 digits; spaces, hyphens and a leading + are allowed",
    )
    .refine(
      (value) => value.length <= 20,
      "Phone must be 20 characters or fewer",
    ),
  line1: z
    .string()
    .trim()
    .min(3, "Address line 1 needs at least 3 characters")
    .max(255, "Address line 1 is too long"),
  line2: z.string().trim().max(255, "Address line 2 is too long"),
  city: z
    .string()
    .trim()
    .min(2, "City needs at least 2 characters")
    .max(100, "City must be 100 characters or fewer"),
  state: z
    .string()
    .trim()
    .min(2, "State needs at least 2 characters")
    .max(100, "State must be 100 characters or fewer"),
  pincode: z
    .string()
    .trim()
    .refine(
      (value) => /^[1-9][0-9]{5}$/.test(value),
      "Enter a 6-digit Indian PIN code; the first digit is 1-9",
    ),
  isDefault: z.boolean().default(false),
});

export type AddressFormValues = z.input<typeof addressFormSchema>;

interface AddressFormProps {
  address?: Address | null;
  onSaved?: (address: Address) => void;
  onCancel?: () => void;
  submitLabel?: string;
  className?: string;
}

/** Shared by the addresses page and the checkout add-address dialog. */
export function AddressForm({
  address,
  onSaved,
  onCancel,
  submitLabel = "Save address",
  className,
}: AddressFormProps) {
  const toast = useToast();
  const createAddress = useCreateAddress();
  const updateAddress = useUpdateAddress();
  const [serverError, setServerError] = useState<string | null>(null);
  const editingDefault = address?.isDefault ?? false;

  const form = useForm<AddressFormValues>({
    resolver: zodResolver(addressFormSchema),
    defaultValues: {
      label: address?.label ?? "",
      fullName: address?.fullName ?? "",
      phone: address?.phone ?? "",
      line1: address?.line1 ?? "",
      line2: address?.line2 ?? "",
      city: address?.city ?? "",
      state: address?.state ?? "",
      pincode: address?.pincode ?? "",
      isDefault: address?.isDefault ?? false,
    },
  });

  const isPending = createAddress.isPending || updateAddress.isPending;

  function applyServerErrors(error: unknown) {
    const fieldErrors = getFieldErrors(error);
    if (Object.keys(fieldErrors).length > 0) {
      let firstKey: string | null = null;
      for (const [field, message] of Object.entries(fieldErrors)) {
        if (field in addressFormSchema.shape && !firstKey) firstKey = field;
        // Unknown but still useful server messages are surfaced below.
        if (!(field in addressFormSchema.shape)) continue;
        form.setError(field as keyof AddressFormValues, { type: "server", message });
      }
      if (firstKey) {
        const element = document.getElementById(`address-${firstKey}`);
        // jsdom and some embedded browsers do not implement scrollIntoView.
        element?.scrollIntoView?.({ block: "center", behavior: "smooth" });
        setServerError("Please correct the highlighted fields and try again.");
      } else {
        setServerError(getErrorMessage(error));
      }
    } else {
      setServerError(getErrorMessage(error));
    }
  }

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    const payload: Partial<AddressInput> = {
      fullName: values.fullName,
      phone: values.phone,
      line1: values.line1,
      line2: values.line2 || undefined,
      city: values.city,
      state: values.state,
      pincode: values.pincode,
      label: values.label || undefined,
      // Edit mode only promotes a default; it never sends `false` for the
      // active default, which the backend would reject.
      isDefault: address ? (values.isDefault ? true : undefined) : values.isDefault,
    };

    try {
      const response = address
        ? await updateAddress.mutateAsync({ id: address.id, data: payload })
        : await createAddress.mutateAsync(payload as AddressInput);
      form.reset({
        label: response.address.label ?? "",
        fullName: response.address.fullName,
        phone: response.address.phone,
        line1: response.address.line1,
        line2: response.address.line2 ?? "",
        city: response.address.city,
        state: response.address.state,
        pincode: response.address.pincode,
        isDefault: response.address.isDefault,
      });
      toast({
        tone: "success",
        title: address ? "Address updated" : "Address saved",
        description: `${response.address.fullName};
${[response.address.line1, response.address.city].filter(Boolean).join(", ")}`,
      });
      onSaved?.(response.address);
    } catch (error) {
      applyServerErrors(error);
    }
  });

  return (
    <form className={cn("space-y-4", className)} onSubmit={submit} noValidate>
      {serverError ? (
        <Alert variant="destructive">
          <AlertTitle>Address could not be saved</AlertTitle>
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}

      <Field
        id="address-label"
        label="Label"
        optional
        hint="For example: Home, Office, Hostel. Maximum 50 characters."
        error={form.formState.errors.label?.message}
      >
        {({ invalid, described }) => (
          <Input
            id="address-label"
            autoComplete="off"
            placeholder="Home"
            {...form.register("label")}
            aria-invalid={invalid}
            aria-describedby={described}
          />
        )}
      </Field>

      <Field
        id="address-fullName"
        label="Full name"
        required
        error={form.formState.errors.fullName?.message}
      >
        {({ invalid, described }) => (
          <Input
            id="address-fullName"
            autoComplete="name"
            placeholder="Anita Rao"
            {...form.register("fullName")}
            aria-invalid={invalid}
            aria-describedby={described}
          />
        )}
      </Field>

      <Field
        id="address-phone"
        label="Phone"
        required
        hint="Used by the delivery partner; stored server-side without spaces or hyphens."
        error={form.formState.errors.phone?.message}
      >
        {({ invalid, described }) => (
          <Input
            id="address-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="98765 43210"
            {...form.register("phone")}
            aria-invalid={invalid}
            aria-describedby={described}
          />
        )}
      </Field>

      <Field id="address-line1" label="Address line 1" required error={form.formState.errors.line1?.message}>
        {({ invalid, described }) => (
          <Input
            id="address-line1"
            autoComplete="address-line1"
            placeholder="Flat or house number, building, road"
            {...form.register("line1")}
            aria-invalid={invalid}
            aria-describedby={described}
          />
        )}
      </Field>

      <Field
        id="address-line2"
        label="Address line 2"
        optional
        error={form.formState.errors.line2?.message}
      >
        {({ invalid, described }) => (
          <Input
            id="address-line2"
            autoComplete="address-line2"
            placeholder="Area, landmark (optional)"
            {...form.register("line2")}
            aria-invalid={invalid}
            aria-describedby={described}
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="address-city" label="City" required error={form.formState.errors.city?.message}>
          {({ invalid, described }) => (
            <Input
              id="address-city"
              autoComplete="address-level2"
              placeholder="Pune"
              {...form.register("city")}
              aria-invalid={invalid}
              aria-describedby={described}
            />
          )}
        </Field>
        <Field id="address-state" label="State" required error={form.formState.errors.state?.message}>
          {({ invalid, described }) => (
            <Input
              id="address-state"
              autoComplete="address-level1"
              placeholder="Maharashtra"
              {...form.register("state")}
              aria-invalid={invalid}
              aria-describedby={described}
            />
          )}
        </Field>
      </div>

      <Field
        id="address-pincode"
        label="PIN code"
        required
        error={form.formState.errors.pincode?.message}
      >
        {({ invalid, described }) => (
          <Input
            id="address-pincode"
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="411001"
            {...form.register("pincode")}
            aria-invalid={invalid}
            aria-describedby={described}
          />
        )}
      </Field>

      <div className="rounded-md border border-border bg-secondary/40 p-3">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-input bg-card text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={editingDefault || isPending}
            aria-describedby={
              editingDefault ? "address-isDefault-hint" : "address-isDefault-hint"
            }
            {...form.register("isDefault")}
          />
          <span>
            <span className="font-medium">Use as default address</span>
            <p id="address-isDefault-hint" className="mt-0.5 text-xs text-muted-foreground">
              {editingDefault
                ? "This already is your default address. Set another address as default to change it."
                : "Checkout starts from the default address when one exists."}
            </p>
          </span>
        </label>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" isLoading={isPending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
