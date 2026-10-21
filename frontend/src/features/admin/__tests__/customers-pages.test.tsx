import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminCustomersPage from "@/pages/admin/customers-page";
import AdminCustomerDetailPage from "@/pages/admin/customer-detail-page";
import {
  CUSTOMER_SUMMARY,
  CUSTOMER_SUMMARY_SECOND,
  customerDetailResponse,
  customerListResponse,
  installAdminFetch,
  paginationFor,
  type MockHandler,
} from "@/test/admin";
import { jsonResponse, renderWithProviders } from "@/test/render";
import { clearToken, setToken } from "@/lib/api";
import { formatPrice } from "@/lib/format";

function installCustomerFetch(overrides: MockHandler = () => undefined) {
  return installAdminFetch((request) => {
    const { url, method } = request;
    const override = overrides(request);
    if (override) return override;

    if (method === "GET" && url.pathname === "/api/admin/customers") {
      return customerListResponse(
        [CUSTOMER_SUMMARY, CUSTOMER_SUMMARY_SECOND],
        paginationFor(2, 1, 20),
      );
    }
    if (method === "GET" && url.pathname === "/api/admin/customers/1") {
      return customerDetailResponse();
    }
    if (method === "GET" && url.pathname === "/api/admin/customers/999") {
      return jsonResponse({ success: false, message: "Customer not found" }, 404);
    }
    return undefined;
  });
}

function renderDetail(route = "/admin/customers/1") {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/customers" element={<p>Customer list</p>} />
      <Route path="/admin/customers/:id" element={<AdminCustomerDetailPage />} />
    </Routes>,
    { route },
  );
}

beforeEach(() => setToken("admin-token"));

afterEach(() => {
  vi.unstubAllGlobals();
  clearToken();
  window.localStorage.clear();
});

describe("AdminCustomersPage", () => {
  it("renders customers with server-computed order counts and spend", async () => {
    installCustomerFetch();
    renderWithProviders(<AdminCustomersPage />, { route: "/admin/customers" });

    expect(await screen.findByRole("heading", { name: "Customers" })).toBeInTheDocument();
    await screen.findAllByText("Anita Rao");
    expect(screen.getAllByText("anita@example.com").length).toBeGreaterThan(0);
    expect(screen.getAllByText(formatPrice(1049)).length).toBeGreaterThan(0);
    expect(screen.getByText("(1 cancelled)")).toBeInTheDocument();

    // Zero-order customers are shown honestly rather than hidden.
    expect(screen.getAllByText("Bilal Khan").length).toBeGreaterThan(0);
    expect(screen.getByText("2 customers")).toBeInTheDocument();
  });

  it("sends the debounced search term and mirrors it into the URL", async () => {
    const user = userEvent.setup();
    const { requests } = installCustomerFetch();
    renderWithProviders(<AdminCustomersPage />, { route: "/admin/customers" });

    await screen.findAllByText("Anita Rao");
    await user.type(screen.getByLabelText("Search"), "bilal");

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("q=bilal");
    });
    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.url.pathname === "/api/admin/customers" &&
            request.url.searchParams.get("q") === "bilal",
        ),
      ).toBe(true);
    });
  });

  it("shows a search-specific empty state", async () => {
    installCustomerFetch(({ url, method }) => {
      if (method === "GET" && url.pathname === "/api/admin/customers" && url.searchParams.get("q")) {
        return customerListResponse([], paginationFor(0, 1, 20));
      }
      return undefined;
    });
    renderWithProviders(<AdminCustomersPage />, { route: "/admin/customers?q=zzz" });

    expect(await screen.findByText("No customers match that search")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Clear search" }).length).toBeGreaterThan(0);
  });

  it("shows a retryable error instead of an empty table", async () => {
    installCustomerFetch(({ url, method }) =>
      method === "GET" && url.pathname === "/api/admin/customers"
        ? jsonResponse({ success: false, message: "Database unavailable" }, 500)
        : undefined,
    );
    renderWithProviders(<AdminCustomersPage />, { route: "/admin/customers" });

    expect(await screen.findByText("Couldn't load customers")).toBeInTheDocument();
    expect(screen.getByText("Database unavailable")).toBeInTheDocument();
  });
});

describe("AdminCustomerDetailPage", () => {
  it("renders the customer overview, addresses and recent orders", async () => {
    installCustomerFetch();
    renderDetail();

    expect(await screen.findByRole("heading", { name: "Anita Rao" })).toBeInTheDocument();
    expect(screen.getAllByText("anita@example.com").length).toBeGreaterThan(0);
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText(/12 MG Road/)).toBeInTheDocument();
    expect(screen.getAllByText("BO-260101-ABC123").length).toBeGreaterThan(0);
    expect(screen.getAllByText(formatPrice(1049)).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "All customers" })).toHaveAttribute(
      "href",
      "/admin/customers",
    );
  });

  it("surfaces a 404 for an unknown customer", async () => {
    installCustomerFetch();
    renderDetail("/admin/customers/999");

    expect(await screen.findByText("Couldn't load this customer")).toBeInTheDocument();
    expect(screen.getByText("Customer not found")).toBeInTheDocument();
  });

  it("rejects a malformed id without calling the API", async () => {
    const { requests } = installCustomerFetch();
    renderDetail("/admin/customers/not-a-number");

    expect(await screen.findByText("Customer not found")).toBeInTheDocument();
    expect(requests.some((request) => request.url.pathname.startsWith("/api/admin/customers/"))).toBe(
      false,
    );
  });
});
