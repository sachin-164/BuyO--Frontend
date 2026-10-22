import { describe, expect, it } from "vitest";
import { productGalleryImages } from "@/features/catalog/gallery";

const base = { name: "Steel Bottle", image: null, imageMeta: null, images: undefined } as const;

describe("productGalleryImages", () => {
  it("falls back to the legacy primary image when there is no gallery", () => {
    expect(
      productGalleryImages({
        ...base,
        image: "/uploads/bottle.png",
        imageMeta: { alt: "A steel bottle" },
      }),
    ).toEqual([{ src: "/uploads/bottle.png", alt: "A steel bottle" }]);
  });

  it("uses the product name when the primary has no alt text", () => {
    expect(productGalleryImages({ ...base, image: "/uploads/bottle.png" })).toEqual([
      { src: "/uploads/bottle.png", alt: "Steel Bottle" },
    ]);
  });

  it("renders an empty list when the product has no imagery at all", () => {
    expect(productGalleryImages({ ...base })).toEqual([]);
  });

  it("keeps gallery order and per-image alt text", () => {
    expect(
      productGalleryImages({
        ...base,
        image: "/uploads/first.png",
        images: [
          { id: 1, productId: 3, url: "/uploads/first.png", alt: "Front", position: 0 },
          { id: 2, productId: 3, url: "/uploads/back.png", alt: null, position: 1 },
        ],
      }),
    ).toEqual([
      { src: "/uploads/first.png", alt: "Front" },
      { src: "/uploads/back.png", alt: "Steel Bottle" },
    ]);
  });

  it("prefers the gallery over a stale primary reference", () => {
    expect(
      productGalleryImages({
        ...base,
        image: "/uploads/old.png",
        images: [{ id: 9, productId: 3, url: "/uploads/new.png", alt: "New", position: 0 }],
      }),
    ).toEqual([{ src: "/uploads/new.png", alt: "New" }]);
  });

  it("collapses duplicate sources so no thumbnail is ambiguous", () => {
    expect(
      productGalleryImages({
        ...base,
        images: [
          { id: 1, productId: 3, url: "/uploads/shared.png", alt: "A", position: 0 },
          { id: 2, productId: 3, url: "/uploads/shared.png", alt: "B", position: 1 },
        ],
      }),
    ).toEqual([{ src: "/uploads/shared.png", alt: "A" }]);
  });
});
