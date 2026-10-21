import { ApiError, api } from "@/lib/api";
import type { UploadAuthorizationResponse } from "@/types/admin";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return "Choose a JPEG, PNG, WebP or GIF image.";
  }
  if (file.size <= 0) return "The selected file is empty.";
  if (file.size > MAX_IMAGE_BYTES) return "Images must be 5 MB or smaller.";
  return null;
}

export type UploadProductImageResult =
  | { mode: "direct"; objectPath: string; publicUrl: string }
  | { mode: "local" }
  | { mode: "error"; message: string; status?: number };

function isLocalStorageResponse(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 409) return false;
  if (!error.details || typeof error.details !== "object") return false;
  return (error.details as { code?: unknown }).code === "local-storage";
}

/**
 * Phase 12 direct-to-storage upload, reimplemented for the SPA.
 *
 * 1. ask the API to authorize ONE server-generated object path
 * 2. PUT the bytes directly to the signed storage URL (no API credentials)
 * 3. return the object path for the product create/update call
 *
 * The service-role key never reaches the browser. The signed URL request
 * deliberately omits the app's Authorization header.
 */
export async function uploadProductImage(file: File): Promise<UploadProductImageResult> {
  const validation = validateImageFile(file);
  if (validation) return { mode: "error", message: validation };

  let authorization: UploadAuthorizationResponse;
  try {
    authorization = await api.post<UploadAuthorizationResponse>("/api/uploads/authorize", {
      filename: file.name,
      contentType: file.type,
      size: file.size,
    });
  } catch (error) {
    if (isLocalStorageResponse(error)) return { mode: "local" };
    return {
      mode: "error",
      message:
        error instanceof ApiError
          ? error.message
          : "Could not authorize the upload. Check your connection and try again.",
      status: error instanceof ApiError ? error.status : undefined,
    };
  }

  if (!authorization?.signedUploadUrl || !authorization?.objectPath) {
    return {
      mode: "error",
      message: "The server did not return a usable upload authorization.",
    };
  }

  try {
    const response = await fetch(authorization.signedUploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
      // The signed URL is its own credential; never send the app session.
      credentials: "omit",
    });
    if (!response.ok) {
      return {
        mode: "error",
        message: "The image could not be uploaded to storage. Nothing was saved.",
        status: response.status,
      };
    }
  } catch {
    return {
      mode: "error",
      message: "The image could not be uploaded to storage. Nothing was saved.",
    };
  }

  return {
    mode: "direct",
    objectPath: authorization.objectPath,
    publicUrl: authorization.publicUrl,
  };
}
