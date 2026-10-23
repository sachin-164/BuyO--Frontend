import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminLayout } from "@/components/admin/admin-layout";
import { clearToken, setToken } from "@/lib/api";
import { installAdminFetch } from "@/test/admin";
import { renderWithProviders } from "@/test/render";

function renderAdmin(route = "/admin") {
  return renderWithProviders(
    <Routes>
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<p>Dashboard content</p>} />
        <Route path="products" element={<p>Products content</p>} />
      </Route>
    </Routes>,
    { route },
  );
}

describe("AdminLayout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearToken();
  });

  it("renders the admin navigation, account details and accessible account menu", async () => {
    installAdminFetch(() => undefined);
    setToken("admin-token");
    const user = userEvent.setup();
    renderAdmin();

    expect(await screen.findByRole("navigation", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByText("Dashboard content")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reviews" })).toHaveAttribute(
      "href",
      "/admin/reviews",
    );

    const accountButton = await screen.findByRole("button", {
      name: "Account menu for Asha Admin",
    });
    await user.click(accountButton);

    const menu = screen.getByRole("menu", { name: "Account" });
    expect(within(menu).getByText("asha@buyo.test")).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Your account" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();

    await waitFor(() => {
      expect(within(menu).getByRole("menuitem", { name: "Your account" })).toHaveFocus();
    });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Account" })).not.toBeInTheDocument();
    expect(accountButton).toHaveFocus();
  });

  it("opens the mobile drawer, navigates and moves focus to the main landmark", async () => {
    installAdminFetch(() => undefined);
    setToken("admin-token");
    const user = userEvent.setup();
    renderAdmin();

    await user.click(screen.getByRole("button", { name: "Open admin navigation" }));
    const drawer = await screen.findByRole("dialog", { name: "Admin navigation" });
    expect(within(drawer).getByRole("navigation", { name: "Admin" })).toBeInTheDocument();

    await user.click(within(drawer).getByRole("link", { name: "Products" }));

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/admin/products");
    });
    expect(screen.getByText("Products content")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Admin navigation" })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(document.getElementById("main")).toHaveFocus();
    });
  });
});
