import { z } from "zod";
import type { Category } from "@/types/catalog";

export const categoryFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Category name is required")
    .max(100, "Category name must be 100 characters or fewer"),
  slug: z
    .string()
    .trim()
    .max(160, "Slug must be 160 characters or fewer")
    .refine(
      (value) => value === "" || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
      "Slug can only contain lowercase letters, numbers and hyphens",
    ),
  description: z
    .string()
    .max(2000, "Description must be 2,000 characters or fewer"),
  taxRate: z
    .string()
    .trim()
    .min(1, "GST rate is required")
    .refine((value) => Number.isFinite(Number(value)), "GST rate must be a number")
    .refine((value) => Number(value) >= 0, "GST rate cannot be negative")
    .refine((value) => Number(value) <= 999.99, "GST rate must be 999.99 or lower"),
  // Select value: "" = top level, otherwise the parent's id. The server
  // re-checks depth and cycles; this only guards the transport shape.
  parentId: z
    .string()
    .refine(
      (value) => value === "" || /^\d+$/.test(value),
      "Choose a valid parent category",
    ),
});

export type CategoryFormValues = z.infer<typeof categoryFormSchema>;

export function categoryFormDefaults(category?: Category): CategoryFormValues {
  return {
    name: category?.name ?? "",
    slug: category?.slug ?? "",
    description: category?.description ?? "",
    taxRate: String(category?.taxRate ?? 0),
    parentId: category?.parentId !== null && category?.parentId !== undefined
      ? String(category.parentId)
      : "",
  };
}
