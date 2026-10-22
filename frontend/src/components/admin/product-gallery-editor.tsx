import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Star, Trash2, Upload } from "lucide-react";
import { ProductThumb } from "@/components/admin/product-thumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  useAppendProductImage,
  useDeleteProductImage,
  useReplaceProductImages,
} from "@/features/admin/mutations";
import { uploadProductImage, validateImageFile } from "@/features/admin/upload";
import { ApiError } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import type { ProductImage } from "@/types/catalog";

export const MAX_GALLERY_IMAGES = 8;

/**
 * Gallery validation errors arrive as `errors: string[]` ("url is required").
 * Showing the generic "Validation failed" would leave the admin guessing, so
 * the first concrete message wins.
 */
function galleryErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const details = error.details as { errors?: unknown } | null;
    if (details && Array.isArray(details.errors)) {
      const first = details.errors.find((entry) => typeof entry === "string" && entry.trim());
      if (typeof first === "string") return first;
    }
  }
  return getErrorMessage(error);
}

interface ProductGalleryEditorProps {
  productId: number;
  images: ProductImage[];
  /** Keeps the form's primary image field in step with gallery row 0. */
  onPrimaryChange?: (url: string, alt: string) => void;
}

/**
 * Ordered gallery editor for an existing product.
 *
 * Every action is a single request that returns the whole refreshed gallery, so
 * the list on screen is always exactly what the server stored — no optimistic
 * guesswork about positions or which image is primary. The first image is the
 * storefront primary, which is why position 0 is labelled rather than hidden.
 */
export function ProductGalleryEditor({ productId, images, onPrimaryChange }: ProductGalleryEditorProps) {
  const appendImage = useAppendProductImage(productId);
  const replaceImages = useReplaceProductImages(productId);
  const removeImage = useDeleteProductImage(productId);
  const toast = useToast();

  const [rows, setRows] = useState<ProductImage[]>(images);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // A different product means a different gallery.
  useEffect(() => {
    setRows(images);
    setDrafts({});
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const atLimit = rows.length >= MAX_GALLERY_IMAGES;

  async function run(action: () => Promise<{ product: { images?: ProductImage[]; image?: string | null; imageMeta?: { alt?: string | null } | null } }>, message: string) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const response = await action();
      setRows(response.product.images ?? []);
      setDrafts({});
      onPrimaryChange?.(response.product.image ?? "", response.product.imageMeta?.alt ?? "");
      toast({ title: message, tone: "success" });
      return true;
    } catch (caught) {
      setError(galleryErrorMessage(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const altFor = (image: ProductImage) => drafts[image.id] ?? image.alt ?? "";

  async function addUrl() {
    const value = url.trim();
    if (!value || atLimit) return;
    const added = await run(() => appendImage.mutateAsync({ url: value }), "Image added");
    if (added) setUrl("");
  }

  async function addFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || atLimit) return;

    const validation = validateImageFile(file);
    if (validation) {
      setError(validation);
      return;
    }

    await run(async () => {
      const upload = await uploadProductImage(file);
      if (upload.mode === "error") {
        setError(upload.message);
        throw new Error(upload.message);
      }
      if (upload.mode === "local") {
        // Local disk has no signed-upload flow: the bytes travel with the
        // request instead (same fallback the product form uses).
        const form = new FormData();
        form.set("image", file);
        return appendImage.mutateAsync(form);
      }
      return appendImage.mutateAsync({ url: upload.objectPath });
    }, "Image added");
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= rows.length || busy) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    await run(
      () => replaceImages.mutateAsync(next.map((image) => ({ url: image.url, alt: image.alt ?? "" }))),
      "Image order updated",
    );
  }

  async function saveAlt(image: ProductImage) {
    const draft = altFor(image).trim();
    if (draft === (image.alt ?? "") || busy) return;
    await run(
      () =>
        replaceImages.mutateAsync(
          rows.map((row) => ({
            url: row.url,
            alt: row.id === image.id ? draft : row.alt ?? "",
          })),
        ),
      "Alt text saved",
    );
  }

  async function remove(image: ProductImage) {
    if (busy) return;
    await run(() => removeImage.mutateAsync(image.id), "Image removed");
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-lg">Gallery</CardTitle>
        <span className="text-xs tabular-nums text-muted-foreground">
          {rows.length} / {MAX_GALLERY_IMAGES}
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          The first image is the storefront primary. Reorder, relabel or remove images here; each
          change is saved immediately.
        </p>

        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            No gallery images yet. The primary image above is used on the storefront.
          </p>
        ) : (
          <ul className="space-y-2" aria-label="Gallery images">
            {rows.map((image, index) => (
              <li
                key={image.id}
                className="flex items-start gap-3 rounded-md border border-border p-2 transition-colors focus-within:border-primary/40"
              >
                <ProductThumb src={image.url} name={`Image ${index + 1}`} className="size-16 shrink-0" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    {index === 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                        <Star className="size-3" aria-hidden="true" />
                        Primary
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Position {index + 1}
                      </span>
                    )}
                  </div>
                  <label className="block">
                    <span className="sr-only">Alt text for image {index + 1}</span>
                    <Input
                      value={altFor(image)}
                      maxLength={255}
                      disabled={busy}
                      placeholder="Describe this image for screen readers"
                      onChange={(event) =>
                        setDrafts((current) => ({ ...current, [image.id]: event.target.value }))
                      }
                      onBlur={() => void saveAlt(image)}
                    />
                  </label>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8"
                      disabled={busy || index === 0}
                      aria-label={`Move image ${index + 1} up`}
                      onClick={() => void move(index, -1)}
                    >
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8"
                      disabled={busy || index === rows.length - 1}
                      aria-label={`Move image ${index + 1} down`}
                      onClick={() => void move(index, 1)}
                    >
                      <ArrowDown aria-hidden="true" />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={busy}
                    aria-label={`Remove image ${index + 1}`}
                    onClick={() => void remove(image)}
                  >
                    <Trash2 aria-hidden="true" />
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-3 rounded-md bg-secondary/50 p-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-48 flex-1">
              <span className="text-sm font-medium">Add image by URL</span>
              <Input
                value={url}
                disabled={busy || atLimit}
                placeholder="https://…"
                autoComplete="off"
                className="mt-1"
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addUrl();
                  }
                }}
              />
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={busy || atLimit || !url.trim()}
              onClick={() => void addUrl()}
            >
              {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ImagePlus aria-hidden="true" />}
              Add
            </Button>
          </div>

          <div className="space-y-1">
            <label htmlFor="gallery-image-file" className="text-sm font-medium">
              Or upload a file
            </label>
            <input
              ref={fileInputRef}
              id="gallery-image-file"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              disabled={busy || atLimit}
              onChange={(event) => void addFile(event)}
              className="block w-full cursor-pointer rounded-md border border-input bg-card text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Upload className="size-3.5" aria-hidden="true" />
              JPEG, PNG, WebP or GIF, up to 5 MB.
              {atLimit ? " Remove an image before adding another." : ""}
            </p>
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-xs font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
