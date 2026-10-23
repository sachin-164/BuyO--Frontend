import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CartPage from "@/pages/cart-page";
import { jsonResponse, renderWithProviders } from "@/test/render";
import { clearToken, getToken, setToken } from "@/lib/api";
import {
  GUEST_CART_KEY,
  addGuestLine,
  buildGuestCart,
  clearGuestCart,
  readGuestCart,
  removeGuestLine,
  setGuestQty,
} from "@/features/cart/guest-cart";
import { mergeGuestCart } from "@/features/cart/merge";
import { createTestQueryClient } from "@/test/render";
import type { CartResponse } from "@/types/commerce";
import type { Product } from "@/types/catalog";

const LAMP: Product = {
  id: 7,
  name: "Desk Lamp",
  slug: "desk-lamp",
  category: "Lighting",
  categoryId: 3,
  mrpPrice: "1299",
  sellingPrice: "999.50",
  stock: 4,
  image: "/uploads/lamp.png",
  imageMeta: null,
  Category: { id: 3, name: "Lighting", slug: "lighting", taxRate: 5 },
};

const VARIANT_PRODUCT: Product = {
  ...LAMP,
  id: 12,
  name: "Everyday Tee",
  slug: "everyday-tee",
  sellingPrice: "1000",
  stock: 6,
  hasVariants: true,
  variants: [
    {
      id: 31,
      productId: 12,
      sku: "TEE-BLK-M",
      size: "M",
      color: "Black",
      priceAdjustment: 0,
      unitPrice: 1000,
      stock: 2,
      isActive: true,
    },
    {
      id: 32,
      productId: 12,
      sku: "TEE-WHT-L",
      size: "L",
      color: "White",
      priceAdjustment: 200,
      unitPrice: 1200,
      stock: 4,
      isActive: true,
    },
  ],
};

const BLACK_M = VARIANT_PRODUCT.variants![0];
const WHITE_L = VARIANT_PRODUCT.variants![1];

function guestResponse(): CartResponse {
  return buildGuestCart(readGuestCart());
}

beforeEach(() => {
  clearGuestCart();
  clearToken();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearGuestCart();
  clearToken();
});

describe("guest cart store", () => {
  it("adds, increments and persists lines across reads", () => {
    addGuestLine(LAMP, 2);
    addGuestLine(LAMP, 1);

    expect(readGuestCart()).toHaveLength(1);
    expect(readGuestCart()[0]).toMatchObject({ productId: 7, qty: 3, unitPrice: 999.5 });
    expect(JSON.parse(window.localStorage.getItem(GUEST_CART_KEY) ?? "[]")).toHaveLength(1);
  });

  it("enforces stock and the per-line limit with server-equivalent messages", () => {
    addGuestLine(LAMP, 3);
    expect(() => addGuestLine(LAMP, 2)).toThrow(/Only 4 unit/);
    expect(readGuestCart()[0].qty).toBe(3); // a rejected add must not change the line

    const scarce: Product = { ...LAMP, id: 8, stock: 0 };
    expect(() => addGuestLine(scarce, 1)).toThrow(/out of stock/i);
  });

  it("updates and removes lines, refusing quantities above stock", () => {
    addGuestLine(LAMP, 1);
    setGuestQty(7, 4);
    expect(readGuestCart()[0].qty).toBe(4);
    expect(() => setGuestQty(7, 5)).toThrow(/Only 4 unit/);

    removeGuestLine(7);
    expect(readGuestCart()).toEqual([]);
  });

  it("builds a server-shaped response with per-category tax preview", () => {
    addGuestLine(LAMP, 2);
    const cart = guestResponse();

    expect(cart.count).toBe(1);
    expect(cart.items[0]).toMatchObject({
      id: 7,
      productId: 7,
      qty: 2,
      price: 999.5,
      lineTotal: 1999,
      stock: 4,
      stockExceeded: false,
      unavailable: false,
    });
    expect(cart.totals.subtotal).toBe(1999);
    expect(cart.totals.tax.total).toBe(99.95);
    expect(cart.totals.tax.byCategory[0]).toMatchObject({
      categoryId: 3,
      categoryName: "Lighting",
      taxRate: 5,
      taxableAmount: 1999,
      taxAmount: 99.95,
    });
    expect(cart.totals.grandTotal).toBe(2098.95);
    expect(cart.totals.tax.preview).toBe(true);
  });

  it("keeps each variant as its own line and never invents a base line", () => {
    addGuestLine(VARIANT_PRODUCT, 2, BLACK_M);
    addGuestLine(VARIANT_PRODUCT, 1, WHITE_L);

    expect(readGuestCart()).toHaveLength(2);
    const cart = guestResponse();
    expect(cart.count).toBe(2);
    expect(cart.items[0]).toMatchObject({
      productId: 12,
      variantId: 31,
      variant: { id: 31, sku: "TEE-BLK-M", size: "M", color: "Black" },
      price: 1000,
      lineTotal: 2000,
    });
    expect(cart.items[1]).toMatchObject({
      variantId: 32,
      price: 1200,
      lineTotal: 1200,
    });
    expect(cart.items[0].id).not.toBe(cart.items[1].id);
    expect(() => addGuestLine(VARIANT_PRODUCT, 1)).toThrow(/Choose a size or colour/);
  });

  it("updates and removes a variant line without touching its sibling", () => {
    addGuestLine(VARIANT_PRODUCT, 1, BLACK_M);
    addGuestLine(VARIANT_PRODUCT, 1, WHITE_L);

    setGuestQty(12, 2, 31);
    expect(readGuestCart().find((line) => line.variantId === 31)?.qty).toBe(2);
    expect(readGuestCart().find((line) => line.variantId === 32)?.qty).toBe(1);

    removeGuestLine(12, 31);
    expect(readGuestCart()).toHaveLength(1);
    expect(readGuestCart()[0].variantId).toBe(32);
  });

  it("drops corrupt storage instead of breaking the storefront", async () => {
    window.localStorage.setItem(GUEST_CART_KEY, "{not json");
    vi.resetModules();
    const corrupted = await import("@/features/cart/guest-cart");
    expect(corrupted.readGuestCart()).toEqual([]);

    window.localStorage.setItem(
      GUEST_CART_KEY,
      JSON.stringify([
        { productId: "nope" },
        { productId: 7, qty: 1, name: "Desk Lamp", unitPrice: 1, stock: 1 },
      ]),
    );
    vi.resetModules();
    const mixed = await import("@/features/cart/guest-cart");
    expect(mixed.readGuestCart().map((line) => line.productId)).toEqual([7]);
    expect(mixed.readGuestCart()[0].variantId).toBeNull();
  });
});

describe("guest cart merge", () => {
  it("posts the local lines, clears them and seeds the cart cache", async () => {
    addGuestLine(LAMP, 2);
    const queryClient = createTestQueryClient();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      expect(url.pathname).toBe("/api/cart/merge");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        items: [{ productId: 7, variantId: null, qty: 2 }],
      });
      return jsonResponse({
        success: true,
        count: 1,
        items: [
          {
            id: 41,
            productId: 7,
            qty: 2,
            name: "Desk Lamp",
            price: 999.5,
            image: null,
            lineTotal: 1999,
            stock: 4,
            stockExceeded: false,
            unavailable: false,
          },
        ],
        totals: { subtotal: 1999, tax: { total: 99.95, byCategory: [], preview: true }, grandTotal: 2098.95 },
        merged: [{ productId: 7, qty: 2, added: 2 }],
        skipped: [],
        clamped: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const merged = await mergeGuestCart(queryClient);

    expect(merged).toBe(true);
    expect(readGuestCart()).toEqual([]);
    expect(queryClient.getQueryData<CartResponse>(["cart"])?.count).toBe(1);
  });

  it("keeps the local cart when the merge fails", async () => {
    addGuestLine(LAMP, 2);
    const queryClient = createTestQueryClient();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ success: false, message: "Server offline" }, 503)),
    );

    const merged = await mergeGuestCart(queryClient);

    expect(merged).toBe(false);
    expect(readGuestCart()).toHaveLength(1);
  });

  it("does nothing (and sends nothing) for an empty guest cart", async () => {
    const queryClient = createTestQueryClient();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await mergeGuestCart(queryClient)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("guest cart page", () => {
  it("renders local lines, allows quantity edits and links checkout through sign-in", async () => {
    const user = userEvent.setup();
    addGuestLine(LAMP, 2);

    renderWithProviders(<CartPage />, { route: "/cart" });

    expect(await screen.findByText("Desk Lamp")).toBeInTheDocument();
    expect(screen.getByText("1 item · Cash on delivery")).toBeInTheDocument();
    expect(screen.getByText(/Saved in this browser/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in to checkout" })).toHaveAttribute(
      "href",
      "/login?next=%2Fcheckout",
    );

    await user.click(screen.getByRole("button", { name: "Increase quantity" }));

    await waitFor(() => expect(readGuestCart()[0].qty).toBe(3));
    expect(await screen.findByText("Quantity updated")).toBeInTheDocument();
  });

  it("shows the chosen options and SKU for a variant line", async () => {
    addGuestLine(VARIANT_PRODUCT, 1, BLACK_M);

    renderWithProviders(<CartPage />, { route: "/cart" });

    expect(await screen.findByText("Everyday Tee")).toBeInTheDocument();
    expect(screen.getByText("Size M · Colour Black")).toBeInTheDocument();
    expect(screen.getByText("SKU TEE-BLK-M")).toBeInTheDocument();
    expect(screen.getByText("₹1,000 each")).toBeInTheDocument();
  });

  it("asks the shopper to sign in and never calls the cart API", async () => {
    addGuestLine(LAMP, 1);
    const fetchMock = vi.fn(async () => jsonResponse({ success: false, message: "Not found" }, 404));
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<CartPage />, { route: "/cart" });

    expect(await screen.findByText("Desk Lamp")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some((call: unknown[]) => String(call[0]).includes("/api/cart")),
    ).toBe(false);
  });

  it("shows a signed-in shopper the server cart, not the local copy", async () => {
    addGuestLine(LAMP, 1);
    setToken("signed-in-token");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/auth/me") {
        return jsonResponse({
          success: true,
          user: { id: 1, name: "Buyer", email: "buyer@buyo.test", isVerified: true, role: "customer", isAdmin: false },
        });
      }
      if (url.pathname === "/api/cart/merge") {
        return jsonResponse({
          success: true,
          count: 1,
          items: [{ id: 9, productId: 7, qty: 1, name: "Desk Lamp", price: 999.5, image: null, lineTotal: 999.5, stock: 4, stockExceeded: false, unavailable: false }],
          totals: { subtotal: 999.5, tax: { total: 49.98, byCategory: [], preview: true }, grandTotal: 1049.48 },
          merged: [],
          skipped: [],
          clamped: [],
        });
      }
      if (url.pathname === "/api/cart" && (init?.method ?? "GET") === "GET") {
        return jsonResponse({
          success: true,
          count: 1,
          items: [{ id: 9, productId: 7, qty: 1, name: "Server Cart Lamp", price: 999.5, image: null, lineTotal: 999.5, stock: 4, stockExceeded: false, unavailable: false }],
          totals: { subtotal: 999.5, tax: { total: 49.98, byCategory: [], preview: true }, grandTotal: 1049.48 },
        });
      }
      return jsonResponse({ success: false, message: "Not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<CartPage />, { route: "/cart" });

    expect(await screen.findByText("Server Cart Lamp")).toBeInTheDocument();
    expect(screen.queryByText(/Saved in this browser/)).not.toBeInTheDocument();
    // The signed-in boot merged the guest line and cleared it.
    await waitFor(() => expect(readGuestCart()).toEqual([]));
    expect(getToken()).toBe("signed-in-token");
  });
});
