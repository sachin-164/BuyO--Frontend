import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchCombobox } from "@/components/catalog/search-combobox";
import { jsonResponse, renderWithProviders } from "@/test/render";

const PRODUCTS = {
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
  pagination: { page: 1, limit: 5, total: 1, totalPages: 1 },
};

const EMPTY = {
  success: true,
  count: 0,
  products: [],
  pagination: { page: 1, limit: 5, total: 0, totalPages: 1 },
};

function installFetch(body: unknown) {
  const fetchMock = vi.fn(async () =>
    jsonResponse(body),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("SearchCombobox", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("suggests live products and opens the selected one with the keyboard", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(PRODUCTS);

    renderWithProviders(<SearchCombobox />, { route: "/search" });

    const input = screen.getByRole("combobox", { name: "Search products" });
    await user.type(input, "lam");

    const option = await screen.findByRole(
      "option",
      { name: /Test Lamp/i },
      { timeout: 2000 },
    );
    expect(option).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();

    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/product/test-lamp");
    });
  });

  it("runs a recent search from the keyboard and stores it again", async () => {
    const user = userEvent.setup();
    installFetch(PRODUCTS);
    window.localStorage.setItem(
      "buyo:recent-searches",
      JSON.stringify(["desk lamp"]),
    );

    renderWithProviders(<SearchCombobox />, { route: "/search" });

    const input = screen.getByRole("combobox", { name: "Search products" });
    await user.click(input);

    expect(
      await screen.findByRole("option", { name: "desk lamp" }),
    ).toBeInTheDocument();

    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/search?q=desk%20lamp",
      );
    });
    expect(window.localStorage.getItem("buyo:recent-searches")).toContain(
      "desk lamp",
    );
  });

  it("submits a search when the catalog has no matches", async () => {
    const user = userEvent.setup();
    installFetch(EMPTY);

    renderWithProviders(<SearchCombobox />, { route: "/search" });

    const input = screen.getByRole("combobox", { name: "Search products" });
    await user.type(input, "unknown");

    expect(
      await screen.findByText(/No matching products yet/, undefined, {
        timeout: 2000,
      }),
    ).toBeInTheDocument();

    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/search?q=unknown",
      );
    });
    expect(window.localStorage.getItem("buyo:recent-searches")).toContain(
      "unknown",
    );
  });
});
