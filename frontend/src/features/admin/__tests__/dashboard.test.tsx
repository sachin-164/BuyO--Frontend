import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminDashboardPage from "@/pages/admin/dashboard-page";
import {
  CATEGORY,
  CATEGORY_SECOND,
  ORDER_SUMMARY,
  PRODUCT,
  PRODUCT_SECOND,
  categoriesResponse,
  installAdminFetch,
  orderListResponse,
  paginationFor,
  productListResponse,
} from "@/test/admin";
import { jsonResponse, renderWithProviders } from "@/test/render";
import { clearToken, setToken } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import type { AdminOrderSummary } from "@/types/admin";

const CANCELLED_ORDER: AdminOrderSummary = {
  ...ORDER_SUMMARY,
  id: 24,
  orderNumber: "BO-260101-CANCELLED",
  status: "cancelled",
  grandTotal: 500,
  subtotal: 480,
  taxTotal: 20,
};

beforeEach(() => {
  setToken("admin-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearToken();
  window.localStorage.clear();
});

function basicHandler(overrides?: {
  products?: () => Response;
  orders?: () => Response;
  categories?: () => Response;
}) {
  return installAdminFetch(({ url, method }) => {
    if (method !== "GET") return undefined;
    if (url.pathname === "/api/products") {
      return overrides?.products?.() ?? productListResponse([PRODUCT, PRODUCT_SECOND], paginationFor(2));
    }
    if (url.pathname === "/api/admin/orders") {
      return (
        overrides?.orders?.() ??
        orderListResponse([ORDER_SUMMARY, CANCELLED_ORDER], paginationFor(2, 1, 100))
      );
    }
    if (url.pathname === "/api/categories") {
      return overrides?.categories?.() ?? categoriesResponse([CATEGORY, CATEGORY_SECOND]);
    }
    return undefined;
  });
}

describe("AdminDashboardPage", () => {
  it("renders live catalog, order, status and low-stock data", async () => {
    basicHandler();
    renderWithProviders(<AdminDashboardPage />, { route: "/admin" });

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    await screen.findAllByText(formatPrice(1049));
    expect(screen.getByText("Products")).toBeInTheDocument();
    expect(screen.getByText("Categories")).toBeInTheDocument();
    expect(screen.getByText("Orders by status")).toBeInTheDocument();
    expect(screen.getByText("Low stock")).toBeInTheDocument();
    expect(screen.getByText("Recent orders")).toBeInTheDocument();

    // Non-cancelled gross order value only.
    expect(screen.getAllByText(formatPrice(1049)).length).toBeGreaterThan(0);
    // Real recent order + customer.
    expect(screen.getAllByText("BO-260101-ABC123").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Anita Rao").length).toBeGreaterThan(0);
    // Low stock (4) and out of stock (0).
    expect(screen.getByText("4 left")).toBeInTheDocument();
    expect(screen.getByText("Out of stock")).toBeInTheDocument();
    // Status links point at the filtered server list.
    expect(screen.getByRole("link", { name: /Cancelled/ })).toHaveAttribute(
      "href",
      "/admin/orders?status=cancelled",
    );
  });

  it("walks paginated product and order responses without duplicating rows", async () => {
    const secondLowStock = { ...PRODUCT_SECOND, stock: 3 };
    const { requests } = installAdminFetch(({ url }) => {
      const page = Number(url.searchParams.get("page") ?? "1");
      if (url.pathname === "/api/products") {
        const pagination = { ...paginationFor(2, page, 1), totalPages: 2, hasNext: page < 2 };
        return productListResponse(page === 1 ? [PRODUCT] : [secondLowStock], pagination);
      }
      if (url.pathname === "/api/admin/orders") {
        const pagination = { ...paginationFor(2, page, 1), totalPages: 2, hasNext: page < 2 };
        return orderListResponse(page === 1 ? [ORDER_SUMMARY] : [CANCELLED_ORDER], pagination);
      }
      if (url.pathname === "/api/categories") return categoriesResponse();
      return undefined;
    });

    renderWithProviders(<AdminDashboardPage />, { route: "/admin" });

    expect(await screen.findAllByText("BO-260101-CANCELLED")).not.toHaveLength(0);
    expect(screen.getByText("Desk Lamp")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.url.pathname === "/api/products" && request.url.searchParams.get("page") === "2",
        ),
      ).toBe(true);
      expect(
        requests.some(
          (request) =>
            request.url.pathname === "/api/admin/orders" &&
            request.url.searchParams.get("page") === "2",
        ),
      ).toBe(true);
    });
  });

  it("shows honest empty states when the store has no data", async () => {
    basicHandler({
      products: () => productListResponse([], paginationFor(0)),
      orders: () => orderListResponse([], paginationFor(0, 1, 100)),
      categories: () => categoriesResponse([]),
    });

    renderWithProviders(<AdminDashboardPage />, { route: "/admin" });

    expect(await screen.findByText("No orders yet")).toBeInTheDocument();
    expect(screen.getByText("No low-stock products")).toBeInTheDocument();
  });

  it("shows a retryable error instead of fabricated metrics", async () => {
    let fail = true;
    basicHandler({
      products: () => {
        if (fail) return jsonResponse({ success: false, message: "Database unavailable" }, 500);
        return productListResponse();
      },
    });

    renderWithProviders(<AdminDashboardPage />, { route: "/admin" });

    expect(await screen.findByText("Couldn't load the dashboard")).toBeInTheDocument();
    expect(screen.getByText("Database unavailable")).toBeInTheDocument();

    fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Recent orders")).toBeInTheDocument();
  });

  it("surfaces a 403 as a permission problem, not an empty dashboard", async () => {
    basicHandler({
      products: () => jsonResponse({ success: false, message: "Access denied" }, 403),
    });

    renderWithProviders(<AdminDashboardPage />, { route: "/admin" });

    expect(await screen.findByText("Admin access required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-check session" })).toBeInTheDocument();
    expect(screen.queryByText("Recent orders")).not.toBeInTheDocument();
  });
});
