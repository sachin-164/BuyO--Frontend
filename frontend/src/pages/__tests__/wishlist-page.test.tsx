import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import WishlistPage from "@/pages/wishlist-page";
import { jsonResponse, renderWithProviders } from "@/test/render";
import type { WishlistItem, WishlistResponse } from "@/types/commerce";

const LAMP: WishlistItem = {
  id: 1,
  productId: 1,
  name: "Test Lamp",
  price: 999,
  image: null,
  inStock: true,
  unavailable: false,
};

const WISHLIST: WishlistResponse = {
  success: true,
  count: 1,
  items: [LAMP],
};

function installFetch({
  initialWishlist = WISHLIST,
  deleteStatus = 200,
} = {}) {
  const requests: Array<{ url: URL; method: string; body?: string }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    requests.push({ url, method, body });

    if (method === "GET" && url.pathname === "/api/wishlist") {
      return jsonResponse(initialWishlist);
    }
    if (method === "POST" && url.pathname === "/api/cart") {
      return jsonResponse(
        {
          success: true,
          message: "Item added to cart",
          count: 1,
          items: [],
          totals: {
            subtotal: 999,
            tax: { total: 0, byCategory: [], preview: true },
            grandTotal: 999,
          },
        },
        201,
      );
    }
    if (method === "DELETE" && url.pathname === "/api/wishlist/1") {
      if (deleteStatus >= 400) {
        return jsonResponse({ success: false, message: "Cannot remove" }, deleteStatus);
      }
      return jsonResponse({
        success: true,
        message: "Removed from wishlist",
        inWishlist: false,
      });
    }
    return jsonResponse({ success: false, message: "Not found" }, 404);
  });

  vi.stubGlobal("fetch", fetchMock);
  return requests;
}

describe("WishlistPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders saved products with live prices and stock state", async () => {
    installFetch();
    renderWithProviders(<WishlistPage />, { route: "/wishlist" });

    // The API exposes no slugs, so links use the product id (accepted by the API).
    const productLinks = await screen.findAllByRole("link", { name: /Test Lamp/i });
    for (const link of productLinks) {
      expect(link).toHaveAttribute("href", "/product/1");
    }
    expect(screen.getByText("₹999")).toBeInTheDocument();
    expect(screen.getByText("In stock")).toBeInTheDocument();
  });

  it("adds a saved product to the cart and then removes it after confirmation", async () => {
    const user = userEvent.setup();
    const requests = installFetch({
      initialWishlist: { ...WISHLIST, items: [LAMP, { ...LAMP, id: 2 }] },
    });
    renderWithProviders(<WishlistPage />, { route: "/wishlist" });

    const addToCartButtons = await screen.findAllByRole("button", {
      name: /Add to cart/i,
    });
    await user.click(addToCartButtons[0]);

    await waitFor(() => {
      const addRequest = requests.find(
        (request) => request.method === "POST" && request.url.pathname === "/api/cart",
      );
      expect(addRequest).toBeDefined();
      expect(JSON.parse(addRequest?.body ?? "{}")).toEqual({ productId: 1, qty: 1 });
    });
    expect(await screen.findByText("Added to cart")).toBeInTheDocument();

    // Card 1's remove button (the first of the two card buttons).
    const cardRemoveButtons = await screen.findAllByRole("button", { name: "Remove" });
    expect(cardRemoveButtons).toHaveLength(2);
    await user.click(cardRemoveButtons[0]);

    expect(
      await screen.findByText(/This removes Test Lamp/),
    ).toBeInTheDocument();
    expect(
      requests.filter((request) => request.method === "DELETE"),
    ).toHaveLength(0);

    // The dialog is the only place with a destructive confirm button.
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Remove" }),
    );

    await waitFor(() => {
      expect(
        requests.find(
          (request) =>
            request.method === "DELETE" && request.url.pathname === "/api/wishlist/1",
        ),
      ).toBeDefined();
    });
    expect(await screen.findByText("Removed from wishlist")).toBeInTheDocument();
  });

  it("keeps unavailable items visible and disables cart actions", async () => {
    installFetch({
      initialWishlist: {
        success: true,
        count: 1,
        items: [
          {
            id: 2,
            productId: null,
            name: "Unavailable Keepsake",
            price: null,
            image: null,
            inStock: false,
            unavailable: true,
          },
        ],
      },
    });
    renderWithProviders(<WishlistPage />, { route: "/wishlist" });

    expect(await screen.findByText("Unavailable Keepsake")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add to cart/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("reports a failed removal and keeps the saved product", async () => {
    const user = userEvent.setup();
    installFetch({ deleteStatus: 400 });
    renderWithProviders(<WishlistPage />, { route: "/wishlist" });

    await screen.findByText("Test Lamp");
    await user.click(screen.getByRole("button", { name: "Remove" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(await screen.findByText("Could not remove item")).toBeInTheDocument();
    expect(screen.getByText("Test Lamp")).toBeInTheDocument();
  });

  it("reports a failed wishlist load and offers a retry", async () => {
    installFetch({
      initialWishlist: { success: true, count: 0, items: [] },
    });
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        const method = init?.method ?? "GET";
        if (method === "GET" && url.pathname === "/api/wishlist") {
          calls += 1;
          if (calls === 1) {
            return jsonResponse({ success: false, message: "Server offline" }, 500);
          }
          return jsonResponse(WISHLIST);
        }
        return jsonResponse({ success: false, message: "Not found" }, 404);
      }),
    );

    renderWithProviders(<WishlistPage />, { route: "/wishlist" });

    expect(await screen.findByText("Your wishlist could not be loaded")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Test Lamp")).toBeInTheDocument();
  });
});
