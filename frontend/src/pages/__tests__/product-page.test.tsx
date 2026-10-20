import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProductPage from "@/pages/product-page";
import { jsonResponse, renderWithProviders } from "@/test/render";

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

    if (method === "POST" && url.pathname === "/api/cart") {
      return jsonResponse({ success: true, message: "Item added to cart" }, 201);
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
  });

  it("renders pricing, stock, and description, and asks signed-out users to sign in", async () => {
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
    expect(
      screen.getByRole("link", { name: "Sign in" }),
    ).toHaveAttribute("href", "/login?next=%2Fproduct%2Ftest-lamp");

    await user.click(screen.getByRole("button", { name: "Add to cart" }));

    expect(
      await screen.findByText("Sign in to add this item to your cart"),
    ).toBeInTheDocument();
    expect(
      requests.filter(
        (request) => request.method === "POST" && request.url.pathname === "/api/cart",
      ),
    ).toHaveLength(0);
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
