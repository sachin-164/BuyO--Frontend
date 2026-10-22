import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminCategoriesPage from "@/pages/admin/categories-page";
import {
  CATEGORY,
  categoriesResponse,
  installAdminFetch,
  type MockHandler,
} from "@/test/admin";
import { jsonResponse, renderWithProviders } from "@/test/render";
import { clearToken, setToken } from "@/lib/api";
import type { Category } from "@/types/catalog";

function installCategoryFetch(overrides: MockHandler = () => undefined) {
  return installAdminFetch((request) => {
    const { url, method } = request;
    const override = overrides(request);
    if (override) return override;

    if (method === "GET" && url.pathname === "/api/categories") {
      return categoriesResponse();
    }
    if (method === "POST" && url.pathname === "/api/categories") {
      return jsonResponse({
        success: true,
        message: "Category created",
        category: { id: 9, name: "Home Decor", slug: "home-decor", taxRate: 18 },
      });
    }
    if (method === "PUT" && url.pathname.startsWith("/api/categories/")) {
      return jsonResponse({
        success: true,
        message: "Category updated",
        category: { ...CATEGORY, name: "Steelware" },
      });
    }
    if (method === "DELETE" && url.pathname.startsWith("/api/categories/")) {
      return jsonResponse({ success: true, message: "Category deleted", affectedProducts: 2 });
    }
    return undefined;
  });
}

beforeEach(() => setToken("admin-token"));

afterEach(() => {
  vi.unstubAllGlobals();
  clearToken();
  window.localStorage.clear();
});

describe("AdminCategoriesPage", () => {
  it("lists surface data and filters the client-side dataset", async () => {
    const user = userEvent.setup();
    installCategoryFetch();
    renderWithProviders(<AdminCategoriesPage />, { route: "/admin/categories" });

    expect(await screen.findByRole("heading", { name: "Categories" })).toBeInTheDocument();
    await screen.findAllByText("Steel");
    expect(screen.getAllByText("Steel").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Lighting").length).toBeGreaterThan(0);
    expect(screen.getAllByText("steel").length).toBeGreaterThan(0);
    expect(screen.getByText("5%")).toBeInTheDocument();
    expect(screen.getByText("12%")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Filter categories"), "lamp");
    expect(screen.getAllByText("Lighting").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Steel")).toHaveLength(0);

    await user.clear(screen.getByLabelText("Filter categories"));
    await user.type(screen.getByLabelText("Filter categories"), "no-such-category");
    expect(screen.getByText("No categories match this filter")).toBeInTheDocument();
  });

  it("creates a category with client validation and the exact JSON contract", async () => {
    const user = userEvent.setup();
    const { requests } = installCategoryFetch();
    renderWithProviders(<AdminCategoriesPage />, { route: "/admin/categories" });

    await screen.findAllByText("Steel");
    await user.click(screen.getByRole("button", { name: "Add category" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Add category" }));
    expect(await within(dialog).findByText("Category name is required")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/^Name/), "Home Decor");
    await user.type(within(dialog).getByLabelText(/^Slug/), "home-decor");
    await user.clear(within(dialog).getByLabelText(/^GST rate/));
    await user.type(within(dialog).getByLabelText(/^GST rate/), "18");
    await user.type(within(dialog).getByLabelText(/^Description/), "Wall art and decor");
    await user.click(within(dialog).getByRole("button", { name: "Add category" }));

    expect(await screen.findByText("Category created")).toBeInTheDocument();

    const create = requests.find(
      (request) => request.method === "POST" && request.url.pathname === "/api/categories",
    );
    expect(JSON.parse(create?.body ?? "{}")).toEqual({
      name: "Home Decor",
      slug: "home-decor",
      description: "Wall art and decor",
      taxRate: 18,
      parentId: null,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps the dialog open and maps a duplicate slug from the server", async () => {
    const user = userEvent.setup();
    installCategoryFetch(({ url, method }) => {
      if (method === "POST" && url.pathname === "/api/categories") {
        return jsonResponse(
          { success: false, message: "A category with that slug already exists" },
          409,
        );
      }
      return undefined;
    });
    renderWithProviders(<AdminCategoriesPage />, { route: "/admin/categories" });

    await screen.findAllByText("Steel");
    await user.click(screen.getByRole("button", { name: "Add category" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name/), "Steel");
    await user.type(within(dialog).getByLabelText(/^Slug/), "steel");
    await user.click(within(dialog).getByRole("button", { name: "Add category" }));

    expect(
      await within(dialog).findByText("A category with that slug already exists"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("edits an existing category and sends the current slug", async () => {
    const user = userEvent.setup();
    const { requests } = installCategoryFetch();
    renderWithProviders(<AdminCategoriesPage />, { route: "/admin/categories" });

    await screen.findAllByText("Steel");
    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Edit category")).toBeInTheDocument();

    const name = within(dialog).getByLabelText(/^Name/);
    await user.clear(name);
    await user.type(name, "Steelware");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Category updated")).toBeInTheDocument();
    const update = requests.find(
      (request) => request.method === "PUT" && request.url.pathname === "/api/categories/1",
    );
    expect(JSON.parse(update?.body ?? "{}")).toEqual({
      name: "Steelware",
      slug: "steel",
      description: "Steel drinkware",
      taxRate: 5,
      parentId: null,
    });
  });

  it("confirms deletion and explains that products are only unlinked", async () => {
    const user = userEvent.setup();
    const { requests } = installCategoryFetch();
    renderWithProviders(<AdminCategoriesPage />, { route: "/admin/categories" });

    await screen.findAllByText("Steel");
    await user.click(screen.getByRole("button", { name: "Delete Steel" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete category?")).toBeInTheDocument();
    expect(within(dialog).getByText(/2 linked products/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Delete category" }));
    expect(await screen.findByText("Category deleted")).toBeInTheDocument();
    expect(screen.getByText(/2 products unlinked/)).toBeInTheDocument();
    expect(
      requests.some(
        (request) => request.method === "DELETE" && request.url.pathname === "/api/categories/1",
      ),
    ).toBe(true);
  });

  it("shows honest empty and permission states", async () => {
    installCategoryFetch(({ url, method }) => {
      if (method === "GET" && url.pathname === "/api/categories") {
        return categoriesResponse([]);
      }
      return undefined;
    });
    const { unmount } = renderWithProviders(<AdminCategoriesPage />, {
      route: "/admin/categories",
    });
    expect(await screen.findByText("No categories yet")).toBeInTheDocument();
    unmount();

    installCategoryFetch(({ url, method }) => {
      if (method === "GET" && url.pathname === "/api/categories") {
        return jsonResponse({ success: false, message: "Access denied" }, 403);
      }
      return undefined;
    });
    renderWithProviders(<AdminCategoriesPage />, { route: "/admin/categories" });
    expect(await screen.findByText("Admin access required")).toBeInTheDocument();
    expect(screen.queryByText("Steel")).not.toBeInTheDocument();
  });
});

// --------------------------------------------------------------------------
// Phase G: hierarchy (parent column, indentation, move validation)
// --------------------------------------------------------------------------

const PARENT: Category = {
  id: 10,
  name: "Drinkware",
  slug: "drinkware",
  description: "Bottles, flasks and cups",
  taxRate: 5,
  productCount: 0,
  totalProductCount: 3,
  parentId: null,
  depth: 1,
};

const CHILD: Category = {
  id: 11,
  name: "Bottles",
  slug: "bottles",
  description: "Everyday bottles",
  taxRate: 5,
  productCount: 3,
  totalProductCount: 3,
  parentId: 10,
  depth: 2,
};

const GRANDCHILD: Category = {
  id: 12,
  name: "Insulated",
  slug: "insulated",
  taxRate: 5,
  productCount: 1,
  totalProductCount: 1,
  parentId: 11,
  depth: 3,
};

const SECOND_CHILD: Category = {
  id: 13,
  name: "Cups",
  slug: "cups",
  taxRate: 5,
  productCount: 0,
  totalProductCount: 0,
  parentId: 10,
  depth: 2,
};

const HIERARCHY = [PARENT, CHILD, GRANDCHILD, SECOND_CHILD];

function installHierarchyFetch(overrides: MockHandler = () => undefined) {
  return installCategoryFetch((request) => {
    const override = overrides(request);
    if (override) return override;
    if (request.method === "GET" && request.url.pathname === "/api/categories") {
      return categoriesResponse(HIERARCHY);
    }
    return undefined;
  });
}

describe("AdminCategoriesPage hierarchy", () => {
  it("renders depth, the parent column and the rolled-up product count", async () => {
    installHierarchyFetch();
    renderWithProviders(<AdminCategoriesPage />, { route: "/admin/categories" });

    await screen.findAllByText("Drinkware");
    expect(screen.getAllByText(/\(subcategory\)/)).toHaveLength(3);
    expect(screen.getAllByText("Top level").length).toBeGreaterThan(0);
    expect(screen.getByTitle("0 direct, 3 including subcategories")).toHaveTextContent("0");

    // Rows are in tree order: Drinkware, Bottles, Insulated.
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Drinkware")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Bottles")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Insulated")).toBeInTheDocument();
  });

  it("offers only legal parents and sends the chosen parent on save", async () => {
    const user = userEvent.setup();
    const { requests } = installHierarchyFetch();
    renderWithProviders(<AdminCategoriesPage />, { route: "/admin/categories" });

    await screen.findAllByText("Bottles");
    const bottleRow = screen
      .getByRole("button", { name: "Delete Bottles" })
      .closest("tr") as HTMLElement;
    await user.click(within(bottleRow).getByRole("button", { name: "Edit" }));

    const dialog = await screen.findByRole("dialog");
    const parentSelect = within(dialog).getByLabelText(/^Parent category/) as HTMLSelectElement;

    // Self and its descendants can never be chosen.
    expect(within(parentSelect).queryByRole("option", { name: /Bottles/ })).toBeNull();
    expect(within(parentSelect).queryByRole("option", { name: /Insulated/ })).toBeNull();
    expect(within(parentSelect).getByRole("option", { name: "Drinkware" })).toBeInTheDocument();
    expect(within(parentSelect).getByRole("option", { name: /Cups/ })).toBeInTheDocument();
    expect(within(parentSelect).getByRole("option", { name: /Top level/ })).toBeInTheDocument();

    await user.selectOptions(parentSelect, "10");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(
        requests.find(
          (request) => request.method === "PUT" && request.url.pathname === "/api/categories/11",
        ),
      ).toBeTruthy(),
    );
    const update = requests.find(
      (request) => request.method === "PUT" && request.url.pathname === "/api/categories/11",
    );
    expect(JSON.parse(update?.body ?? "{}").parentId).toBe(10);
  });

  it("maps a server cycle refusal onto the parent field and keeps the dialog open", async () => {
    const user = userEvent.setup();
    installHierarchyFetch(({ url, method }) => {
      if (method === "PUT" && url.pathname === "/api/categories/10") {
        return jsonResponse(
          {
            success: false,
            code: "CATEGORY_CYCLE",
            message: "A category cannot be moved under its own descendant",
          },
          400,
        );
      }
      return undefined;
    });
    renderWithProviders(<AdminCategoriesPage />, { route: "/admin/categories" });

    await screen.findAllByText("Drinkware");
    const row = screen
      .getByRole("button", { name: "Delete Drinkware" })
      .closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Edit" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(
      await within(dialog).findByText("A category cannot be moved under its own descendant"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      within(dialog).getByLabelText(/^Parent category/),
    ).toHaveAttribute("aria-invalid", "true");
  });

  it("explains promoted subcategories when deleting a parent", async () => {
    const user = userEvent.setup();
    installHierarchyFetch(({ url, method }) => {
      if (method === "DELETE" && url.pathname === "/api/categories/10") {
        return jsonResponse({
          success: true,
          message: "Category deleted",
          affectedProducts: 0,
          reparentedChildren: 2,
        });
      }
      return undefined;
    });
    renderWithProviders(<AdminCategoriesPage />, { route: "/admin/categories" });

    await screen.findAllByText("Drinkware");
    await user.click(screen.getByRole("button", { name: "Delete Drinkware" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/2 subcategories move to top level/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete category" }));

    expect(await screen.findByText("Category deleted")).toBeInTheDocument();
    expect(screen.getByText(/2 subcategories moved to top level/)).toBeInTheDocument();
  });

  it("disables parents that are already at the maximum depth when creating", async () => {
    const user = userEvent.setup();
    installHierarchyFetch();
    renderWithProviders(<AdminCategoriesPage />, { route: "/admin/categories" });

    await screen.findAllByText("Drinkware");
    await user.click(screen.getByRole("button", { name: /Add category/ }));

    const dialog = await screen.findByRole("dialog");
    const parentSelect = within(dialog).getByLabelText(/^Parent category/) as HTMLSelectElement;

    expect(within(parentSelect).getByRole("option", { name: /Insulated/ })).toBeDisabled();
    expect(within(parentSelect).getByRole("option", { name: /Bottles/ })).toBeEnabled();
  });
});
