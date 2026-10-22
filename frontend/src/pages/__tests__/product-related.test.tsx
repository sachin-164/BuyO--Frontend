import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProductPage from "@/pages/product-page";
import { jsonResponse, renderWithProviders } from "@/test/render";

const MAIN = {
  id: 1,
  name: "Steel Bottle",
  slug: "steel-bottle",
  category: "Steel",
  categoryId: 3,
  mrpPrice: "500",
  sellingPrice: "400",
  stock: 5,
  image: null,
  description: "A double-walled steel bottle.",
  Category: { id: 3, name: "Steel", slug: "steel", taxRate: 5 },
};

const RELATED = [
  {
    id: 2,
    name: "Steel Mug",
    slug: "steel-mug",
    category: "Steel",
    categoryId: 3,
    mrpPrice: "300",
    sellingPrice: "250",
    stock: 4,
    image: null,
    Category: { id: 3, name: "Steel", slug: "steel", taxRate: 5 },
  },
  {
    id: 3,
    name: "Steel Tumbler",
    slug: "steel-tumbler",
    category: "Steel",
    categoryId: 3,
    mrpPrice: "350",
    sellingPrice: "300",
    stock: 0,
    image: null,
    Category: { id: 3, name: "Steel", slug: "steel", taxRate: 5 },
  },
];

function installFetch(related: unknown[] = RELATED) {
  const requests: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      requests.push(url);

      if (url.pathname === "/api/products/steel-bottle" || url.pathname === "/api/products/1") {
        return jsonResponse({ success: true, product: MAIN });
      }
      if (url.pathname === "/api/products/1/related") {
        return jsonResponse({
          success: true,
          productId: 1,
          count: related.length,
          products: related,
        });
      }
      return jsonResponse({ success: false, message: "Not found" }, 404);
    }),
  );
  return { requests };
}

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/product/:slug" element={<ProductPage />} />
    </Routes>,
    { route: "/product/steel-bottle" },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("related products on the product page", () => {
  it("renders exactly the siblings the server returned", async () => {
    const { requests } = installFetch();
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Steel Bottle" })).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { level: 2, name: "You may also like" }),
    ).toBeInTheDocument();

    expect(screen.getByText("Steel Mug")).toBeInTheDocument();
    expect(screen.getByText("Steel Tumbler")).toBeInTheDocument();

    // Exactly the two returned siblings render; the product itself does not.
    const relatedLinks = screen
      .getAllByRole("link")
      .filter((link) => /^\/product\/(steel-mug|steel-tumbler)$/.test(link.getAttribute("href") ?? ""));
    expect(relatedLinks).toHaveLength(2);

    const relatedCall = requests.find((url) => url.pathname === "/api/products/1/related");
    expect(relatedCall?.searchParams.get("limit")).toBe("4");
  });

  it("hides the section entirely when there are no siblings", async () => {
    installFetch([]);
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Steel Bottle" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 2, name: "You may also like" }),
    ).not.toBeInTheDocument();
  });
});
