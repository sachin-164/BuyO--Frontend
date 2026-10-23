import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProductPage from "@/pages/product-page";
import { jsonResponse, renderWithProviders } from "@/test/render";
import { clearToken } from "@/lib/api";
import { clearGuestCart } from "@/features/cart/guest-cart";

const LAMP = {
  id: 1,
  name: "Test Lamp",
  slug: "test-lamp",
  category: "Lighting",
  mrpPrice: "1299",
  sellingPrice: "999",
  stock: 3,
  image: null,
  description: "A warm desk lamp with a linen shade.",
  Category: { id: 1, name: "Lighting", slug: "lighting" },
};

const VARIANT_PRODUCT = {
  ...LAMP,
  id: 5,
  name: "Everyday Tee",
  slug: "everyday-tee",
  sellingPrice: "1000",
  stock: 5,
  hasVariants: true,
  variants: [
    {
      id: 31,
      productId: 5,
      sku: "TEE-BLK-M",
      size: "M",
      color: "Black",
      priceAdjustment: 100,
      unitPrice: 1100,
      stock: 5,
      isActive: true,
    },
    {
      id: 32,
      productId: 5,
      sku: "TEE-WHT-L",
      size: "L",
      color: "White",
      priceAdjustment: 0,
      unitPrice: 1000,
      stock: 0,
      isActive: true,
    },
  ],
};

interface RecordedRequest {
  url: URL;
  method: string;
  body?: string;
}

function installFetch({ productStatus = 200 }: { productStatus?: number } = {}) {
  let inWishlist = false;
  const requests: RecordedRequest[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    requests.push({
      url,
      method,
      body: typeof init?.body === "string" ? init.body : undefined,
    });

    if (method === "GET" && url.pathname === "/api/auth/me") {
      return jsonResponse({
        success: true,
        user: {
          id: 1,
          name: "Test User",
          email: "test@example.com",
          isVerified: true,
          role: "customer",
          isAdmin: false,
        },
      });
    }
    if (method === "POST" && url.pathname === "/api/cart") {
      return jsonResponse({
        success: true,
        message: "Item added to cart",
        count: 1,
        items: [],
        totals: {
          subtotal: 0,
          tax: { total: 0, byCategory: [], preview: true },
          grandTotal: 0,
        },
        totalsNotice: "Preview only.",
      }, 201);
    }
    if (method === "POST" && url.pathname === "/api/wishlist/toggle") {
      inWishlist = !inWishlist;
      return jsonResponse({ success: true, inWishlist, count: 1 });
    }
    if (method === "GET" && url.pathname === "/api/products/test-lamp") {
      if (productStatus === 404) {
        return jsonResponse({ success: false, message: "Product not found" }, 404);
      }
      return jsonResponse({ success: true, product: LAMP });
    }
    if (method === "GET" && url.pathname === "/api/products") {
      return jsonResponse({
        success: true,
        count: 0,
        products: [],
        pagination: { page: 1, limit: 5, total: 0, totalPages: 1 },
      });
    }
    if (method === "GET" && url.pathname === "/api/wishlist/products/1") {
      return jsonResponse({ success: true, productId: 1, inWishlist });
    }
    return jsonResponse({ success: false, message: "Not found" }, 404);
  });

  vi.stubGlobal("fetch", fetchMock);
  return requests;
}

function installVariantFetch() {
  const requests: RecordedRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    requests.push({
      url,
      method,
      body: typeof init?.body === "string" ? init.body : undefined,
    });

    if (method === "GET" && url.pathname === "/api/products/everyday-tee") {
      return jsonResponse({ success: true, product: VARIANT_PRODUCT });
    }
    if (method === "GET" && url.pathname === "/api/products/everyday-tee/reviews") {
      return jsonResponse({
        success: true,
        productId: 5,
        count: 1,
        reviews: [
          {
            id: 91,
            rating: 5,
            title: "Great quality",
            body: "The cotton is soft and the fit is right.",
            createdAt: "2026-01-05T10:00:00.000Z",
            author: { name: "Anita R." },
          },
        ],
        summary: {
          count: 1,
          average: 5,
          distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 },
        },
        pagination: {
          page: 1,
          limit: 5,
          total: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      });
    }
    if (method === "GET" && url.pathname === "/api/products") {
      return jsonResponse({
        success: true,
        count: 0,
        products: [],
        pagination: { page: 1, limit: 5, total: 0, totalPages: 1 },
      });
    }
    return jsonResponse({ success: false, message: "Not found" }, 404);
  });

  vi.stubGlobal("fetch", fetchMock);
  return requests;
}

function renderProductPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/product/:slug" element={<ProductPage />} />
    </Routes>,
    { route: "/product/test-lamp" },
  );
}

describe("ProductPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearGuestCart();
    clearToken();
  });

  it("renders pricing, stock, and description, and saves a guest cart item in this browser", async () => {
    const user = userEvent.setup();
    const requests = installFetch();

    renderProductPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Test Lamp" }),
    ).toBeInTheDocument();
    expect(screen.getByText("₹999")).toBeInTheDocument();
    expect(screen.getByText("₹1,299")).toBeInTheDocument();
    expect(screen.getByText("23% off")).toBeInTheDocument();
    expect(screen.getByText("Only 3 left")).toBeInTheDocument();
    expect(
      screen.getByText("A warm desk lamp with a linen shade."),
    ).toBeInTheDocument();
    // The header and the review CTA both offer sign-in for a guest.
    expect(
      screen.getAllByRole("link", { name: "Sign in" }).every(
        (link) => link.getAttribute("href") === "/login?next=%2Fproduct%2Ftest-lamp",
      ),
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: "Add to cart" }));

    expect(await screen.findByText(/Added 1 × Test Lamp/)).toBeInTheDocument();
    expect(screen.getByText(/Saved in this browser/)).toBeInTheDocument();
    // Guests never hit the server cart: the line lives in localStorage until
    // they sign in and the merge endpoint runs.
    expect(
      requests.filter(
        (request) => request.method === "POST" && request.url.pathname === "/api/cart",
      ),
    ).toHaveLength(0);
    const guestLines = JSON.parse(
      window.localStorage.getItem("buyo.guestCart.v1") ?? "[]",
    ) as Array<{ productId: number; qty: number }>;
    expect(guestLines).toHaveLength(1);
    expect(guestLines[0]).toMatchObject({ productId: 1, qty: 1 });
  });

  it("auto-selects a real variant, prices it, and adds the exact variant for a guest", async () => {
    const user = userEvent.setup();
    installVariantFetch();

    renderWithProviders(
      <Routes>
        <Route path="/product/:slug" element={<ProductPage />} />
      </Routes>,
      { route: "/product/everyday-tee" },
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Everyday Tee" }),
    ).toBeInTheDocument();
    // First in-stock variant (M/Black) is selected automatically.
    expect(screen.getByText("₹1,100")).toBeInTheDocument();
    expect(screen.getByText("SKU TEE-BLK-M")).toBeInTheDocument();
    expect(screen.getByText("Selected: Size M · Colour Black")).toBeInTheDocument();
    expect(screen.getByLabelText("Size")).toHaveValue("M");
    expect(screen.getByLabelText("Colour")).toHaveValue("Black");

    // Selecting the out-of-stock real variant disables purchase instead of
    // pretending an unavailable combination is buyable.
    await user.selectOptions(screen.getByLabelText("Size"), "L");
    expect(screen.getByText("Selected: Size L · Colour White")).toBeInTheDocument();
    expect(screen.getAllByText("Out of stock").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Add to cart" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Size"), "M");
    await user.click(screen.getByRole("button", { name: "Increase quantity" }));
    await user.click(screen.getByRole("button", { name: "Add to cart" }));

    expect(
      await screen.findByText(/Added 2 × Everyday Tee \(Size M · Colour Black\)/),
    ).toBeInTheDocument();
    const guestLines = JSON.parse(
      window.localStorage.getItem("buyo.guestCart.v1") ?? "[]",
    ) as Array<{ productId: number; variantId: number; qty: number; unitPrice: number }>;
    expect(guestLines).toEqual([
      expect.objectContaining({ productId: 5, variantId: 31, qty: 2, unitPrice: 1100 }),
    ]);
  });

  it("shows approved reviews only and their aggregate", async () => {
    installVariantFetch();

    renderWithProviders(
      <Routes>
        <Route path="/product/:slug" element={<ProductPage />} />
      </Routes>,
      { route: "/product/everyday-tee" },
    );

    await screen.findByRole("heading", { level: 1, name: "Everyday Tee" });
    expect(await screen.findByText("Great quality")).toBeInTheDocument();
    expect(screen.getByText("The cotton is soft and the fit is right.")).toBeInTheDocument();
    expect(screen.getByText("1 approved review")).toBeInTheDocument();
    expect(screen.getByText(/Anita R\./)).toBeInTheDocument();
    // The summary and the individual review both expose the same rating label.
    expect(screen.getAllByLabelText("5 out of 5 stars").length).toBeGreaterThan(0);
  });

  it("adds the chosen quantity to the cart and toggles the wishlist when signed in", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("token", "test-token");
    const requests = installFetch();

    renderProductPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Test Lamp" }),
    ).toBeInTheDocument();

    const quantity = screen.getByLabelText("Quantity");
    expect(quantity).toHaveValue("1");

    await user.click(screen.getByRole("button", { name: "Increase quantity" }));
    expect(quantity).toHaveValue("2");

    await user.click(screen.getByRole("button", { name: "Add to cart" }));

    expect(
      await screen.findByText(/Added 2 × Test Lamp to your cart/),
    ).toBeInTheDocument();

    const cartRequest = requests.find(
      (request) => request.method === "POST" && request.url.pathname === "/api/cart",
    );
    expect(cartRequest).toBeDefined();
    expect(JSON.parse(cartRequest?.body ?? "{}")).toEqual({
      productId: 1,
      qty: 2,
    });

    await user.click(screen.getByRole("button", { name: "Save to wishlist" }));

    expect(await screen.findByText("Saved to your wishlist")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Saved to wishlist" }),
    ).toHaveAttribute("aria-pressed", "true");

    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.method === "POST" &&
            request.url.pathname === "/api/wishlist/toggle",
        ),
      ).toBe(true);
    });
  });

  it("shows a not-found state for a missing product", async () => {
    installFetch({ productStatus: 404 });

    renderProductPage();

    expect(await screen.findByText("Product not found")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Browse all products" }),
    ).toHaveAttribute("href", "/shop");
  });
});
