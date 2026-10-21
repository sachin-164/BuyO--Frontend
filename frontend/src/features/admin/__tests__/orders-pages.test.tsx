import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminOrdersPage from "@/pages/admin/orders-page";
import AdminOrderDetailPage from "@/pages/admin/order-detail-page";
import {
  ORDER_DETAIL,
  ORDER_SUMMARY,
  installAdminFetch,
  orderDetailResponse,
  orderListResponse,
  paginationFor,
  type MockHandler,
} from "@/test/admin";
import { jsonResponse, renderWithProviders } from "@/test/render";
import { clearToken, setToken } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import type { AdminOrder } from "@/types/admin";

function installOrderFetch(overrides: MockHandler = () => undefined) {
  let currentOrder: AdminOrder = ORDER_DETAIL;
  return installAdminFetch((request) => {
    const { url, method } = request;

    const override = overrides(request);
    if (override) return override;

    if (method === "GET" && url.pathname === "/api/admin/orders") {
      const status = url.searchParams.get("status");
      const orders = status
        ? [ORDER_SUMMARY].map((order) => ({ ...order, status })) as typeof ORDER_SUMMARY[]
        : [ORDER_SUMMARY];
      return orderListResponse(orders, paginationFor(orders.length, 1, 20));
    }
    if (method === "GET" && url.pathname === "/api/admin/orders/23") {
      return orderDetailResponse(currentOrder);
    }
    if (method === "GET" && url.pathname === "/api/admin/orders/999") {
      return jsonResponse({ success: false, message: "Order not found" }, 404);
    }
    if (method === "PUT" && url.pathname === "/api/admin/orders/23/status") {
      const body = JSON.parse(request.body ?? "{}") as { status: AdminOrder["status"]; note?: string };
      currentOrder = {
        ...currentOrder,
        status: body.status,
        statusEvents: [
          ...currentOrder.statusEvents,
          {
            id: 99,
            fromStatus: currentOrder.status,
            toStatus: body.status,
            note: body.note ?? null,
            createdAt: "2026-01-06T09:00:00.000Z",
          },
        ],
      };
      return jsonResponse({
        success: true,
        message: `Order marked ${body.status}`,
        order: currentOrder,
      });
    }
    return undefined;
  });
}

function renderDetail(route = "/admin/orders/23") {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/orders" element={<p>Order list</p>} />
      <Route path="/admin/orders/:id" element={<AdminOrderDetailPage />} />
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

describe("AdminOrdersPage", () => {
  it("renders order rows with customer, totals and status", async () => {
    installOrderFetch();
    renderWithProviders(<AdminOrdersPage />, { route: "/admin/orders" });

    expect(await screen.findByRole("heading", { name: "Orders" })).toBeInTheDocument();
    await screen.findAllByText("BO-260101-ABC123");
    expect(screen.getAllByText("BO-260101-ABC123").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Anita Rao").length).toBeGreaterThan(0);
    expect(screen.getAllByText("anita@example.com").length).toBeGreaterThan(0);
    expect(screen.getAllByText(formatPrice(1049)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Confirmed").length).toBeGreaterThan(0);
    expect(screen.getByText("1 order")).toBeInTheDocument();
  });

  it("filters the server by status and clears the filter", async () => {
    const user = userEvent.setup();
    const { requests } = installOrderFetch(({ url, method }) => {
      if (method === "GET" && url.pathname === "/api/admin/orders" && url.searchParams.get("status")) {
        return orderListResponse([], paginationFor(0, 1, 20));
      }
      return undefined;
    });
    renderWithProviders(<AdminOrdersPage />, { route: "/admin/orders" });

    await screen.findAllByText("BO-260101-ABC123");
    await user.selectOptions(screen.getByLabelText("Status"), "shipped");

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("status=shipped");
    });
    expect(await screen.findByText("No shipped orders")).toBeInTheDocument();
    expect(
      requests.some(
        (request) =>
          request.url.pathname === "/api/admin/orders" &&
          request.url.searchParams.get("status") === "shipped",
      ),
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => {
      expect(screen.getByTestId("location")).not.toHaveTextContent("status=");
    });
  });

  it("searches by free text and keeps the term in pagination links", async () => {
    const user = userEvent.setup();
    const { requests } = installOrderFetch(({ url, method }) => {
      if (method !== "GET" || url.pathname !== "/api/admin/orders") return undefined;
      if (url.searchParams.get("q")) {
        return orderListResponse([ORDER_SUMMARY], {
          page: 1,
          limit: 20,
          total: 45,
          totalPages: 3,
          hasNext: true,
          hasPrev: false,
        });
      }
      return undefined;
    });
    renderWithProviders(<AdminOrdersPage />, { route: "/admin/orders" });

    await screen.findAllByText("BO-260101-ABC123");
    await user.type(screen.getByLabelText("Search"), "anita");

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("q=anita");
    });
    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.url.pathname === "/api/admin/orders" &&
            request.url.searchParams.get("q") === "anita",
        ),
      ).toBe(true);
    });

    // The term survives pagination, so the admin does not lose their search.
    expect(await screen.findByRole("link", { name: "Page 2" })).toHaveAttribute(
      "href",
      "/admin/orders?q=anita&page=2",
    );
  });

  it("preserves the status filter in server pagination links", async () => {
    installOrderFetch(({ url, method }) => {
      if (method === "GET" && url.pathname === "/api/admin/orders") {
        return orderListResponse([ORDER_SUMMARY], {
          page: 2,
          limit: 20,
          total: 45,
          totalPages: 3,
          hasNext: true,
          hasPrev: true,
        });
      }
      return undefined;
    });
    renderWithProviders(<AdminOrdersPage />, {
      route: "/admin/orders?page=2&status=confirmed",
    });

    await screen.findAllByText("BO-260101-ABC123");
    expect(screen.getByLabelText("Status")).toHaveValue("confirmed");
    expect(screen.getByRole("link", { name: "Page 3" })).toHaveAttribute(
      "href",
      "/admin/orders?status=confirmed&page=3",
    );
    expect(screen.getByRole("link", { name: "Previous page" })).toHaveAttribute(
      "href",
      "/admin/orders?status=confirmed",
    );
    expect(screen.getByRole("link", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  });

  it("shows a permission error without rendering an empty queue", async () => {
    installOrderFetch(({ url, method }) => {
      if (method === "GET" && url.pathname === "/api/admin/orders") {
        return jsonResponse({ success: false, message: "Access denied" }, 403);
      }
      return undefined;
    });
    renderWithProviders(<AdminOrdersPage />, { route: "/admin/orders" });

    expect(await screen.findByText("Admin access required")).toBeInTheDocument();
    expect(screen.queryByText("No orders yet")).not.toBeInTheDocument();
  });
});

describe("AdminOrderDetailPage", () => {
  it("shows items, customer, address, notes, totals and only permitted transitions", async () => {
    installOrderFetch();
    renderDetail();

    expect(
      await screen.findByRole("heading", { name: "Order BO-260101-ABC123" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Anita Rao").length).toBeGreaterThan(0);
    expect(screen.getByText("anita@example.com")).toBeInTheDocument();
    expect(screen.getByText("12 MG Road")).toBeInTheDocument();
    expect(screen.getByText("Bengaluru, Karnataka 560001")).toBeInTheDocument();
    expect(screen.getByText("Leave with the security desk.")).toBeInTheDocument();
    expect(screen.getByText("Payment/stock checked by admin.")).toBeInTheDocument();
    expect(screen.getAllByText(formatPrice(1049)).length).toBeGreaterThan(0);
    expect(screen.getByText("Steel (5%)")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Mark shipped" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm order" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark delivered" })).not.toBeInTheDocument();
  });

  it("confirms cancellation, sends the note and updates the timeline", async () => {
    const user = userEvent.setup();
    const { requests } = installOrderFetch();
    renderDetail();

    await screen.findByRole("heading", { name: "Order BO-260101-ABC123" });
    await user.type(screen.getByLabelText(/Status note/), "Customer requested cancellation");
    await user.click(screen.getByRole("button", { name: "Cancel order" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Cancel this order?")).toBeInTheDocument();
    expect(within(dialog).getByText(/restocked once/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel order" }));

    expect(await screen.findByText("Order status updated")).toBeInTheDocument();
    expect(await screen.findByText("Order cancelled")).toBeInTheDocument();
    expect(screen.getAllByText("Cancelled").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Mark shipped" })).not.toBeInTheDocument();

    const update = requests.find(
      (request) => request.method === "PUT" && request.url.pathname === "/api/admin/orders/23/status",
    );
    expect(JSON.parse(update?.body ?? "{}")).toEqual({
      status: "cancelled",
      note: "Customer requested cancellation",
    });
  });

  it("reports a 409 conflict and refreshes the order from the server", async () => {
    const user = userEvent.setup();
    const { requests } = installOrderFetch(({ url, method }) => {
      if (method === "PUT" && url.pathname === "/api/admin/orders/23/status") {
        return jsonResponse(
          { success: false, message: "Order was already shipped by another admin" },
          409,
        );
      }
      return undefined;
    });
    renderDetail();

    await screen.findByRole("heading", { name: "Order BO-260101-ABC123" });
    await user.click(screen.getByRole("button", { name: "Mark shipped" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Mark shipped" }),
    );

    expect(await screen.findByText("Couldn't update the order")).toBeInTheDocument();
    expect(screen.getByText("Order was already shipped by another admin")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        requests.filter(
          (request) =>
            request.method === "GET" &&
            request.url.pathname === "/api/admin/orders/23",
        ).length,
      ).toBeGreaterThan(1);
    });
  });

  it("renders terminal states without invented actions", async () => {
    installOrderFetch(({ url, method }) => {
      if (method === "GET" && url.pathname === "/api/admin/orders/23") {
        return orderDetailResponse({
          ...ORDER_DETAIL,
          status: "delivered",
          statusEvents: [
            ...ORDER_DETAIL.statusEvents,
            {
              id: 3,
              fromStatus: "shipped",
              toStatus: "delivered",
              note: null,
              createdAt: "2026-01-07T09:00:00.000Z",
            },
          ],
        });
      }
      return undefined;
    });
    renderDetail();

    expect(await screen.findByText("Order delivered")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark delivered" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel order" })).not.toBeInTheDocument();
  });

  it("handles invalid and missing order links without extra requests", async () => {
    const { requests } = installOrderFetch();
    const { unmount } = renderDetail("/admin/orders/abc");
    expect(await screen.findByText("Invalid order link")).toBeInTheDocument();
    expect(
      requests.filter((request) => request.url.pathname.startsWith("/api/admin/orders/")).length,
    ).toBe(0);
    unmount();

    installOrderFetch();
    renderDetail("/admin/orders/999");
    expect(await screen.findByText("Order not found")).toBeInTheDocument();
  });

  it("shows a permission error from the detail endpoint", async () => {
    installOrderFetch(({ url, method }) => {
      if (method === "GET" && url.pathname === "/api/admin/orders/23") {
        return jsonResponse({ success: false, message: "Access denied" }, 403);
      }
      return undefined;
    });
    renderDetail();
    expect(await screen.findByText("Admin access required")).toBeInTheDocument();
  });
});
