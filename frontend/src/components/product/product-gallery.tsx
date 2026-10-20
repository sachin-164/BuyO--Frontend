import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ImageOff, Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";

export interface GalleryImage {
  src: string;
  alt: string;
}

interface ProductGalleryProps {
  images: GalleryImage[];
  productName: string;
}

export function ProductGallery({ images, productName }: ProductGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  const imageKey = images.map((image) => image.src).join("\u0000");

  useEffect(() => {
    setActiveIndex(0);
    setFailedSrc(null);
  }, [imageKey]);

  const active = images[activeIndex];
  const hasImage = Boolean(active?.src) && failedSrc !== active?.src;

  function openLightbox() {
    setZoomed(false);
    setOpen(true);
  }

  return (
    <div className="space-y-3">
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <button
            type="button"
            onClick={openLightbox}
            aria-label={hasImage ? `Open full-size image of ${productName}` : `No image available for ${productName}`}
            disabled={!hasImage}
            className="group relative block w-full overflow-hidden rounded-lg border border-border bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-default"
          >
            <div className="aspect-square">
              {hasImage ? (
                <img
                  src={active.src}
                  alt={active.alt || productName}
                  decoding="async"
                  className="size-full object-cover"
                  onError={() => setFailedSrc(active.src)}
                />
              ) : (
                <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <ImageOff className="size-10" aria-hidden="true" />
                  <span className="text-sm">No image available</span>
                </div>
              )}
            </div>
            {hasImage ? (
              <span className="pointer-events-none absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-black/65 px-3 py-1.5 text-xs font-medium text-white transition-opacity duration-200 ease-out-strong sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100">
                <Maximize2 className="size-3.5" aria-hidden="true" />
                View full size
              </span>
            ) : null}
          </button>
        </Dialog.Trigger>

        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80 animate-fade-in" />
          <Dialog.Content className="fixed inset-0 z-50 flex flex-col p-4 sm:p-6">
            <Dialog.Title className="sr-only">{productName} — full-size image</Dialog.Title>
            <Dialog.Description className="sr-only">
              Press Escape to close. Use the zoom button to inspect details.
            </Dialog.Description>

            <div className="flex items-center justify-end gap-2">
              {hasImage ? (
                <button
                  type="button"
                  onClick={() => setZoomed((value) => !value)}
                  aria-pressed={zoomed}
                  className="inline-flex items-center gap-2 rounded-md bg-white/10 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  {zoomed ? (
                    <ZoomOut className="size-4" aria-hidden="true" />
                  ) : (
                    <ZoomIn className="size-4" aria-hidden="true" />
                  )}
                  {zoomed ? "Zoom out" : "Zoom in"}
                </button>
              ) : null}
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close image viewer"
                  className="inline-flex size-10 items-center justify-center rounded-md bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <X className="size-5" aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>

            <div className="flex flex-1 items-center justify-center overflow-auto">
              {hasImage ? (
                <img
                  src={active.src}
                  alt={active.alt || productName}
                  className={cn(
                    "mx-auto block h-auto rounded-sm object-contain",
                    zoomed
                      ? "w-[160%] max-w-none sm:w-[130%]"
                      : "max-h-[calc(100dvh-9rem)] max-w-full",
                  )}
                />
              ) : (
                <p className="text-sm text-white/80">No image is available for this product.</p>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {images.length > 1 ? (
        <ul
          aria-label="Product image thumbnails"
          className="grid grid-cols-5 gap-2 sm:grid-cols-6"
        >
          {images.map((image, index) => (
            <li key={image.src}>
              <button
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-label={`View image ${index + 1} of ${images.length}`}
                aria-pressed={index === activeIndex}
                className={cn(
                  "block aspect-square w-full overflow-hidden rounded-md border bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  index === activeIndex
                    ? "border-primary ring-1 ring-primary"
                    : "border-border hover:border-primary/40",
                )}
              >
                <img
                  src={image.src}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="size-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
