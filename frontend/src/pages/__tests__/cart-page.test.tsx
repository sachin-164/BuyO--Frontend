import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CartPage from "@/pages/cart-page";
import { jsonResponse, renderWithProviders } from "@/test/render";
import type { CartResponse } from "@/types/commerce";

function item(overrides: Partial<CartResponse["items"][number]> = {}) {
  return {
    id: 11,
    productId: 1,
    qty: 2,
    name: "Test Lamp",
    price: 500,
    image: null,
    lineTotal: 1000,
    stock: 3,
    stockExceeded: false,
    unavailable: false,
    ...overrides,
  };
}

function totalsFor(subtotal: number): CartResponse["totals"] {
  const taxAmount = Math.round(subtotal * 0.05 * 100) / 100;
  return {
    subtotal,
    tax: {
      total: taxAmount,
      preview: true,
      byCategory: [
        {
          categoryId: 1,
          categoryName: "Lighting",
          taxRate: 5,
          taxableAmount: subtotal,
          taxAmount,
        },
      ],
    },
    grandTotal: Math.round((subtotal + taxAmount) * 100) / 100,
  };
}

const INITIAL_CART: CartResponse = {
  success: true,
  count: 1,
  totalsNotice: "Preview only — totals are confirmed at checkout.",
  totals: totalsFor(1000),
  items: [item()],
};

const OVER_STOCK_CART: CartResponse = {
  ...INITIAL_CART,
  items: [
    item({ qty: 5, lineTotal: 2500, stock: 3, stockExceeded: true }),
  ],
  totals: totalsFor(2500),
};

/**
 * The mock keeps mutable cart state so GET refetches (triggered by mutation
 * invalidation) behave like the real server and never roll the UI back.
 */
function installFetch({
  initialCart = INITIAL_CART,
  putStatus = 200,
  deleteStatus = 200,
}: {
  initialCart?: CartResponse;
  putStatus?: number;
  deleteStatus?: number;
} = {}) {
  const requests: Array<{ url: URL; method: string; body?: string }> = [];
  let currentCart = initialCart;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    requests.push({ url, method, body });

    if (method === "GET" && url.pathname === "/api/cart") {
      return jsonResponse(currentCart);
    }
    if (method === "PUT" && url.pathname === "/api/cart/11") {
      if (putStatus >= 400) {
        return jsonResponse({ success: false, message: "Could not update" }, putStatus);
      }
      const qty = JSON.parse(body ?? "{}").qty as number;
      const base = currentCart.items[0];
      currentCart = {
        ...currentCart,
        items: [{ ...base, qty, lineTotal: (base.price ?? 0) * qty }],
        totals: totalsFor((base.price ?? 0) * qty),
      };
      return jsonResponse(currentCart);
    }
    if (method === "DELETE" && url.pathname === "/api/cart/11") {
      if (deleteStatus >= 400) {
        return jsonResponse({ success: false, message: "Could not remove" }, deleteStatus);
      }
      currentCart = { ...currentCart, count: 0, items: [], totals: totalsFor(0) };
      return jsonResponse(currentCart);
    }
    return jsonResponse({ success: false, message: "Not found" }, 404);
  });

  vi.stubGlobal("fetch", fetchMock);
  return requests;
}

describe("CartPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the server-authoritative cart lines and totals", async () => {
    const requests = installFetch();
    renderWithProviders(<CartPage />, { route: "/cart" });

    expect(await screen.findByText("Test Lamp")).toBeInTheDocument();
    expect(screen.getAllByText("₹1,000")).toHaveLength(2); // line total + subtotal
    expect(screen.getByText(/₹500 each/)).toBeInTheDocument(); // per-unit price
    expect(screen.getByText("₹1,050")).toBeInTheDocument(); // grand total
    expect(screen.getByText("1 item · Cash on delivery")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Proceed to checkout" }),
    ).toHaveAttribute("href", "/checkout");
    expect(
      requests.filter((request) => request.url.pathname === "/api/cart"),
    ).toHaveLength(1);
  });

  it("updates quantity and reconciles authoritative totals from the response", async () => {
    const user = userEvent.setup();
    const requests = installFetch();
    renderWithProviders(<CartPage />, { route: "/cart" });

    await screen.findByText("Test Lamp");

    await user.click(screen.getByRole("button", { name: "Increase quantity" }));

    await waitFor(() => {
      expect(
        requests.filter((request) => request.method === "PUT"),
      ).toHaveLength(1);
    });
    expect(requests.find((request) => request.method === "PUT")?.body).toBe(
      JSON.stringify({ qty: 3 }),
    );

    // Toast confirms the action; totals come from the server response/refetch.
    expect(await screen.findByText("Quantity updated")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("₹1,575")).toBeInTheDocument();
    });
  });

  it("surfaces a stock conflict and blocks checkout", async () => {
    installFetch({ initialCart: OVER_STOCK_CART });
    renderWithProviders(<CartPage />, { route: "/cart" });

    expect(await screen.findByText("Only 3 in stock")).toBeInTheDocument();
    expect(screen.getByText("Stock changed")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Proceed to checkout" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Resolve cart items" })).toBeDisabled();
  });

  it("removes an item only after confirmation", async () => {
    const user = userEvent.setup();
    const requests = installFetch();
    renderWithProviders(<CartPage />, { route: "/cart" });

    await screen.findByText("Test Lamp");

    await user.click(screen.getByRole("button", { name: /Remove/i }));
    expect(await screen.findByText(/This removes Test Lamp/)).toBeInTheDocument();
    expect(
      requests.filter((request) => request.method === "DELETE"),
    ).toHaveLength(0);

    const confirmButton = within(screen.getByRole("dialog")).getByRole("button", {
      name: "Remove",
    });
    await user.click(confirmButton);

    await waitFor(() => {
      expect(
        requests.filter((request) => request.method === "DELETE"),
      ).toHaveLength(1);
    });
    expect(await screen.findByText("Removed from cart")).toBeInTheDocument();
    expect(await screen.findByText("Your cart is empty")).toBeInTheDocument();
  });

  it("reports a failed quantity update and keeps the line", async () => {
    const user = userEvent.setup();
    installFetch({ putStatus: 400 });
    renderWithProviders(<CartPage />, { route: "/cart" });

    await screen.findByText("Test Lamp");
    await user.click(screen.getByRole("button", { name: "Increase quantity" }));

    expect(
      await screen.findByText("Could not update quantity"),
    ).toBeInTheDocument();
    expect(screen.getByText("Test Lamp")).toBeInTheDocument();
  });

  it("offers a retry when the cart itself cannot load", async () => {
    const user = userEvent.setup();
    const requests = installFetch();
    // Break only the first load, then let retries succeed.
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        const method = init?.method ?? "GET";
        requests.push({ url, method });
        if (method === "GET" && url.pathname === "/api/cart") {
          calls += 1;
          if (calls === 1) {
            return jsonResponse({ success: false, message: "Network broken" }, 500);
          }
          return jsonResponse(INITIAL_CART);
        }
        return jsonResponse({ success: false, message: "Not found" }, 404);
      }),
    );

    renderWithProviders(<CartPage />, { route: "/cart" });

    expect(await screen.findByText("Your cart could not be loaded")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Test Lamp")).toBeInTheDocument();
  });
});
