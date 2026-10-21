import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminDashboardPage from "@/pages/admin/dashboard-page";
import {
  ANALYTICS_SUMMARY,
  analyticsResponse,
  installAdminFetch,
} from "@/test/admin";
import { jsonResponse, renderWithProviders } from "@/test/render";
import { clearToken, setToken } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import type { AdminAnalyticsSummary } from "@/types/admin";

beforeEach(() => {
  setToken("admin-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearToken();
  window.localStorage.clear();
});

function dashboardHandler(overrides?: {
  analytics?: () => Response;
}) {
  return installAdminFetch(({ url, method }) => {
    if (method !== "GET") return undefined;
    if (url.pathname === "/api/admin/analytics/summary") {
      return overrides?.analytics?.() ?? analyticsResponse();
    }
    return undefined;
  });
}

describe("AdminDashboardPage", () => {
  it("renders server aggregates in a single analytics request", async () => {
    const { requests } = dashboardHandler();
    renderWithProviders(<AdminDashboardPage />, { route: "/admin" });

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();

    // Totals come straight from the aggregate response.
    expect(await screen.findByText("Customers")).toBeInTheDocument();
    expect(screen.getByText("Average order")).toBeInTheDocument();
    expect(screen.getByText("Top products")).toBeInTheDocument();
    expect(screen.getByText("Orders by status")).toBeInTheDocument();
    expect(screen.getByText("Low stock")).toBeInTheDocument();
    expect(screen.getByText("Recent orders")).toBeInTheDocument();

    // Non-cancelled gross value only (1049, never a value that includes the
    // cancelled order's 500).
    expect(screen.getAllByText(formatPrice(1049)).length).toBeGreaterThan(0);

    // Real recent order + customer from the aggregate payload.
    expect(screen.getAllByText("BO-260101-ABC123").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Anita Rao").length).toBeGreaterThan(0);

    // Low stock uses the server's product name and stock count.
    expect(screen.getByText("4 left")).toBeInTheDocument();
    expect(screen.getByText("1 out of stock")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /Cancelled/ })).toHaveAttribute(
      "href",
      "/admin/orders?status=cancelled",
    );
    expect(screen.getByRole("link", { name: /Customers/ })).toHaveAttribute(
      "href",
      "/admin/customers",
    );

    // Exactly one analytics request: no capped product/order page walking.
    expect(requests.filter((request) => request.url.pathname.startsWith("/api/admin/analytics"))).toHaveLength(1);
    expect(requests.some((request) => request.url.pathname === "/api/products")).toBe(false);
    expect(requests.some((request) => request.url.pathname === "/api/admin/orders")).toBe(false);

    // The truncation caveat of the old client-side aggregation is gone.
    expect(screen.queryByText(/has no aggregate analytics endpoint/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/first .* products/i)).not.toBeInTheDocument();
  });

  it("keeps status counts for every lifecycle state, including zeroes", async () => {
    dashboardHandler();
    renderWithProviders(<AdminDashboardPage />, { route: "/admin" });

    for (const label of ["Placed", "Confirmed", "Shipped", "Delivered", "Cancelled"]) {
      expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
    }
  });

  it("switches the revenue range and refetches with the new window", async () => {
    const { requests } = dashboardHandler();
    renderWithProviders(<AdminDashboardPage />, { route: "/admin" });

    expect(await screen.findByRole("heading", { name: "Revenue" })).toBeInTheDocument();
    const range = screen.getByRole("group", { name: "Revenue range" });
    expect(range).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "7 days" }));

    expect((await screen.findAllByText(formatPrice(1049))).length).toBeGreaterThan(0);
    expect(
      requests.some(
        (request) =>
          request.url.pathname === "/api/admin/analytics/summary" &&
          request.url.searchParams.get("days") === "7",
      ),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows honest empty states when the store has no data", async () => {
    const empty: AdminAnalyticsSummary = {
      ...ANALYTICS_SUMMARY,
      products: { ...ANALYTICS_SUMMARY.products, total: 0, outOfStock: 0, lowStockCount: 0, lowStock: [] },
      categories: { total: 0 },
      customers: { total: 0, newInRange: 0 },
      orders: {
        total: 0,
        byStatus: { placed: 0, confirmed: 0, shipped: 0, delivered: 0, cancelled: 0 },
        nonCancelledCount: 0,
        grossOrderValue: 0,
        averageOrderValue: 0,
      },
      revenueSeries: [],
      topProducts: [],
      recentOrders: [],
    };
    dashboardHandler({ analytics: () => analyticsResponse(empty) });

    renderWithProviders(<AdminDashboardPage />, { route: "/admin" });

    expect(await screen.findByText("No orders yet")).toBeInTheDocument();
    expect(screen.getByText("No low-stock products")).toBeInTheDocument();
    expect(screen.getByText("No revenue recorded in this range.")).toBeInTheDocument();
    expect(screen.getByText(/No sales recorded yet/)).toBeInTheDocument();
  });

  it("shows a retryable error instead of fabricated metrics", async () => {
    let fail = true;
    dashboardHandler({
      analytics: () => {
        if (fail) return jsonResponse({ success: false, message: "Database unavailable" }, 500);
        return analyticsResponse();
      },
    });

    renderWithProviders(<AdminDashboardPage />, { route: "/admin" });

    expect(await screen.findByText("Couldn't load the dashboard")).toBeInTheDocument();
    expect(screen.getByText("Database unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Recent orders")).not.toBeInTheDocument();

    fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Recent orders")).toBeInTheDocument();
  });

  it("surfaces a 403 as a permission problem, not an empty dashboard", async () => {
    dashboardHandler({
      analytics: () => jsonResponse({ success: false, message: "Access denied" }, 403),
    });

    renderWithProviders(<AdminDashboardPage />, { route: "/admin" });

    expect(await screen.findByText("Admin access required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-check session" })).toBeInTheDocument();
    expect(screen.queryByText("Recent orders")).not.toBeInTheDocument();
  });
});
