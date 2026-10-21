import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminProductsPage from "@/pages/admin/products-page";
import {
  PRODUCT,
  PRODUCT_SECOND,
  categoriesResponse,
  installAdminFetch,
  paginationFor,
  productListResponse,
} from "@/test/admin";
import { jsonResponse, renderWithProviders } from "@/test/render";
import { clearToken, setToken } from "@/lib/api";
import { formatPrice } from "@/lib/format";

beforeEach(() => setToken("admin-token"));

afterEach(() => {
  vi.unstubAllGlobals();
  clearToken();
  window.localStorage.clear();
});

function installListFetch(
  options: {
    products?: (url: URL) => Response;
    deleteProduct?: (id: string) => Response;
  } = {},
) {
  return installAdminFetch(({ url, method }) => {
    if (method === "GET" && url.pathname === "/api/products") {
      return options.products?.(url) ?? productListResponse([PRODUCT, PRODUCT_SECOND], paginationFor(2));
    }
    if (method === "GET" && url.pathname === "/api/categories") {
      return categoriesResponse();
    }
    if (method === "DELETE" && url.pathname.startsWith("/api/products/")) {
      return (
        options.deleteProduct?.(url.pathname.split("/").pop() ?? "") ??
        jsonResponse({ success: true, message: "Product deleted" })
      );
    }
    return undefined;
  });
}

describe("AdminProductsPage", () => {
  it("renders the live product table with stock states and edit links", async () => {
    installListFetch();
    renderWithProviders(<AdminProductsPage />, { route: "/admin/products" });

    expect(await screen.findByRole("heading", { name: "Products" })).toBeInTheDocument();
    expect(await screen.findAllByText("Steel Bottle")).not.toHaveLength(0);
    expect(screen.getAllByText("Steel Bottle").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Desk Lamp").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Low stock").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Out of stock").length).toBeGreaterThan(0);
    expect(screen.getAllByText(formatPrice("999.00")).length).toBeGreaterThan(0);

    const editLink = screen.getAllByRole("link", { name: /Edit/ })[0];
    expect(editLink).toHaveAttribute("href", "/admin/products/3/edit");
    expect(screen.getByRole("button", { name: "Delete Steel Bottle" })).toBeInTheDocument();
    expect(screen.getByText("2 products")).toBeInTheDocument();
  });

  it("sorts through the server and applies URL-backed filters", async () => {
    const user = userEvent.setup();
    const { requests } = installListFetch();
    renderWithProviders(<AdminProductsPage />, { route: "/admin/products" });

    await screen.findAllByText("Steel Bottle");

    await user.click(screen.getByRole("button", { name: "Price" }));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("sort=price_asc");
    });

    await user.click(screen.getByRole("button", { name: "Price" }));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("sort=price_desc");
    });

    await user.clear(screen.getByLabelText("Search"));
    await user.type(screen.getByLabelText("Search"), "bottle");
    await user.selectOptions(screen.getByLabelText("Category"), "steel");
    await user.selectOptions(screen.getByLabelText("Stock"), "out");
    await user.type(screen.getByLabelText("Min price (₹)"), "100");
    await user.type(screen.getByLabelText("Max price (₹)"), "5000");
    await user.selectOptions(screen.getByLabelText("Sort"), "name_asc");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() => {
      const location = screen.getByTestId("location");
      expect(location).toHaveTextContent("q=bottle");
      expect(location).toHaveTextContent("category=steel");
      expect(location).toHaveTextContent("stock=out");
      expect(location).toHaveTextContent("min=100");
      expect(location).toHaveTextContent("max=5000");
      expect(location).toHaveTextContent("sort=name_asc");
      expect(location).not.toHaveTextContent("page=");
    });

    await waitFor(() => {
      const lastProductsRequest = [...requests]
        .reverse()
        .find((request) => request.url.pathname === "/api/products");
      expect(lastProductsRequest?.url.searchParams.get("q")).toBe("bottle");
      expect(lastProductsRequest?.url.searchParams.get("inStock")).toBe("false");
      expect(lastProductsRequest?.url.searchParams.get("minPrice")).toBe("100");
      expect(lastProductsRequest?.url.searchParams.get("sort")).toBe("name_asc");
    });
  });

  it("renders server pagination links that preserve active filters", async () => {
    installListFetch({
      products: (url) => {
        if (url.searchParams.get("q") === "missing") {
          return productListResponse([], paginationFor(0));
        }
        return productListResponse([PRODUCT, PRODUCT_SECOND], {
          page: 2,
          limit: 10,
          total: 25,
          totalPages: 3,
          hasNext: true,
          hasPrev: true,
        });
      },
    });

    renderWithProviders(<AdminProductsPage />, {
      route: "/admin/products?page=2&q=bottle&sort=name_asc",
    });

    expect(await screen.findAllByText("Steel Bottle")).not.toHaveLength(0);
    expect(screen.getByLabelText("Search")).toHaveValue("bottle");
    const pageTwo = screen.getByRole("link", { name: "Page 2" });
    expect(pageTwo).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Page 3" })).toHaveAttribute(
      "href",
      "/admin/products?page=3&q=bottle&sort=name_asc",
    );
    expect(screen.getByRole("link", { name: "Previous page" })).toHaveAttribute(
      "href",
      "/admin/products?q=bottle&sort=name_asc",
    );
  });

  it("confirms a destructive delete and reports the server response", async () => {
    const user = userEvent.setup();
    const { requests } = installListFetch();
    renderWithProviders(<AdminProductsPage />, { route: "/admin/products" });

    await screen.findAllByText("Steel Bottle");
    await user.click(screen.getByRole("button", { name: "Delete Steel Bottle" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete product?")).toBeInTheDocument();
    expect(within(dialog).getByText(/permanently removed/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete product" }));

    expect(await screen.findByText("Product deleted")).toBeInTheDocument();
    expect(
      requests.some(
        (request) => request.method === "DELETE" && request.url.pathname === "/api/products/3",
      ),
    ).toBe(true);
  });

  it("keeps the product when deletion fails", async () => {
    const user = userEvent.setup();
    installListFetch({
      deleteProduct: () => jsonResponse({ success: false, message: "Product is in use" }, 409),
    });
    renderWithProviders(<AdminProductsPage />, { route: "/admin/products" });

    await screen.findAllByText("Steel Bottle");
    await user.click(screen.getByRole("button", { name: "Delete Steel Bottle" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete product" }));

    expect(await screen.findByText("Couldn't delete product")).toBeInTheDocument();
    expect(screen.getByText("Product is in use")).toBeInTheDocument();
  });

  it("distinguishes an empty catalog from an empty filter result", async () => {
    installListFetch({
      products: () => productListResponse([], paginationFor(0)),
    });
    const { unmount } = renderWithProviders(<AdminProductsPage />, { route: "/admin/products" });

    expect(await screen.findByText("No products yet")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Add product/ }).length).toBeGreaterThan(0);
    unmount();

    installListFetch({
      products: () => productListResponse([], paginationFor(0)),
    });
    renderWithProviders(<AdminProductsPage />, { route: "/admin/products?q=missing" });

    expect(await screen.findByText("No products match these filters")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("shows a permission error when the products endpoint answers 403", async () => {
    installListFetch({
      products: () => jsonResponse({ success: false, message: "Access denied" }, 403),
    });
    renderWithProviders(<AdminProductsPage />, { route: "/admin/products" });

    expect(await screen.findByText("Admin access required")).toBeInTheDocument();
    expect(screen.queryByText("No products yet")).not.toBeInTheDocument();
  });
});
