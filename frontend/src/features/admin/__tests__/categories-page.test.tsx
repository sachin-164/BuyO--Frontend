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
