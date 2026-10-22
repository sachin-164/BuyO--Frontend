import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import CategoriesPage from "@/pages/categories-page";
import ShopPage from "@/pages/shop-page";
import { jsonResponse, renderWithProviders } from "@/test/render";
import type { Category, CategoryNode } from "@/types/catalog";

const ROOT: Category = {
  id: 1,
  name: "Kitchen",
  slug: "kitchen",
  description: "Everything for the kitchen",
  taxRate: 5,
  productCount: 0,
  totalProductCount: 4,
  parentId: null,
  depth: 1,
};

const CHILD: Category = {
  id: 2,
  name: "Kitchen Tools",
  slug: "kitchen-tools",
  taxRate: 5,
  productCount: 2,
  totalProductCount: 3,
  parentId: 1,
  depth: 2,
};

const SIBLING: Category = {
  id: 3,
  name: "Cookware",
  slug: "cookware",
  taxRate: 5,
  productCount: 1,
  totalProductCount: 1,
  parentId: 1,
  depth: 2,
};

const GRANDCHILD: Category = {
  id: 4,
  name: "Utensils",
  slug: "utensils",
  taxRate: 5,
  productCount: 1,
  totalProductCount: 1,
  parentId: 2,
  depth: 3,
};

const FLAT = [ROOT, CHILD, SIBLING, GRANDCHILD];

const TREE: CategoryNode[] = [
  {
    ...ROOT,
    children: [
      {
        ...CHILD,
        children: [{ ...GRANDCHILD, children: [] }],
      },
      { ...SIBLING, children: [] },
    ],
  },
];

const EMPTY_PRODUCTS = {
  success: true,
  count: 0,
  products: [],
  pagination: { page: 1, limit: 12, total: 0, totalPages: 1 },
};

function installFetch({
  categories = { success: true, count: FLAT.length, maxDepth: 3, categories: FLAT, tree: TREE },
  products = EMPTY_PRODUCTS,
}: {
  categories?: unknown;
  products?: unknown;
} = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/categories") return jsonResponse(categories);
      if (url.pathname === "/api/products") return jsonResponse(products);
      return jsonResponse({ success: false, message: "Not found" }, 404);
    }),
  );
}

function renderCategories() {
  return renderWithProviders(<CategoriesPage />, { route: "/categories" });
}

function renderShop(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/shop" element={<ShopPage />} />
    </Routes>,
    { route },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storefront category navigation", () => {
  it("renders parent, child and grandchild links with honest counts", async () => {
    installFetch();
    renderCategories();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Shop by category" }),
    ).toBeInTheDocument();

    const rootLink = await screen.findByRole("link", { name: "Kitchen" });
    expect(rootLink).toHaveAttribute("href", "/shop?category=kitchen");

    expect(await screen.findByRole("link", { name: /Kitchen Tools/ })).toHaveAttribute(
      "href",
      "/shop?category=kitchen-tools",
    );
    expect(screen.getByRole("link", { name: /Utensils/ })).toHaveAttribute(
      "href",
      "/shop?category=utensils",
    );
    expect(screen.getByRole("link", { name: /Cookware/ })).toHaveAttribute(
      "href",
      "/shop?category=cookware",
    );

    // Parent count is the rollup, not its own (zero) direct products.
    expect(
      await screen.findByText("4 products including subcategories"),
    ).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Subcategories of Kitchen" })).toBeInTheDocument();
  });

  it("keeps the empty state when no categories are published", async () => {
    installFetch({ categories: { success: true, count: 0, maxDepth: 3, categories: [], tree: [] } });
    renderCategories();

    expect(await screen.findByText("No categories published yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse all products" })).toHaveAttribute(
      "href",
      "/shop",
    );
    expect(screen.queryByRole("navigation", { name: /Subcategories of/ })).toBeNull();
  });

  it("adds subcategory links and a breadcrumb trail on a parent category", async () => {
    const user = userEvent.setup();
    installFetch();
    renderShop("/shop?category=kitchen");

    expect(await screen.findByRole("heading", { level: 1, name: "Kitchen" })).toBeInTheDocument();

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByText("Home")).toBeInTheDocument();
    expect(within(breadcrumb).getByText("Shop")).toBeInTheDocument();
    expect(within(breadcrumb).getByText("Kitchen")).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "Category navigation for Kitchen" });
    expect(within(nav).getByText("Subcategories")).toBeInTheDocument();

    const toolsLink = within(nav).getByRole("link", { name: /Kitchen Tools/ });
    expect(toolsLink).toHaveAttribute("href", "/shop?category=kitchen-tools");

    await user.click(toolsLink);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/shop?category=kitchen-tools"),
    );
  });

  it("shows the ancestor chain and a parent link on a child category", async () => {
    installFetch();
    renderShop("/shop?category=kitchen-tools");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Kitchen Tools" }),
    ).toBeInTheDocument();

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByRole("link", { name: "Kitchen" })).toHaveAttribute(
      "href",
      "/shop?category=kitchen",
    );
    expect(within(breadcrumb).getByText("Kitchen Tools")).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "Category navigation for Kitchen Tools" });
    const parentLink = within(nav).getByRole("link", { name: "Kitchen" });
    expect(parentLink).toHaveAttribute("href", "/shop?category=kitchen");

    // The catalog is exactly the child's own products: the parent's count is
    // not silently included in the filter.
    expect(within(nav).getByRole("link", { name: /Utensils/ })).toHaveAttribute(
      "href",
      "/shop?category=utensils",
    );
    expect(within(nav).queryByRole("link", { name: /Cookware/ })).toBeNull();
  });

  it("indents nested categories in the catalog select", async () => {
    installFetch();
    renderShop("/shop?category=kitchen");

    const select = (await screen.findByLabelText("Category")) as HTMLSelectElement;
    await waitFor(() =>
      expect(within(select).getAllByRole("option").length).toBeGreaterThan(FLAT.length),
    );

    const childOption = within(select).getByRole("option", { name: /Kitchen Tools/ });
    const rootOption = within(select).getByRole("option", { name: /^Kitchen \(0\)/ });
    expect(childOption.textContent).toContain("—");
    expect(rootOption.textContent).not.toContain("—");
  });
});
