import type { Product } from "@/types/catalog";
import type { GalleryImage } from "@/components/product/product-gallery";

/**
 * The storefront never invents imagery: it renders exactly the gallery the
 * server returns, in order, and falls back to the legacy primary image for
 * products that have no gallery rows yet.
 *
 * Duplicate sources are collapsed so a re-used file cannot render two
 * identical thumbnails that both appear selected.
 */
export function productGalleryImages(product: Pick<Product, "name" | "image" | "imageMeta" | "images">): GalleryImage[] {
  const gallery = product.images ?? [];
  const ordered =
    gallery.length > 0
      ? gallery.map((image) => ({
          src: image.url,
          alt: image.alt || product.imageMeta?.alt || product.name,
        }))
      : product.image
        ? [{ src: product.image, alt: product.imageMeta?.alt || product.name }]
        : [];

  const seen = new Set<string>();
  return ordered.filter((image) => {
    if (!image.src || seen.has(image.src)) return false;
    seen.add(image.src);
    return true;
  });
}
