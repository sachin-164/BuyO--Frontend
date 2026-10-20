import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "@/App";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("App shell", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the storefront shell and live-shaped catalog data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/categories")) {
          return jsonResponse({
            success: true,
            count: 1,
            categories: [{ id: 1, name: "Lighting", slug: "lighting", productCount: 1 }],
          });
        }
        if (url.includes("/api/products")) {
          return jsonResponse({
            success: true,
            count: 1,
            products: [
              {
                id: 1,
                name: "Test Lamp",
                slug: "test-lamp",
                category: "Lighting",
                mrpPrice: "1299",
                sellingPrice: "999",
                stock: 3,
                image: null,
              },
            ],
            pagination: { page: 1, limit: 8, total: 1, totalPages: 1 },
          });
        }
        return new Response(JSON.stringify({ success: false, message: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    render(<App />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /shopping that feels/i,
      }),
    ).toBeInTheDocument();

    const productLink = await screen.findByRole("link", { name: /test lamp/i });
    expect(productLink).toHaveAttribute("href", "/product/test-lamp");
    expect(screen.getByText("₹999")).toBeInTheDocument();

    const categoryChip = screen.getByRole("link", { name: /lighting\s+1/i });
    expect(categoryChip).toHaveAttribute("href", "/shop?category=lighting");

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });
});
