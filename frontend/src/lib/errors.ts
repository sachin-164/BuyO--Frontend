import { ApiError } from "@/lib/api";

const FIELD_NAMES = new Set([
  "name",
  "email",
  "password",
  "currentPassword",
  "newPassword",
  "fullName",
  "phone",
  "line1",
  "line2",
  "city",
  "state",
  "pincode",
  "label",
  "isDefault",
  "addressId",
  "idempotencyKey",
  "notes",
  "qty",
  "productId",
  // Admin product/category fields (server validation messages start with them).
  "category",
  "categoryId",
  "description",
  "mrpPrice",
  "sellingPrice",
  "stock",
  "slug",
  "image",
  "imageMeta",
  "imageMeta.alt",
  "taxRate",
]);

/**
 * The Express validation middleware returns `errors: string[]` such as
 * "pincode must be a 6-digit Indian PIN code". Map those back onto form
 * fields when the first word is a known field; leave unmatched messages in
 * `form`.
 */
export function getFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  if (!error.details || typeof error.details !== "object") return {};

  const raw = (error.details as { errors?: unknown }).errors;
  if (!Array.isArray(raw)) return {};

  const result: Record<string, string> = {};
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    // Dotted names are real (e.g. "imageMeta.alt must be a string").
    const match = /^([A-Za-z][A-Za-z0-9_.]*)\s+(.+)$/.exec(entry.trim());
    if (!match || !FIELD_NAMES.has(match[1])) continue;
    const field = match[1];
    // Keep the first message for a field; server order is intentional.
    if (!result[field]) result[field] = match[2];
  }
  return result;
}

export function getApiErrorDetails<T>(error: unknown): T | null {
  if (!(error instanceof ApiError)) return null;
  return (error.details as T | null) ?? null;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}
