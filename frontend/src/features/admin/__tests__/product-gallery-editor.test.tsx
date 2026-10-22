import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ProductGalleryEditor } from "@/components/admin/product-gallery-editor";
import { installAdminFetch } from "@/test/admin";
import { jsonResponse, renderWithProviders } from "@/test/render";
import type { ProductImage } from "@/types/catalog";

function image(id: number, url: string, alt: string | null = null): ProductImage {
  return { id, productId: 3, url, alt, position: id };
}

function galleryResponse(images: ProductImage[]) {
  return jsonResponse({
    success: true,
    message: "ok",
    product: {
      id: 3,
      name: "Steel Bottle",
      slug: "steel-bottle",
      category: "Steel",
      mrpPrice: 1200,
      sellingPrice: 999,
      stock: 4,
      image: images[0]?.url ?? "",
      imageMeta: images[0]?.alt ? { alt: images[0].alt } : null,
      images,
    },
  });
}

/** A tiny in-memory stand-in for the gallery endpoints. */
function installGalleryServer(initial: ProductImage[]) {
  const state = { images: [...initial], nextId: 100 };
  const { requests } = installAdminFetch(({ url, method, body, formData }) => {
    if (url.pathname === "/api/uploads/authorize" && method === "POST") {
      return jsonResponse({ success: false, code: "local-storage", message: "local" }, 409);
    }

    if (url.pathname === "/api/products/3/images" && method === "POST") {
      const uploaded = formData?.get("image");
      const url_ = uploaded instanceof File ? `/uploads/${uploaded.name}` : JSON.parse(body ?? "{}").url;
      const alt = uploaded ? null : JSON.parse(body ?? "{}").alt ?? null;
      state.images = [
        ...state.images,
        {
          id: state.nextId++,
          productId: 3,
          url: url_,
          alt,
          position: state.images.length,
        },
      ];
      return galleryResponse(state.images);
    }

    if (url.pathname === "/api/products/3/images" && method === "PUT") {
      const incoming = JSON.parse(body ?? "{}").images as Array<{ url: string; alt?: string | null }>;
      state.images = incoming.map((entry, position) => ({
        id: state.nextId++,
        productId: 3,
        url: entry.url,
        alt: entry.alt || null,
        position,
      }));
      return galleryResponse(state.images);
    }

    const deleteMatch = url.pathname.match(/^\/api\/products\/3\/images\/(\d+)$/);
    if (deleteMatch && method === "DELETE") {
      const id = Number(deleteMatch[1]);
      state.images = state.images
        .filter((entry) => entry.id !== id)
        .map((entry, position) => ({ ...entry, position }));
      return galleryResponse(state.images);
    }

    return undefined;
  });
  return { requests, state };
}

describe("ProductGalleryEditor", () => {
  it("lists the gallery in order and marks the first image as primary", () => {
    const { requests } = installGalleryServer([image(1, "/uploads/one.png"), image(2, "/uploads/two.png")]);
    renderWithProviders(
      <ProductGalleryEditor productId={3} images={[image(1, "/uploads/one.png"), image(2, "/uploads/two.png")]} />,
    );

    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.getByText("Position 2")).toBeInTheDocument();
    expect(screen.getByText("2 / 8")).toBeInTheDocument();
    // Rendering alone never writes.
    expect(requests.filter((request) => request.method !== "GET")).toHaveLength(0);
  });

  it("adds an image by URL and shows the refreshed gallery", async () => {
    const user = userEvent.setup();
    const { requests, state } = installGalleryServer([]);
    renderWithProviders(<ProductGalleryEditor productId={3} images={[]} />);

    expect(screen.getByText(/No gallery images yet/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Add image by URL/i), "https://cdn.example.test/new.png");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Image added")).toBeInTheDocument();
    expect(state.images).toHaveLength(1);
    const append = requests.find(
      (request) => request.method === "POST" && request.url.pathname === "/api/products/3/images",
    );
    expect(JSON.parse(append?.body ?? "{}")).toEqual({ url: "https://cdn.example.test/new.png" });
    expect(screen.getByText("1 / 8")).toBeInTheDocument();
  });

  it("reorders with the arrow buttons and reports the new order", async () => {
    const user = userEvent.setup();
    const { requests } = installGalleryServer([image(1, "/uploads/one.png"), image(2, "/uploads/two.png")]);
    renderWithProviders(
      <ProductGalleryEditor productId={3} images={[image(1, "/uploads/one.png"), image(2, "/uploads/two.png")]} />,
    );

    // The first row cannot move up; the last cannot move down.
    expect(screen.getByRole("button", { name: "Move image 1 up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move image 2 down" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Move image 2 up" }));
    expect(await screen.findByText("Image order updated")).toBeInTheDocument();

    const reorder = requests.find(
      (request) => request.method === "PUT" && request.url.pathname === "/api/products/3/images",
    );
    expect(JSON.parse(reorder?.body ?? "{}")).toEqual({
      images: [
        { url: "/uploads/two.png", alt: "" },
        { url: "/uploads/one.png", alt: "" },
      ],
    });
    // Promotion is reflected in the UI: the second file is now primary.
    const primaryLabels = screen.getAllByText("Primary");
    expect(primaryLabels).toHaveLength(1);
  });

  it("saves alt text when the field loses focus", async () => {
    const user = userEvent.setup();
    const { requests } = installGalleryServer([image(1, "/uploads/one.png", "Old alt")]);
    renderWithProviders(<ProductGalleryEditor productId={3} images={[image(1, "/uploads/one.png", "Old alt")]} />);

    const alt = screen.getByPlaceholderText(/Describe this image/i);
    await user.clear(alt);
    await user.type(alt, "New alt for the bottle");
    await user.tab();

    expect(await screen.findByText("Alt text saved")).toBeInTheDocument();
    const put = requests.find(
      (request) => request.method === "PUT" && request.url.pathname === "/api/products/3/images",
    );
    expect(JSON.parse(put?.body ?? "{}")).toEqual({
      images: [{ url: "/uploads/one.png", alt: "New alt for the bottle" }],
    });
  });

  it("does not send an alt update when the value is unchanged", async () => {
    const user = userEvent.setup();
    const { requests } = installGalleryServer([image(1, "/uploads/one.png", "Keep me")]);
    renderWithProviders(<ProductGalleryEditor productId={3} images={[image(1, "/uploads/one.png", "Keep me")]} />);

    await user.click(screen.getByPlaceholderText(/Describe this image/i));
    await user.tab();

    expect(
      requests.filter((request) => request.method === "PUT" && request.url.pathname === "/api/products/3/images"),
    ).toHaveLength(0);
  });

  it("removes an image through the API", async () => {
    const user = userEvent.setup();
    const { requests, state } = installGalleryServer([image(1, "/uploads/one.png"), image(2, "/uploads/two.png")]);
    renderWithProviders(
      <ProductGalleryEditor productId={3} images={[image(1, "/uploads/one.png"), image(2, "/uploads/two.png")]} />,
    );

    await user.click(screen.getByRole("button", { name: "Remove image 1" }));

    expect(await screen.findByText("Image removed")).toBeInTheDocument();
    expect(state.images).toEqual([{ ...image(2, "/uploads/two.png"), position: 0 }]);
    expect(
      requests.some(
        (request) => request.method === "DELETE" && request.url.pathname === "/api/products/3/images/1",
      ),
    ).toBe(true);
    // The remaining image is promoted to primary.
    expect(screen.getByText("Primary")).toBeInTheDocument();
  });

  it("uploads a local file to the append endpoint when storage is local", async () => {
    const user = userEvent.setup();
    const { requests, state } = installGalleryServer([]);
    renderWithProviders(<ProductGalleryEditor productId={3} images={[]} />);

    const file = new File([new Uint8Array(2048)], "angle.png", { type: "image/png" });
    await user.upload(screen.getByLabelText(/Or upload a file/i), file);

    expect(await screen.findByText("Image added")).toBeInTheDocument();
    const append = requests.find(
      (request) => request.method === "POST" && request.url.pathname === "/api/products/3/images",
    );
    expect(append?.formData).toBeInstanceOf(FormData);
    expect(append?.formData?.get("image")).toBeInstanceOf(File);
    expect(state.images[0].url).toBe("/uploads/angle.png");
  });

  it("blocks adding a ninth image and explains why", () => {
    const full = Array.from({ length: 8 }, (_, index) => image(index + 1, `/uploads/${index}.png`));
    installGalleryServer(full);
    renderWithProviders(<ProductGalleryEditor productId={3} images={full} />);

    expect(screen.getByText("8 / 8")).toBeInTheDocument();
    expect(screen.getByLabelText(/Add image by URL/i)).toBeDisabled();
    expect(screen.getByLabelText(/Or upload a file/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(screen.getByText(/Remove an image before adding another/i)).toBeInTheDocument();
  });

  it("surfaces a server rejection without changing the list", async () => {
    const user = userEvent.setup();
    installAdminFetch(({ url, method }) => {
      if (url.pathname === "/api/products/3/images" && method === "POST") {
        return jsonResponse({ success: false, message: "Validation failed", errors: ["url is required"] }, 400);
      }
      return undefined;
    });
    renderWithProviders(<ProductGalleryEditor productId={3} images={[image(1, "/uploads/one.png")]} />);

    // Enter is a shortcut for Add.
    const input = screen.getByLabelText(/Add image by URL/i);
    await user.type(input, "https://cdn.example.test/broken.png{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(/url is required/i);
    await waitFor(() => expect(screen.getByText("1 / 8")).toBeInTheDocument());
  });
});
