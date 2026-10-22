import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useCreateCategory, useUpdateCategory } from "@/features/admin/mutations";
import { useCategories } from "@/features/catalog/queries";
import {
  categoryFormDefaults,
  categoryFormSchema,
  type CategoryFormValues,
} from "@/features/admin/category-form-schema";
import { ApiError } from "@/lib/api";
import { parentCategoryOptions } from "@/lib/category-tree";
import { getErrorMessage, getFieldErrors } from "@/lib/errors";
import type { Category } from "@/types/catalog";

interface CategoryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category?: Category;
}

export function CategoryFormDialog({ open, onOpenChange, category }: CategoryFormDialogProps) {
  const toast = useToast();
  const createMutation = useCreateCategory();
  const updateMutation = useUpdateCategory(category?.id ?? 0);
  const categoriesQuery = useCategories();
  const isEdit = Boolean(category);
  const isPending = createMutation.isPending || updateMutation.isPending;

  const allCategories = categoriesQuery.data?.categories ?? [];
  const maxDepth = categoriesQuery.data?.maxDepth ?? 3;
  // Self and descendants are removed: offering them would guarantee a cycle.
  const parentOptions = parentCategoryOptions(allCategories, category?.id);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: categoryFormDefaults(category),
    mode: "onSubmit",
  });

  useEffect(() => {
    if (open) reset(categoryFormDefaults(category));
  }, [open, category, reset]);

  const onValid = async (values: CategoryFormValues) => {
    const payload = {
      name: values.name.trim(),
      slug: values.slug.trim() || (category ? category.slug : undefined),
      description: values.description.trim(),
      taxRate: Number(values.taxRate),
      parentId: values.parentId ? Number(values.parentId) : null,
    };

    try {
      if (isEdit && category) {
        const data = await updateMutation.mutateAsync(payload);
        toast({
          title: "Category updated",
          description: `“${data.category.name}” has been saved.`,
          tone: "success",
        });
      } else {
        const data = await createMutation.mutateAsync(payload);
        toast({
          title: "Category created",
          description: `“${data.category.name}” is now available.`,
          tone: "success",
        });
      }
      onOpenChange(false);
    } catch (error) {
      const fieldErrors = getFieldErrors(error);
      let applied = 0;
      for (const [field, message] of Object.entries(fieldErrors)) {
        if (
          field === "name" ||
          field === "slug" ||
          field === "description" ||
          field === "taxRate" ||
          field === "parentId"
        ) {
          setError(field, { type: "server", message });
          applied += 1;
        }
      }

      // Hierarchy refusals (cycle, depth, missing parent) all point at the
      // parent selector; the server message is already user-readable.
      if (applied === 0 && error instanceof ApiError && error.status === 400) {
        const details = error.details as { code?: unknown } | undefined;
        const code = typeof details?.code === "string" ? details.code : "";
        if (code.startsWith("CATEGORY_")) {
          setError("parentId", { type: "server", message: error.message });
          applied += 1;
        }
      }

      if (applied === 0 && error instanceof ApiError && error.status === 409) {
        if (/slug/i.test(error.message)) {
          setError("slug", { type: "server", message: error.message });
          applied += 1;
        } else if (/name/i.test(error.message)) {
          setError("name", { type: "server", message: error.message });
          applied += 1;
        }
      }

      if (applied > 0) {
        toast({
          title: "Check the highlighted fields",
          description: "The server rejected some values. Nothing was saved.",
          tone: "error",
        });
      } else {
        toast({
          title: isEdit ? "Couldn't update category" : "Couldn't create category",
          description: getErrorMessage(error),
          tone: "error",
        });
      }
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!isPending) onOpenChange(next);
      }}
      title={isEdit ? "Edit category" : "Add category"}
      description={
        isEdit
          ? "Update the taxonomy label, slug, parent, description and GST rate."
          : "Create a category for products and per-category tax."
      }
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" form="category-form" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              <>
                <Save aria-hidden="true" />
                {isEdit ? "Save changes" : "Add category"}
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="category-form"
        onSubmit={handleSubmit(onValid, () =>
          toast({
            title: "Check the highlighted fields",
            description: "Fix the form errors before saving.",
            tone: "error",
          }),
        )}
        noValidate
        className="space-y-4"
      >
        <Field id="category-name" label="Name" required error={errors.name?.message}>
          {({ invalid, described }) => (
            <Input
              id="category-name"
              {...register("name")}
              aria-invalid={invalid}
              aria-describedby={described}
              maxLength={100}
              autoComplete="off"
            />
          )}
        </Field>

        <Field
          id="category-parent"
          label="Parent category"
          optional
          error={errors.parentId?.message}
          hint={
            isEdit
              ? "Move this category, with its subcategories, under another one. Top level makes it a root."
              : "Leave as top level to create a root category. Subcategories inherit nothing automatically."
          }
        >
          {({ invalid, described }) => (
            <Select
              id="category-parent"
              {...register("parentId")}
              aria-invalid={invalid}
              aria-describedby={described}
              disabled={categoriesQuery.isLoading}
            >
              <option value="">Top level (no parent)</option>
              {parentOptions.map((option) => (
                <option
                  key={option.id}
                  value={String(option.id)}
                  disabled={option.depth >= maxDepth}
                >
                  {`${"— ".repeat(Math.max(0, option.depth - 1))}${option.name}`}
                  {option.depth >= maxDepth ? " (maximum depth)" : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          id="category-slug"
          label="Slug"
          optional
          error={errors.slug?.message}
          hint={isEdit ? "Leave unchanged to keep the current slug." : "Leave blank to generate it from the name."}
        >
          {({ invalid, described }) => (
            <Input
              id="category-slug"
              {...register("slug")}
              aria-invalid={invalid}
              aria-describedby={described}
              maxLength={160}
              autoComplete="off"
              placeholder="e.g. home-decor"
            />
          )}
        </Field>

        <Field
          id="category-tax"
          label="GST rate (%)"
          required
          error={errors.taxRate?.message}
          hint="Percentage applied to products in this category at checkout."
        >
          {({ invalid, described }) => (
            <Input
              id="category-tax"
              type="number"
              min={0}
              max={999.99}
              step="0.01"
              inputMode="decimal"
              {...register("taxRate")}
              aria-invalid={invalid}
              aria-describedby={described}
            />
          )}
        </Field>

        <Field
          id="category-description"
          label="Description"
          optional
          error={errors.description?.message}
        >
          {({ invalid, described }) => (
            <Textarea
              id="category-description"
              {...register("description")}
              aria-invalid={invalid}
              aria-describedby={described}
              rows={4}
              maxLength={2000}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}
