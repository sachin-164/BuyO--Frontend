import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CheckoutPage from "@/pages/checkout-page";
import OrderConfirmationPage from "@/pages/order-confirmation-page";
import { jsonResponse, renderWithProviders } from "@/test/render";
import { clearToken, setToken } from "@/lib/api";
import {
  CHECKOUT_IDEMPOTENCY_KEY,
  clearCheckoutIdempotencyKey,
  getCheckoutIdempotencyKey,
} from "@/lib/idempotency";
import type { AddressListResponse } from "@/types/account";
import type { CartResponse, CheckoutConflict } from "@/types/commerce";

const ADDRESS: AddressListResponse = {
  success: true,
  count: 1,
  addresses: [
    {
      id: 4,
      label: "Home",
      fullName: "Anita Rao",
      phone: "9876543210",
      line1: "12 Rose Street",
      line2: "Kalyani Nagar",
      city: "Pune",
      state: "Maharashtra",
      pincode: "411006",
      isDefault: true,
    },
  ],
};

const CART: CartResponse = {
  success: true,
  count: 1,
  totalsNotice: "Preview only — totals are confirmed at checkout.",
  totals: {
    subtotal: 1000,
    tax: {
      total: 50,
      preview: true,
      byCategory: [
        {
          categoryId: 1,
          categoryName: "Steel",
          taxRate: 5,
          taxableAmount: 1000,
          taxAmount: 50,
        },
      ],
    },
    grandTotal: 1050,
  },
  items: [
    {
      id: 9,
      productId: 3,
      qty: 1,
      name: "Steel Bottle",
      price: 1000,
      image: null,
      lineTotal: 1000,
      stock: 3,
      stockExceeded: false,
      unavailable: false,
    },
  ],
};

const ORDER_RESPONSE = {
  success: true,
  message: "Order placed (Cash on Delivery)",
  order: {
    id: 23,
    orderNumber: "BO-240101-9X8Y7Z",
    status: "placed",
    paymentMethod: "cod",
    subtotal: 1000,
    taxTotal: 50,
    grandTotal: 1050,
    taxBreakdown: [
      {
        categoryId: 1,
        categoryName: "Steel",
        taxRate: 5,
        taxableAmount: 1000,
        taxAmount: 50,
      },
    ],
    createdAt: "2026-01-01T10:00:00.000Z",
    addressId: 4,
    notes: null,
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
    items: [
      {
        id: 3,
        productId: 3,
        name: "Steel Bottle",
        image: null,
        unitPrice: 1000,
        qty: 1,
        lineTotal: 1000,
        taxRate: 5,
        taxAmount: 50,
        categoryName: "Steel",
      },
    ],
    statusEvents: [
      {
        id: 93,
        fromStatus: null,
        toStatus: "placed",
        note: null,
        createdAt: "2026-01-01T10:00:00.000Z",
      },
    ],
  },
};

const CONFLICTS: CheckoutConflict[] = [
  {
    productId: 3,
    name: "Steel Bottle",
    requested: 1,
    available: 0,
    reason: "no longer available",
  },
];

type OrderOutcome = "success" | "conflict" | "busy" | "pending";

interface InstallOptions {
  addresses?: AddressListResponse | null;
  cart?: CartResponse;
  /** Outcomes for each POST /api/orders; the last one repeats. */
  orderOutcomes?: OrderOutcome[];
}

function installFetch({
  addresses = ADDRESS,
  cart = CART,
  orderOutcomes = ["success"],
}: InstallOptions = {}) {
  const requests: Array<{ url: URL; method: string; body?: string }> = [];
  let pendingOrderResolver: ((response: Response) => void) | undefined;
  const pendingOrder = new Promise<Response>((resolve) => {
    pendingOrderResolver = resolve;
  });
  let orderCall = 0;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    requests.push({ url, method, body });

    if (method === "GET" && url.pathname === "/api/auth/me") {
      return jsonResponse({
        success: true,
        user: {
          id: 4,
          name: "Checkout Tester",
          email: "checkout.tester@buyo.test",
          isVerified: true,
          role: "customer",
          isAdmin: false,
        },
      });
    }
    if (method === "GET" && url.pathname === "/api/cart") {
      return jsonResponse(cart);
    }
    if (method === "GET" && url.pathname === "/api/addresses") {
      if (addresses === null) {
        return jsonResponse({ success: false, message: "Server offline" }, 500);
      }
      return jsonResponse(addresses);
    }
    if (method === "POST" && url.pathname === "/api/orders") {
      const outcome = orderOutcomes[Math.min(orderCall, orderOutcomes.length - 1)];
      orderCall += 1;
      switch (outcome) {
        case "pending":
          return pendingOrder;
        case "conflict":
          return jsonResponse(
            {
              success: false,
              message: "Some items in your cart changed — review and try again",
              errors: CONFLICTS,
            },
            409,
          );
        case "busy":
          return jsonResponse({ success: false, message: "Server busy" }, 503);
        default:
          return jsonResponse(ORDER_RESPONSE, 201);
      }
    }
    if (method === "GET" && url.pathname === "/api/orders/23") {
      return jsonResponse(ORDER_RESPONSE);
    }
    return jsonResponse({ success: false, message: "Not found" }, 404);
  });

  vi.stubGlobal("fetch", fetchMock);

  return {
    requests,
    orders: () =>
      requests.filter(
        (request) => request.method === "POST" && request.url.pathname === "/api/orders",
      ),
    resolvePending: () => pendingOrderResolver?.(jsonResponse(ORDER_RESPONSE, 201)),
  };
}

function renderCheckout() {
  return renderWithProviders(
    <Routes>
      <Route path="/checkout" element={<CheckoutPage />} />
      <Route path="/checkout/confirmation/:id" element={<OrderConfirmationPage />} />
    </Routes>,
    { route: "/checkout" },
  );
}

describe("CheckoutPage", () => {
  beforeEach(() => setToken("checkout-page-test-token"));

  afterEach(() => {
    vi.unstubAllGlobals();
    clearToken();
    clearCheckoutIdempotencyKey();
    window.sessionStorage.clear();
  });

  it("selects the default address and places an idempotent COD order", async () => {
    const user = userEvent.setup();
    const fetch = installFetch();

    renderCheckout();

    const placeButton = await screen.findByRole("button", {
      name: /Place COD order/i,
    });
    expect(placeButton).toBeEnabled();

    await user.click(placeButton);

    await waitFor(() => expect(fetch.orders()).toHaveLength(1));
    const payload = JSON.parse(fetch.orders()[0]?.body ?? "{}");
    expect(payload.addressId).toBe(4);
    expect(payload.idempotencyKey).toMatch(/^[A-F0-9]{32}$/i);
    expect(payload).not.toHaveProperty("notes");

    expect(await screen.findByText("Thanks! Order placed")).toBeInTheDocument();
    expect(screen.getAllByText(/BO-240101-9X8Y7Z/).length).toBeGreaterThan(0);

    await waitFor(() => {
      // The key is consumed only after the server accepts the order.
      expect(window.sessionStorage.getItem(CHECKOUT_IDEMPOTENCY_KEY)).toBeNull();
      expect(getCheckoutIdempotencyKey()).not.toBe(payload.idempotencyKey);
    });
  });

  it("keeps the same idempotency key across a retry after a transient failure", async () => {
    const user = userEvent.setup();
    const key = getCheckoutIdempotencyKey();
    const fetch = installFetch({ orderOutcomes: ["busy", "success"] });

    renderCheckout();

    const placeButton = await screen.findByRole("button", {
      name: /Place COD order/i,
    });
    await user.click(placeButton);

    await waitFor(() => expect(fetch.orders()).toHaveLength(1));
    // A rejected attempt must not consume the key.
    expect(getCheckoutIdempotencyKey()).toBe(key);
    expect(window.sessionStorage.getItem(CHECKOUT_IDEMPOTENCY_KEY)).toBe(key);

    expect(await screen.findByText("Order could not be placed")).toBeInTheDocument();
    expect(placeButton).toBeEnabled();

    await user.click(placeButton);
    await waitFor(() => expect(fetch.orders()).toHaveLength(2));

    const retryPayload = JSON.parse(fetch.orders()[1]?.body ?? "{}");
    expect(retryPayload.idempotencyKey).toBe(key);
    expect(await screen.findByText("Thanks! Order placed")).toBeInTheDocument();
    expect(window.sessionStorage.getItem(CHECKOUT_IDEMPOTENCY_KEY)).toBeNull();
  });

  it("does not submit a second order while one request is open", async () => {
    const user = userEvent.setup();
    const fetch = installFetch({ orderOutcomes: ["pending"] });
    renderCheckout();

    const placeButton = await screen.findByRole("button", {
      name: /Place COD order/i,
    });

    await user.click(placeButton);
    await user.click(screen.getByRole("button", { name: /Place COD order/i }));

    await waitFor(() => expect(fetch.orders()).toHaveLength(1));

    act(() => {
      fetch.resolvePending();
    });
    expect(await screen.findByText("Thanks! Order placed")).toBeInTheDocument();
  });

  it("surfaces server conflicts and keeps the retry key", async () => {
    const user = userEvent.setup();
    const fetch = installFetch({ orderOutcomes: ["conflict"] });
    renderCheckout();

    const placeButton = await screen.findByRole("button", {
      name: /Place COD order/i,
    });
    await user.click(placeButton);

    await screen.findByText(/Some items changed/);
    expect(screen.getByText(/Steel Bottle: no longer available/i)).toBeInTheDocument();
    expect(placeButton).toBeEnabled();
    expect(fetch.orders()).toHaveLength(1);
    // The server rejected the request, so the key is still the same attempt.
    expect(JSON.parse(fetch.orders()[0]?.body ?? "{}").idempotencyKey).toBe(
      getCheckoutIdempotencyKey(),
    );
  });

  it("blocks checkout without an address", async () => {
    installFetch({ addresses: { success: true, count: 0, addresses: [] } });
    renderCheckout();

    await screen.findByText(/No delivery address yet/i);
    expect(screen.getByRole("button", { name: /Place COD order/i })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Add delivery address/i }),
    ).toBeInTheDocument();
  });

  it("blocks checkout when the cart includes stock problems", async () => {
    installFetch({
      cart: {
        ...CART,
        items: [
          {
            ...CART.items[0],
            qty: 5,
            stock: 0,
            stockExceeded: true,
          },
        ],
      },
    });
    renderCheckout();

    // The checkout page shows the summary, not item names.
    const placeButton = await screen.findByRole("button", {
      name: /Place COD order/i,
    });
    await waitFor(() => expect(placeButton).toBeDisabled());
    expect(screen.getByText(/Cart not valid for checkout/)).toBeInTheDocument();
  });

  it("keeps the place button disabled while notes exceed the server limit", async () => {
    const user = userEvent.setup();
    installFetch();
    renderCheckout();

    const notes = await screen.findByLabelText(/Delivery notes/i);
    await user.clear(notes);
    await user.type(notes, "Gate code 4412");

    expect(screen.getByRole("button", { name: /Place COD order/i })).toBeEnabled();
    act(() => {
      fireEvent.change(notes, { target: { value: "a".repeat(501) } });
    });

    expect(screen.getByRole("button", { name: /Place COD order/i })).toBeDisabled();
    expect(
      screen.getByText(/Notes must be 500 characters or fewer/i),
    ).toBeInTheDocument();
  });
});
