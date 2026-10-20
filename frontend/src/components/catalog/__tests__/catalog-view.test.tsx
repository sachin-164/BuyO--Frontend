import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogView } from "@/components/catalog/catalog-view";
import { jsonResponse, renderWithProviders } from "@/test/render";
import type { Product } from "@/types/catalog";

const LAMP: Product = {
  id: 1,
  name: "Test Lamp",
  slug: "test-lamp",
  category: "Lighting",
  mrpPrice: "1299",
  sellingPrice: "999",
  stock: 3,
  image: null,
  description: "A warm desk lamp.",
};

const CHAIR: Product = {
  id: 2,
  name: "Test Chair",
  slug: "test-chair",
  category: "Furniture",
  mrpPrice: "2499",
  sellingPrice: "1999",
  stock: 0,
  image: null,
};

function categoriesResponse() {
  return jsonResponse({
    success: true,
    count: 1,
    categories: [{ id: 1, name: "Lighting", slug: "lighting", productCount: 1 }],
  });
}

function productsResponse(page = 1) {
  return jsonResponse({
    success: true,
    count: 2,
    products: [LAMP, CHAIR],
    pagination: {
      page,
      limit: 12,
      total: 14,
      totalPages: 2,
      hasNext: page < 2,
      hasPrev: page > 1,
    },
  });
}

function installFetch(resolveProducts: (url: URL) => Response | Promise<Response>) {
  const requests: URL[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    requests.push(url);
    if (url.pathname === "/api/categories") return categoriesResponse();
    if (url.pathname === "/api/products") return resolveProducts(url);
    return jsonResponse({ success: false, message: "Not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return requests;
}

describe("CatalogView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores all state from the URL, exposes it as filters, and updates the URL", async () => {
    const user = userEvent.setup();
    const requests = installFetch((url) =>
      productsResponse(Number(url.searchParams.get("page") ?? 1)),
    );

    renderWithProviders(<CatalogView />, {
      route:
        "/shop?q=lamp&category=lighting&sort=price_asc&minPrice=500&maxPrice=2000&inStock=1&page=2",
    });

    expect(
      await screen.findByRole("heading", { level: 3, name: "Test Lamp" }),
    ).toBeInTheDocument();

    const firstRequest = requests.find((url) => url.pathname === "/api/products");
    expect(firstRequest?.searchParams.get("q")).toBe("lamp");
    expect(firstRequest?.searchParams.get("category")).toBe("lighting");
    expect(firstRequest?.searchParams.get("sort")).toBe("price_asc");
    expect(firstRequest?.searchParams.get("minPrice")).toBe("500");
    expect(firstRequest?.searchParams.get("maxPrice")).toBe("2000");
    expect(firstRequest?.searchParams.get("inStock")).toBe("true");
    expect(firstRequest?.searchParams.get("page")).toBe("2");
    expect(firstRequest?.searchParams.get("limit")).toBe("12");

    expect(
      screen.getByText("Showing 13–14 of 14 products for “lamp”"),
    ).toBeInTheDocument();
    expect(screen.getByText("Category: Lighting")).toBeInTheDocument();
    expect(screen.getAllByText("In stock only").length).toBeGreaterThan(0);
    expect(screen.getByText("Price: ₹500–₹2000")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "In stock only" })).toBeChecked();
    expect(screen.getByRole("link", { name: "Page 2" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await user.selectOptions(screen.getByLabelText("Sort by"), "price_desc");

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("sort=price_desc");
    });
    const afterSort = new URL(
      `http://localhost${screen.getByTestId("location").textContent ?? ""}`,
    );
    expect(afterSort.searchParams.get("sort")).toBe("price_desc");
    expect(afterSort.searchParams.get("page")).toBeNull();
    expect(afterSort.searchParams.get("q")).toBe("lamp");

    await user.click(screen.getByRole("button", { name: "Clear all filters" }));

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/shop?sort=price_desc",
      );
    });
    expect(screen.getByLabelText("Sort by")).toHaveValue("price_desc");
    expect(screen.getByRole("checkbox", { name: "In stock only" })).not.toBeChecked();
    const cleared = new URL(
      `http://localhost${screen.getByTestId("location").textContent ?? ""}`,
    );
    expect(cleared.searchParams.get("q")).toBeNull();
    expect(cleared.searchParams.get("category")).toBeNull();
    expect(cleared.searchParams.get("page")).toBeNull();
  });

  it("shows a loading state that resolves into results", async () => {
    let resolveProducts: ((response: Response) => void) | undefined;
    installFetch(
      () =>
        new Promise<Response>((resolve) => {
          resolveProducts = resolve;
        }),
    );

    renderWithProviders(<CatalogView />, { route: "/shop" });

    expect(
      await screen.findByRole("status", { name: "Loading products" }),
    ).toBeInTheDocument();

    await act(async () => {
      resolveProducts?.(productsResponse());
    });

    expect(
      await screen.findByRole("heading", { level: 3, name: "Test Lamp" }),
    ).toBeInTheDocument();
  });

  it("shows the API error and retries successfully", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    installFetch(() => {
      attempts += 1;
      if (attempts === 1) {
        return jsonResponse({ success: false, message: "Catalog is down" }, 500);
      }
      return productsResponse();
    });

    renderWithProviders(<CatalogView />, { route: "/shop" });

    expect(await screen.findByText("Catalog is down")).toBeInTheDocument();
    expect(screen.getByText("Products could not load")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("heading", { level: 3, name: "Test Lamp" }),
    ).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("explains an empty search and offers a way out", async () => {
    installFetch(() =>
      jsonResponse({
        success: true,
        count: 0,
        products: [],
        pagination: { page: 1, limit: 12, total: 0, totalPages: 1 },
      }),
    );

    renderWithProviders(<CatalogView />, { route: "/search?q=zzz" });

    expect(await screen.findByText(/No results for “zzz”/)).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Clear all filters" }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Browse categories" })).toHaveAttribute(
      "href",
      "/categories",
    );
  });

  it("stops fetching and explains an inverted shared price range", async () => {
    const requests = installFetch(() => productsResponse());

    renderWithProviders(<CatalogView />, {
      route: "/shop?minPrice=900&maxPrice=100",
    });

    expect(
      await screen.findByText(/shared price range is invalid/),
    ).toBeInTheDocument();
    expect(
      requests.some((url) => url.pathname === "/api/products"),
    ).toBe(false);
  });
});
