import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminProductFormPage from "@/pages/admin/product-form-page";
import {
  CATEGORY,
  CATEGORY_SECOND,
  PRODUCT,
  categoriesResponse,
  installAdminFetch,
  productDetailResponse,
  type MockHandler,
} from "@/test/admin";
import { jsonResponse, renderWithProviders } from "@/test/render";
import { clearToken, setToken } from "@/lib/api";
import type { Product } from "@/types/catalog";

const AUTHORIZATION = {
  success: true,
  objectPath: "products/server-generated.png",
  signedUploadUrl: "https://storage.example.test/upload/signed",
  publicUrl: "https://storage.example.test/public/products/server-generated.png",
  expiresAt: "2026-01-01T00:05:00.000Z",
  maxBytes: 5 * 1024 * 1024,
};

const CREATED_PRODUCT: Product = {
  ...PRODUCT,
  id: 99,
  name: "New Bottle",
  slug: "new-bottle",
  category: CATEGORY.name,
  categoryId: CATEGORY.id,
};

function installFormFetch(overrides: MockHandler = () => undefined) {
  return installAdminFetch((request) => {
    const { url, method } = request;

    if (method === "GET" && url.pathname === "/api/categories") {
      return categoriesResponse([CATEGORY, CATEGORY_SECOND]);
    }
    if (method === "GET" && url.pathname === "/api/products/3") {
      return productDetailResponse();
    }
    if (method === "GET" && url.pathname === "/api/products/3/variants") {
      return jsonResponse({ success: true, productId: 3, count: 0, variants: [] });
    }
    if (method === "GET" && url.pathname === "/api/products/999") {
      return jsonResponse({ success: false, message: "Product not found" }, 404);
    }

    const override = overrides(request);
    if (override) return override;

    if (method === "POST" && url.pathname === "/api/uploads/authorize") {
      return jsonResponse(AUTHORIZATION);
    }
    if (method === "PUT" && url.hostname === "storage.example.test") {
      return new Response(null, { status: 200 });
    }
    if (method === "POST" && url.pathname === "/api/products") {
      return jsonResponse({ success: true, message: "Product created", product: CREATED_PRODUCT });
    }
    if (method === "PUT" && url.pathname.startsWith("/api/products/")) {
      return jsonResponse({ success: true, message: "Product updated", product: PRODUCT });
    }
    return undefined;
  });
}

function renderForm(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/products" element={<p>Product list</p>} />
      <Route path="/admin/products/new" element={<AdminProductFormPage />} />
      <Route path="/admin/products/:id/edit" element={<AdminProductFormPage />} />
    </Routes>,
    { route },
  );
}

async function fillBasics(
  user: UserEvent,
  {
    name = "New Bottle",
    mrp = "1500",
    selling = "1200",
    stock = "7",
    slug = "new-bottle",
  }: { name?: string; mrp?: string; selling?: string; stock?: string; slug?: string } = {},
) {
  await user.type(screen.getByLabelText(/Product name/), name);
  await user.selectOptions(screen.getByLabelText(/^Category/), String(CATEGORY.id));
  await user.type(screen.getByLabelText(/^MRP/), mrp);
  await user.type(screen.getByLabelText(/Selling price/), selling);
  const stockInput = screen.getByLabelText(/^Stock/);
  await user.clear(stockInput);
  await user.type(stockInput, stock);
  if (slug) await user.type(screen.getByLabelText(/^Slug/), slug);
}

function imageFile() {
  return new File([new Uint8Array(2048)], "photo.png", { type: "image/png" });
}

function productRequests(requests: ReturnType<typeof installAdminFetch>["requests"]) {
  return requests.filter(
    (request) => request.method === "POST" && request.url.pathname === "/api/products",
  );
}

beforeEach(() => setToken("admin-token"));

afterEach(() => {
  vi.unstubAllGlobals();
  clearToken();
  window.localStorage.clear();
});

describe("AdminProductFormPage", () => {
  it("validates required fields and price ordering before any request", async () => {
    const user = userEvent.setup();
    const { requests } = installFormFetch();
    renderForm("/admin/products/new");

    await screen.findByRole("heading", { name: "Add product" });
    await screen.findByLabelText(/Product name/);
    await user.click(screen.getByRole("button", { name: "Add product" }));

    expect(await screen.findByText("Product name is required")).toBeInTheDocument();
    expect(
      screen.getAllByText("Choose a category").some((node) => node.getAttribute("role") === "alert"),
    ).toBe(true);
    expect(screen.getByText("MRP is required")).toBeInTheDocument();
    expect(screen.getByText("Selling price is required")).toBeInTheDocument();
    expect(productRequests(requests)).toHaveLength(0);

    await user.type(screen.getByLabelText(/Product name/), "Price test");
    await user.selectOptions(screen.getByLabelText(/^Category/), String(CATEGORY.id));
    await user.type(screen.getByLabelText(/^MRP/), "100");
    await user.type(screen.getByLabelText(/Selling price/), "200");
    await user.click(screen.getByRole("button", { name: "Add product" }));

    expect(await screen.findByText("Selling price cannot be greater than MRP")).toBeInTheDocument();
    expect(productRequests(requests)).toHaveLength(0);
  });

  it("creates a product with a JSON payload and returns to the list", async () => {
    const user = userEvent.setup();
    const { requests } = installFormFetch();
    renderForm("/admin/products/new");

    await screen.findByRole("heading", { name: "Add product" });
    await screen.findByLabelText(/Product name/);
    await fillBasics(user);
    await user.type(screen.getByLabelText(/Image URL/), "https://cdn.example.test/new-bottle.png");
    await user.type(screen.getByLabelText(/Image alt text/), "New bottle on a shelf");
    await user.click(screen.getByRole("button", { name: "Add product" }));

    expect(await screen.findByText("Product created")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/admin/products/99/edit");

    const created = productRequests(requests)[0];
    expect(JSON.parse(created.body ?? "{}")).toEqual({
      name: "New Bottle",
      category: "Steel",
      categoryId: 1,
      description: "",
      mrpPrice: 1500,
      sellingPrice: 1200,
      stock: 7,
      slug: "new-bottle",
      image: "https://cdn.example.test/new-bottle.png",
      imageMeta: { alt: "New bottle on a shelf" },
    });
  });

  it("prevents a duplicate submission while the first save is pending", async () => {
    const user = userEvent.setup();
    let resolveCreate: ((response: Response) => void) | undefined;
    const pendingCreate = new Promise<Response>((resolve) => {
      resolveCreate = resolve;
    });
    const { requests } = installFormFetch(({ url, method }) => {
      if (method === "POST" && url.pathname === "/api/products") return pendingCreate;
      return undefined;
    });
    renderForm("/admin/products/new");

    await screen.findByRole("heading", { name: "Add product" });
    await screen.findByLabelText(/Product name/);
    await fillBasics(user);
    const submit = screen.getByRole("button", { name: "Add product" });
    await user.click(submit);
    await user.click(submit);

    await waitFor(() => expect(productRequests(requests)).toHaveLength(1));
    resolveCreate?.(
      jsonResponse({ success: true, message: "Product created", product: CREATED_PRODUCT }),
    );
    expect(await screen.findByText("Product created")).toBeInTheDocument();
  });

  it("uploads a create image directly to storage and saves the server object path", async () => {
    const user = userEvent.setup();
    const { requests } = installFormFetch();
    renderForm("/admin/products/new");

    await screen.findByRole("heading", { name: "Add product" });
    await screen.findByLabelText(/Product name/);
    await fillBasics(user);
    await user.upload(screen.getByLabelText(/upload an image file/i), imageFile());
    await user.type(screen.getByLabelText(/Image alt text/), "Uploaded bottle");
    await user.click(screen.getByRole("button", { name: "Add product" }));

    expect(await screen.findByText("Product created")).toBeInTheDocument();

    const authorize = requests.find((request) => request.url.pathname === "/api/uploads/authorize");
    expect(authorize?.method).toBe("POST");
    expect(JSON.parse(authorize?.body ?? "{}")).toMatchObject({
      filename: "photo.png",
      contentType: "image/png",
      size: 2048,
    });

    const storagePut = requests.find(
      (request) => request.method === "PUT" && request.url.hostname === "storage.example.test",
    );
    expect(storagePut).toBeDefined();
    expect(new Headers(storagePut?.init?.headers).get("Authorization")).toBeNull();
    expect(storagePut?.rawBody).toBeInstanceOf(File);

    const created = productRequests(requests)[0];
    expect(JSON.parse(created.body ?? "{}")).toMatchObject({
      image: AUTHORIZATION.objectPath,
      imageMeta: { alt: "Uploaded bottle" },
    });
  });

  it("falls back to multipart on create when storage is local, saving alt text in the same request", async () => {
    const user = userEvent.setup();
    const { requests } = installFormFetch(({ url, method }) => {
      if (method === "POST" && url.pathname === "/api/uploads/authorize") {
        return jsonResponse({ success: false, code: "local-storage", message: "local" }, 409);
      }
      return undefined;
    });
    renderForm("/admin/products/new");

    await screen.findByRole("heading", { name: "Add product" });
    await screen.findByLabelText(/Product name/);
    await fillBasics(user);
    await user.upload(screen.getByLabelText(/upload an image file/i), imageFile());
    await user.type(screen.getByLabelText(/Image alt text/), "Local bottle");
    await user.click(screen.getByRole("button", { name: "Add product" }));

    expect(await screen.findByText("Product created")).toBeInTheDocument();

    const created = productRequests(requests)[0];
    expect(created.formData).toBeInstanceOf(FormData);
    expect(created.formData?.get("name")).toBe("New Bottle");
    expect(created.formData?.get("category")).toBe("Steel");
    expect(created.formData?.get("categoryId")).toBe("1");
    expect(created.formData?.get("mrpPrice")).toBe("1500");
    expect(created.formData?.get("image")).toBeInstanceOf(File);
    expect(JSON.parse(String(created.formData?.get("imageMeta")))).toEqual({
      alt: "Local bottle",
    });

    // Alt text now travels with the upload: no second request that could fail
    // after the product was already saved.
    expect(
      requests.some(
        (request) => request.method === "PUT" && request.url.pathname === "/api/products/99",
      ),
    ).toBe(false);
  });

  it("loads an existing product and updates it without resending an unchanged image", async () => {
    const user = userEvent.setup();
    const { requests } = installFormFetch();
    renderForm("/admin/products/3/edit");

    expect(await screen.findByDisplayValue("Steel Bottle")).toBeInTheDocument();
    const name = screen.getByLabelText(/Product name/);
    await user.clear(name);
    await user.type(name, "Steel Bottle Pro");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Product updated")).toBeInTheDocument();

    const update = requests.find(
      (request) => request.method === "PUT" && request.url.pathname === "/api/products/3",
    );
    const body = JSON.parse(update?.body ?? "{}");
    expect(body).toMatchObject({
      name: "Steel Bottle Pro",
      category: "Steel",
      categoryId: 1,
      mrpPrice: 1200,
      sellingPrice: 999,
      stock: 4,
      slug: "steel-bottle",
    });
    expect(body).not.toHaveProperty("image");
  });

  it("removes an existing image explicitly", async () => {
    const user = userEvent.setup();
    const { requests } = installFormFetch();
    renderForm("/admin/products/3/edit");

    expect(await screen.findByDisplayValue("Steel Bottle")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove image" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Product updated")).toBeInTheDocument();
    const update = requests.find(
      (request) => request.method === "PUT" && request.url.pathname === "/api/products/3",
    );
    expect(JSON.parse(update?.body ?? "{}")).toMatchObject({ image: "", imageMeta: {} });
  });

  it("replaces an existing image on edit through multipart when storage is local", async () => {
    const user = userEvent.setup();
    const { requests } = installFormFetch(({ url, method }) => {
      if (method === "POST" && url.pathname === "/api/uploads/authorize") {
        return jsonResponse({ success: false, code: "local-storage", message: "local" }, 409);
      }
      return undefined;
    });
    renderForm("/admin/products/3/edit");

    expect(await screen.findByDisplayValue("Steel Bottle")).toBeInTheDocument();
    await user.upload(screen.getByLabelText(/replace image with a file/i), imageFile());
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Product updated")).toBeInTheDocument();

    const update = requests.find(
      (request) => request.method === "PUT" && request.url.pathname === "/api/products/3",
    );
    expect(update?.formData).toBeInstanceOf(FormData);
    expect(update?.formData?.get("image")).toBeInstanceOf(File);
    expect(update?.formData?.get("name")).toBe("Steel Bottle");
    // The alt field is prefilled from the product, so the visible value is
    // preserved unless the admin edits it.
    expect(JSON.parse(String(update?.formData?.get("imageMeta")))).toEqual({
      alt: "A steel bottle",
    });
  });

  it("keeps the typed alt text when the image is replaced", async () => {
    const user = userEvent.setup();
    const { requests } = installFormFetch(({ url, method }) => {
      if (method === "POST" && url.pathname === "/api/uploads/authorize") {
        return jsonResponse({ success: false, code: "local-storage", message: "local" }, 409);
      }
      return undefined;
    });
    renderForm("/admin/products/3/edit");

    expect(await screen.findByDisplayValue("Steel Bottle")).toBeInTheDocument();
    const alt = screen.getByLabelText(/Image alt text/);
    await user.clear(alt);
    await user.type(alt, "Matte steel bottle on concrete");
    await user.upload(screen.getByLabelText(/replace image with a file/i), imageFile());
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Product updated")).toBeInTheDocument();
    const update = requests.find(
      (request) => request.method === "PUT" && request.url.pathname === "/api/products/3",
    );
    expect(JSON.parse(String(update?.formData?.get("imageMeta")))).toEqual({
      alt: "Matte steel bottle on concrete",
    });
  });

  it("maps server validation errors back onto the form", async () => {
    const user = userEvent.setup();
    const { requests } = installFormFetch(({ url, method }) => {
      if (method === "POST" && url.pathname === "/api/products") {
        return jsonResponse(
          {
            success: false,
            message: "Validation failed",
            errors: [
              "categoryId must reference an existing category",
              "mrpPrice must be greater than 0",
              "imageMeta.alt must be a string",
            ],
          },
          400,
        );
      }
      return undefined;
    });
    renderForm("/admin/products/new");

    await screen.findByRole("heading", { name: "Add product" });
    await screen.findByLabelText(/Product name/);
    await fillBasics(user);
    await user.type(screen.getByLabelText(/Image URL/), "https://cdn.example.test/x.png");
    await user.click(screen.getByRole("button", { name: "Add product" }));

    expect(await screen.findByText("Check the highlighted fields")).toBeInTheDocument();
    expect(productRequests(requests)).toHaveLength(1);
    expect(screen.getByText("must reference an existing category")).toBeInTheDocument();
    expect(screen.getByText("must be greater than 0")).toBeInTheDocument();
    expect(screen.getByText("must be a string")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/admin/products/new");
  });

  it("disables product stock and omits it from the update when variants exist", async () => {
    const user = userEvent.setup();
    const variantProduct: Product = {
      ...PRODUCT,
      id: 5,
      name: "Everyday Tee",
      slug: "everyday-tee",
      stock: 4,
      hasVariants: true,
      variants: [
        {
          id: 31,
          productId: 5,
          sku: "TEE-BLK-M",
          size: "M",
          color: "Black",
          priceAdjustment: 0,
          unitPrice: 999,
          stock: 4,
          isActive: true,
        },
      ],
    };
    const { requests } = installFormFetch(({ url, method }) => {
      if (method === "GET" && url.pathname === "/api/products/5") {
        return productDetailResponse(variantProduct);
      }
      if (method === "GET" && url.pathname === "/api/products/5/variants") {
        return jsonResponse({
          success: true,
          productId: 5,
          count: 1,
          variants: variantProduct.variants,
        });
      }
      if (method === "PUT" && url.pathname === "/api/products/5") {
        return jsonResponse({
          success: true,
          message: "Product updated",
          product: variantProduct,
        });
      }
      return undefined;
    });

    renderForm("/admin/products/5/edit");

    expect(await screen.findByDisplayValue("Everyday Tee")).toBeInTheDocument();
    const stock = screen.getByLabelText(/^Stock/);
    expect(stock).toBeDisabled();
    expect(screen.getByText(/Managed per variant/)).toBeInTheDocument();
    expect(await screen.findByText("Size M · Colour Black")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/admin/products"));

    const put = requests.find(
      (request) => request.method === "PUT" && request.url.pathname === "/api/products/5",
    );
    expect(JSON.parse(put?.body ?? "{}")).not.toHaveProperty("stock");
  });

  it("shows not-found and invalid-id states without inventing a form", async () => {
    installFormFetch();
    const { unmount } = renderForm("/admin/products/999/edit");
    expect(await screen.findByText("Product not found")).toBeInTheDocument();
    unmount();

    installFormFetch();
    renderForm("/admin/products/abc/edit");
    expect(await screen.findByText("Invalid product link")).toBeInTheDocument();
  });
});
