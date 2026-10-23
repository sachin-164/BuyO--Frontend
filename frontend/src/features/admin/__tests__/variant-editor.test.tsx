import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VariantEditor } from "@/components/admin/variant-editor";
import { clearToken, setToken } from "@/lib/api";
import { installAdminFetch, type MockHandler } from "@/test/admin";
import { jsonResponse, renderWithProviders } from "@/test/render";
import type { ProductVariant } from "@/types/catalog";

const VARIANTS: ProductVariant[] = [
  {
    id: 41,
    productId: 3,
    sku: "TEE-BLK-M",
    size: "M",
    color: "Black",
    priceAdjustment: 100,
    unitPrice: 1099,
    stock: 5,
    isActive: true,
  },
  {
    id: 42,
    productId: 3,
    sku: "TEE-WHT-L",
    size: "L",
    color: "White",
    priceAdjustment: 0,
    unitPrice: 999,
    stock: 0,
    isActive: false,
  },
];

function variantsResponse(variants: ProductVariant[] = VARIANTS) {
  return jsonResponse({ success: true, productId: 3, count: variants.length, variants });
}

function installVariantFetch(overrides: MockHandler = () => undefined) {
  return installAdminFetch((request) => {
    const { url, method } = request;
    const override = overrides(request);
    if (override) return override;

    if (method === "GET" && url.pathname === "/api/products/3/variants") {
      return variantsResponse();
    }
    if (method === "POST" && url.pathname === "/api/products/3/variants") {
      return jsonResponse(
        {
          success: true,
          message: "Variant added",
          variant: {
            id: 43,
            productId: 3,
            sku: "TEE-BLK-L",
            size: "L",
            color: "Black",
            priceAdjustment: 200,
            unitPrice: 1199,
            stock: 6,
            isActive: true,
          },
        },
        201,
      );
    }
    if (method === "PUT" && url.pathname === "/api/products/3/variants/41") {
      return jsonResponse({
        success: true,
        message: "Variant updated",
        variant: { ...VARIANTS[0], stock: 9 },
      });
    }
    if (method === "DELETE" && url.pathname === "/api/products/3/variants/41") {
      return jsonResponse({
        success: true,
        message: "Variant deactivated",
        variant: { ...VARIANTS[0], isActive: false },
      });
    }
    return undefined;
  });
}

function renderEditor() {
  return renderWithProviders(<VariantEditor productId={3} basePrice={999} />, {
    route: "/admin/products/3/edit",
  });
}

beforeEach(() => setToken("admin-token"));

afterEach(() => {
  vi.unstubAllGlobals();
  clearToken();
});

describe("VariantEditor", () => {
  it("lists active and inactive variants with stock, SKU and resolved price", async () => {
    installVariantFetch();
    renderEditor();

    expect(await screen.findByText("Size M · Colour Black")).toBeInTheDocument();
    expect(screen.getByText("TEE-BLK-M")).toBeInTheDocument();
    expect(screen.getByText("Size L · Colour White")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByText(/₹1,099 · 5 in stock/)).toBeInTheDocument();
    expect(screen.getByText(/adjustment \+₹100/)).toBeInTheDocument();
  });

  it("creates a variant with the exact JSON contract", async () => {
    const user = userEvent.setup();
    const { requests } = installVariantFetch();
    renderEditor();

    await screen.findByText("TEE-BLK-M");
    await user.click(screen.getByRole("button", { name: "Add variant" }));
    await user.type(screen.getByLabelText(/^SKU/), "tee-blk-l");
    await user.type(screen.getByLabelText(/^Size/), "L");
    await user.type(screen.getByLabelText(/^Colour/), "Black");
    const stock = screen.getByLabelText(/^Stock/);
    await user.clear(stock);
    await user.type(stock, "6");
    const adjustment = screen.getByLabelText(/Price adjustment/);
    await user.clear(adjustment);
    await user.type(adjustment, "200");
    await user.click(screen.getByRole("button", { name: "Add variant" }));

    expect(await screen.findByText("Variant added")).toBeInTheDocument();
    const post = requests.find(
      (request) => request.method === "POST" && request.url.pathname === "/api/products/3/variants",
    );
    expect(JSON.parse(post?.body ?? "{}")).toEqual({
      sku: "tee-blk-l",
      size: "L",
      color: "Black",
      stock: 6,
      priceAdjustment: 200,
      isActive: true,
    });
  });

  it("rejects a variant price at or below zero before calling the API", async () => {
    const user = userEvent.setup();
    const { requests } = installVariantFetch();
    renderEditor();

    await screen.findByText("TEE-BLK-M");
    await user.click(screen.getByRole("button", { name: "Add variant" }));
    await user.type(screen.getByLabelText(/^SKU/), "TEE-FREE");
    await user.type(screen.getByLabelText(/^Size/), "S");
    const adjustment = screen.getByLabelText(/Price adjustment/);
    await user.clear(adjustment);
    await user.type(adjustment, "-2000");
    await user.click(screen.getByRole("button", { name: "Add variant" }));

    expect(
      await screen.findByText("The final price must be greater than zero."),
    ).toBeInTheDocument();
    expect(requests.some((request) => request.method === "POST")).toBe(false);
  });

  it("surfaces a duplicate SKU from the server", async () => {
    const user = userEvent.setup();
    installVariantFetch(({ url, method }) => {
      if (method === "POST" && url.pathname === "/api/products/3/variants") {
        return jsonResponse(
          {
            success: false,
            code: "DUPLICATE_SKU",
            message: "A variant with that SKU already exists",
            errors: ["SKU must be unique across the entire catalog"],
          },
          409,
        );
      }
      return undefined;
    });
    renderEditor();

    await screen.findByText("TEE-BLK-M");
    await user.click(screen.getByRole("button", { name: "Add variant" }));
    await user.type(screen.getByLabelText(/^SKU/), "TEE-BLK-M");
    await user.type(screen.getByLabelText(/^Size/), "M");
    await user.click(screen.getByRole("button", { name: "Add variant" }));

    expect(
      await screen.findByText("SKU must be unique across the entire catalog"),
    ).toBeInTheDocument();
  });

  it("edits stock and deactivates through confirmation", async () => {
    const user = userEvent.setup();
    const { requests } = installVariantFetch();
    renderEditor();

    await screen.findByText("TEE-BLK-M");
    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    const stock = screen.getByLabelText(/^Stock/);
    await user.clear(stock);
    await user.type(stock, "9");
    await user.click(screen.getByRole("button", { name: "Save variant" }));

    expect(await screen.findByText("Variant updated")).toBeInTheDocument();
    const put = requests.find(
      (request) => request.method === "PUT" && request.url.pathname === "/api/products/3/variants/41",
    );
    expect(JSON.parse(put?.body ?? "{}")).toMatchObject({ stock: 9, sku: "TEE-BLK-M" });

    await user.click(screen.getByRole("button", { name: "Deactivate" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/TEE-BLK-M|This variant/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Deactivate" }));

    expect(await screen.findByText("Variant deactivated")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.method === "DELETE" &&
            request.url.pathname === "/api/products/3/variants/41",
        ),
      ).toBe(true);
    });
  });
});
