import { z } from "zod";
import type { Category, Product } from "@/types/catalog";

export const PRODUCT_NAME_MAX = 200;
export const PRODUCT_DESCRIPTION_MAX = 5000;

function numericString(label: string, { integer = false } = {}) {
  return z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine((value) => Number.isFinite(Number(value)), `${label} must be a number`)
    .refine((value) => Number(value) > 0, `${label} must be greater than 0`)
    .refine(
      (value) => !integer || Number.isInteger(Number(value)),
      `${label} must be a whole number`,
    );
}

export const productFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Product name is required")
      .max(PRODUCT_NAME_MAX, `Product name must be ${PRODUCT_NAME_MAX} characters or fewer`),
    categoryMode: z.enum(["existing", "custom"]),
    categoryId: z.string(),
    customCategory: z.string().trim().max(100, "Category must be 100 characters or fewer"),
    description: z
      .string()
      .max(PRODUCT_DESCRIPTION_MAX, `Description must be ${PRODUCT_DESCRIPTION_MAX} characters or fewer`),
    mrpPrice: numericString("MRP"),
    sellingPrice: numericString("Selling price"),
    stock: z
      .string()
      .trim()
      .min(1, "Stock is required")
      .refine((value) => Number.isInteger(Number(value)), "Stock must be a whole number")
      .refine((value) => Number(value) >= 0, "Stock cannot be negative")
      .refine((value) => Number(value) <= 1_000_000_000, "Stock is too large"),
    slug: z
      .string()
      .trim()
      .max(160, "Slug must be 160 characters or fewer")
      .refine(
        (value) => value === "" || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
        "Slug can only contain lowercase letters, numbers and hyphens",
      ),
    imageUrl: z
      .string()
      .trim()
      .max(500, "Image URL is too long")
      .refine(
        (value) => value === "" || value.startsWith("/uploads/") || /^https?:\/\//i.test(value),
        "Enter an https:// URL or an /uploads/… path",
      ),
    imageAlt: z.string().trim().max(255, "Alt text must be 255 characters or fewer"),
  })
  .superRefine((values, context) => {
    if (values.categoryMode === "existing" && !values.categoryId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["categoryId"],
        message: "Choose a category",
      });
    }
    if (values.categoryMode === "custom" && !values.customCategory.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customCategory"],
        message: "Category name is required",
      });
    }
    if (
      Number.isFinite(Number(values.mrpPrice)) &&
      Number.isFinite(Number(values.sellingPrice)) &&
      Number(values.sellingPrice) > Number(values.mrpPrice)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sellingPrice"],
        message: "Selling price cannot be greater than MRP",
      });
    }
  });

export type ProductFormValues = z.infer<typeof productFormSchema>;

export function productFormDefaults(
  product: Product | undefined,
  categories: Category[],
): ProductFormValues {
  if (!product) {
    return {
      name: "",
      categoryMode: categories.length > 0 ? "existing" : "custom",
      categoryId: "",
      customCategory: "",
      description: "",
      mrpPrice: "",
      sellingPrice: "",
      stock: "0",
      slug: "",
      imageUrl: "",
      imageAlt: "",
    };
  }

  const byId =
    product.categoryId !== null && product.categoryId !== undefined
      ? categories.find((category) => category.id === product.categoryId)
      : undefined;
  const byName = categories.find((category) => category.name === product.category);

  if (byId || byName) {
    return {
      name: product.name,
      categoryMode: "existing",
      categoryId: String((byId ?? byName)?.id ?? ""),
      customCategory: "",
      description: product.description ?? "",
      mrpPrice: String(product.mrpPrice),
      sellingPrice: String(product.sellingPrice),
      stock: String(product.stock),
      slug: product.slug,
      imageUrl: product.image ?? "",
      imageAlt: product.imageMeta?.alt ?? "",
    };
  }

  return {
    name: product.name,
    categoryMode: "custom",
    categoryId: "",
    customCategory: product.category,
    description: product.description ?? "",
    mrpPrice: String(product.mrpPrice),
    sellingPrice: String(product.sellingPrice),
    stock: String(product.stock),
    slug: product.slug,
    imageUrl: product.image ?? "",
    imageAlt: product.imageMeta?.alt ?? "",
  };
}
