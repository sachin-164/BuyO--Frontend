import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddToCartButton } from "@/components/commerce/add-to-cart-button";
import { GUEST_CART_KEY } from "@/features/cart/guest-cart";
import { clearToken } from "@/lib/api";
import { renderWithProviders } from "@/test/render";
import type { Product } from "@/types/catalog";

const VARIANT_PRODUCT: Product = {
  id: 5,
  name: "Everyday Tee",
  slug: "everyday-tee",
  category: "Apparel",
  sellingPrice: "1000",
  mrpPrice: "1200",
  stock: 8,
  hasVariants: true,
  variants: [
    {
      id: 31,
      sku: "TEE-BLK-M",
      size: "M",
      color: "Black",
      priceAdjustment: 0,
      unitPrice: 1000,
      stock: 4,
      isActive: true,
    },
  ],
};

describe("AddToCartButton", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearToken();
    window.localStorage.clear();
  });

  it("sends a variant-managed card to the PDP instead of guessing a variant", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<AddToCartButton product={VARIANT_PRODUCT} />, {
      route: "/shop",
    });

    const link = screen.getByRole("link", { name: "Choose options" });
    expect(link).toHaveAttribute("href", "/product/everyday-tee");
    await user.click(link);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(GUEST_CART_KEY)).toBeNull();
  });
});
