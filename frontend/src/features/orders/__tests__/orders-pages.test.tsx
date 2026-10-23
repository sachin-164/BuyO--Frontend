import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";
import OrdersPage from "@/pages/orders-page";
import OrderDetailPage from "@/pages/order-detail-page";
import { RequireAuth } from "@/features/auth/guards";
import { jsonResponse, renderWithProviders } from "@/test/render";
import { clearToken, getToken, setToken } from "@/lib/api";
import type {
  Order,
  OrderListResponse,
  OrderSummary,
} from "@/types/commerce";

const ORDER_SUMMARY: OrderSummary = {
  id: 23,
  orderNumber: "BO-240101-9X8Y7Z",
  status: "confirmed",
  paymentMethod: "cod",
  subtotal: 1000,
  taxTotal: 50,
  grandTotal: 1050,
  createdAt: "2026-01-01T10:00:00.000Z",
  canCancel: true,
  items: [
    {
      id: 3,
      productId: 3,
      variantId: 41,
      variantSku: "BTL-STL-1L",
      variantSize: "1 L",
      variantColor: "Steel",
      variantPriceAdjustment: 0,
      name: "Steel Bottle",
      unitPrice: 1000,
      qty: 1,
      lineTotal: 1000,
    },
  ],
};

const ORDERS_LIST: OrderListResponse = {
  success: true,
  count: 1,
  orders: [ORDER_SUMMARY],
  pagination: {
    page: 1,
    limit: 10,
    total: 1,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  },
};

const ORDER_DETAIL: Order = {
  ...ORDER_SUMMARY,
  taxBreakdown: [
    {
      categoryId: 1,
      categoryName: "Steel",
      taxRate: 5,
      taxableAmount: 1000,
      taxAmount: 50,
    },
  ],
  shippingAddress: {
    label: "Home",
    fullName: "Anita Rao",
    phone: "9876543210",
    line1: "12 Rose Street",
    line2: null,
    city: "Pune",
    state: "Maharashtra",
    pincode: "411006",
  },
  addressId: 4,
  notes: "Ring the bell twice.",
  statusEvents: [
    {
      id: 93,
      fromStatus: null,
      toStatus: "placed",
      note: null,
      createdAt: "2026-01-01T10:00:00.000Z",
    },
    {
      id: 94,
      fromStatus: "placed",
      toStatus: "confirmed",
      note: "Payment on delivery accepted",
      createdAt: "2026-01-02T09:30:00.000Z",
    },
  ],
};

function installFetch({
  list = ORDERS_LIST,
  listStatus = 200,
  detail = ORDER_DETAIL,
  detailStatus = 200,
  cancelStatus = 200,
} = {}) {
  const requests: Array<{ url: URL; method: string }> = [];
  const cancelledDetail: Order = {
    ...detail,
    status: "cancelled",
    canCancel: false,
    statusEvents: [
      ...detail.statusEvents,
      {
        id: 95,
        fromStatus: detail.status,
        toStatus: "cancelled",
        note: "Cancelled by customer",
        createdAt: "2026-01-03T11:00:00.000Z",
      },
    ],
  };
  let currentDetail = detail;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    requests.push({ url, method });

    if (method === "GET" && url.pathname === "/api/auth/me") {
      return jsonResponse({
        success: true,
        user: {
          id: 1,
          name: "Anita Rao",
          email: "anita@example.com",
          isVerified: true,
          role: "customer",
          isAdmin: false,
        },
      });
    }
    if (method === "GET" && url.pathname === "/api/orders") {
      if (listStatus >= 400) {
        return jsonResponse({ success: false, message: "Orders failed" }, listStatus);
      }
      return jsonResponse(list);
    }
    if (method === "GET" && /^\/api\/orders\/\d+$/.test(url.pathname)) {
      if (detailStatus >= 400) {
        return jsonResponse({ success: false, message: "Order not found" }, detailStatus);
      }
      return jsonResponse({ success: true, order: currentDetail });
    }
    if (method === "POST" && /^\/api\/orders\/\d+\/cancel$/.test(url.pathname)) {
      if (cancelStatus >= 400) {
        return jsonResponse(
          {
            success: false,
            message:
              cancelStatus === 409
                ? "Cannot change order status from 'shipped' to 'cancelled'"
                : "Order could not be cancelled",
          },
          cancelStatus,
        );
      }
      currentDetail = cancelledDetail;
      return jsonResponse({
        success: true,
        message: "Order cancelled",
        order: cancelledDetail,
      });
    }
    return jsonResponse({ success: false, message: "Not found" }, 404);
  });

  vi.stubGlobal("fetch", fetchMock);
  return requests;
}

describe("OrdersPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearToken();
    window.localStorage.clear();
  });

  it("renders the order history with server pagination state", async () => {
    const requests = installFetch();
    renderWithProviders(<OrdersPage />, { route: "/orders" });

    expect(await screen.findByText("BO-240101-9X8Y7Z")).toBeInTheDocument();
    // The status badge (not the hidden <option> in the filter select).
    expect(screen.getAllByText("Confirmed").length).toBeGreaterThan(0);
    expect(screen.getByText("₹1,050")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View details" })).toHaveAttribute(
      "href",
      "/orders/23",
    );
    expect(
      requests.filter((request) => request.url.pathname === "/api/orders"),
    ).toHaveLength(1);
  });

  it("sends the status filter and resets to page 1", async () => {
    const user = userEvent.setup();
    const requests = installFetch();
    renderWithProviders(<OrdersPage />, { route: "/orders" });

    await screen.findByText("BO-240101-9X8Y7Z");
    await user.selectOptions(screen.getByLabelText(/Filter orders by status/i), "delivered");

    await waitFor(() => {
      const listRequests = requests.filter(
        (request) =>
          request.url.pathname === "/api/orders" && request.url.search.includes("status=delivered"),
      );
      expect(listRequests).toHaveLength(1);
    });
    expect(screen.getByTestId("location")).toHaveTextContent("status=delivered");
  });

  it("shows an empty state when the account has no orders", async () => {
    installFetch({
      list: {
        success: true,
        count: 0,
        orders: [],
        pagination: {
          page: 1,
          limit: 10,
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false,
        },
      },
    });
    renderWithProviders(<OrdersPage />, { route: "/orders" });

    expect(await screen.findByText("No orders yet")).toBeInTheDocument();
    expect(
      screen.getByText(/Complete a COD checkout to see your order history here\./i),
    ).toBeInTheDocument();
  });

  it("reports a failed order list and offers a retry", async () => {
    installFetch({ listStatus: 500 });
    renderWithProviders(<OrdersPage />, { route: "/orders" });

    expect(await screen.findByText("Orders could not be loaded")).toBeInTheDocument();
    expect(screen.getByText("Orders failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows a cancel action only for orders the server marks cancellable", async () => {
    installFetch();
    renderWithProviders(<OrdersPage />, { route: "/orders" });

    await screen.findByText("BO-240101-9X8Y7Z");
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeInTheDocument();
  });

  it("hides the cancel action when the server says the order is no longer cancellable", async () => {
    installFetch({
      list: {
        ...ORDERS_LIST,
        orders: [{ ...ORDER_SUMMARY, status: "shipped", canCancel: false }],
      },
    });
    renderWithProviders(<OrdersPage />, { route: "/orders" });

    await screen.findByText("BO-240101-9X8Y7Z");
    expect(screen.queryByRole("button", { name: "Cancel order" })).toBeNull();
  });

  it("paginates with links that preserve the status filter", async () => {
    installFetch({
      list: {
        ...ORDERS_LIST,
        pagination: {
          page: 2,
          limit: 10,
          total: 12,
          totalPages: 2,
          hasNext: false,
          hasPrev: true,
        },
      },
    });
    renderWithProviders(<OrdersPage />, { route: "/orders?status=placed&page=2" });

    await screen.findByText("BO-240101-9X8Y7Z");
    expect(screen.getByRole("link", { name: "Previous page" })).toHaveAttribute(
      "href",
      "/orders?status=placed",
    );
    expect(screen.getByRole("link", { name: "Page 1" })).toHaveAttribute(
      "href",
      "/orders?status=placed",
    );
  });
});

describe("OrderDetailPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearToken();
    window.localStorage.clear();
  });

  function renderOrderDetail(route: string) {
    return renderWithProviders(
      <Routes>
        <Route path="/orders/:id" element={<OrderDetailPage />} />
        <Route path="/orders" element={<p>Order history</p>} />
      </Routes>,
      { route },
    );
  }

  it("rejects non-numeric order ids without a request", () => {
    const requests = installFetch();
    renderOrderDetail("/orders/abc");

    expect(
      screen.getByText(/is not a valid order identifier/i),
    ).toBeInTheDocument();
    expect(requests.filter((request) => request.url.pathname.startsWith("/api/orders"))).toHaveLength(0);
  });

  it("shows a not-found state scoped to the account", async () => {
    installFetch({ detailStatus: 404 });
    renderOrderDetail("/orders/999");

    expect(await screen.findByText("Order not found")).toBeInTheDocument();
    expect(
      screen.getByText(/The server strictly scopes order access by user\./i),
    ).toBeInTheDocument();
  });

  it("renders items, totals, address snapshot and the real status timeline", async () => {
    const requests = installFetch();
    renderOrderDetail("/orders/23");

    expect(await screen.findByText("BO-240101-9X8Y7Z")).toBeInTheDocument();
    expect(screen.getByText("Steel Bottle")).toBeInTheDocument();
    expect(screen.getByText("Size 1 L · Colour Steel")).toBeInTheDocument();
    expect(screen.getByText("SKU BTL-STL-1L")).toBeInTheDocument();
    expect(screen.getByText("₹1,050")).toBeInTheDocument();
    expect(screen.getByText("12 Rose Street")).toBeInTheDocument();
    expect(screen.getByText("Ring the bell twice.")).toBeInTheDocument();

    // Both recorded events, and only those — no invented future steps.
    expect(screen.getByText("Order placed")).toBeInTheDocument();
    expect(
      screen.getByText(/Status moved from Placed to Confirmed/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Payment on delivery accepted/i)).toBeInTheDocument();
    expect(screen.queryByText(/Shipped/i)).toBeNull();
    expect(screen.getAllByText("Confirmed")).toHaveLength(1);

    expect(
      requests.find((request) => request.url.pathname === "/api/orders/23"),
    ).toBeDefined();
  });

  it("cancels an eligible order through the confirm dialog and shows the new status", async () => {
    const user = userEvent.setup();
    const requests = installFetch();
    renderOrderDetail("/orders/23");

    await screen.findByText("BO-240101-9X8Y7Z");
    await user.click(screen.getByRole("button", { name: "Cancel order" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/returns every item to stock/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/no payment has been collected/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel order" }));

    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.method === "POST" && request.url.pathname === "/api/orders/23/cancel",
        ),
      ).toBe(true);
    });

    // The cached detail was replaced by the server's returned order graph.
    expect((await screen.findAllByText("Order cancelled")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Cancelled by customer/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel order" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the dialog and re-reads the order when the server reports a conflict", async () => {
    const user = userEvent.setup();
    const requests = installFetch({ cancelStatus: 409 });
    renderOrderDetail("/orders/23");

    await screen.findByText("BO-240101-9X8Y7Z");
    await user.click(screen.getByRole("button", { name: "Cancel order" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel order" }));

    expect(
      await screen.findByText("This order can no longer be cancelled"),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // It refetches instead of assuming the order was cancelled.
    await waitFor(() => {
      expect(
        requests.filter(
          (request) => request.method === "GET" && request.url.pathname === "/api/orders/23",
        ).length,
      ).toBeGreaterThan(1);
    });
    expect(screen.queryByText(/Cancelled by customer/i)).toBeNull();
  });

  it("keeps the dialog open and explains a non-conflict failure", async () => {
    const user = userEvent.setup();
    installFetch({ cancelStatus: 500 });
    renderOrderDetail("/orders/23");

    await screen.findByText("BO-240101-9X8Y7Z");
    await user.click(screen.getByRole("button", { name: "Cancel order" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel order" }));

    expect(await screen.findByText("The order could not be cancelled")).toBeInTheDocument();
    expect(screen.getByText("Order could not be cancelled")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows the cancellation explanation and no action for a cancelled order", async () => {
    installFetch({ detail: { ...ORDER_DETAIL, status: "cancelled", canCancel: false } });
    renderOrderDetail("/orders/23");

    expect(await screen.findByText("Order cancelled")).toBeInTheDocument();
    expect(screen.getByText(/its items were returned to stock/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel order" })).toBeNull();
  });

  it("clears the session and redirects when the orders API rejects the token", async () => {
    setToken("stale-token");
    installFetch({ listStatus: 401, detailStatus: 401 });
    renderWithProviders(
      <Routes>
        <Route
          path="/orders"
          element={
            <RequireAuth>
              <OrdersPage />
            </RequireAuth>
          }
        />
        <Route path="/login" element={<p>Login page</p>} />
      </Routes>,
      { route: "/orders" },
    );

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/login?next=%2Forders");
    });
    expect(getToken()).toBeNull();
  });
});
