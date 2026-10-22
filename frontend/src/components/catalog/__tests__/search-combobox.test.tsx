import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchCombobox } from "@/components/catalog/search-combobox";
import { jsonResponse, renderWithProviders } from "@/test/render";

interface RecordedRequest {
  url: URL;
  method: string;
}

const RESULTS = [
  { id: 1, slug: "steel-bottle", name: "Steel Bottle", price: 400, image: "/uploads/bottle.png" },
  { id: 2, slug: "steel-mug", name: "Steel Mug", price: 250, image: "" },
];

function installFetch({ status = 200 }: { status?: number } = {}) {
  const requests: RecordedRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    requests.push({ url, method });

    if (url.pathname === "/api/products/suggestions") {
      if (status !== 200) {
        return jsonResponse({ success: false, message: "Suggestions offline" }, status);
      }
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const suggestions = RESULTS.filter((entry) => entry.name.toLowerCase().includes(q));
      return jsonResponse({
        success: true,
        query: q,
        count: suggestions.length,
        suggestions,
      });
    }

    return jsonResponse({ success: false, message: "Not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { requests, fetchMock };
}

const suggestionCalls = (requests: RecordedRequest[]) =>
  requests.filter((request) => request.url.pathname === "/api/products/suggestions");

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("SearchCombobox", () => {
  it("does not query until there are two characters, then queries once for the term", async () => {
    const user = userEvent.setup();
    const { requests } = installFetch();
    renderWithProviders(<SearchCombobox />);

    const input = screen.getByRole("combobox", { name: "Search products" });
    await user.type(input, "s");
    // Long enough for the 250 ms debounce to have fired, if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(suggestionCalls(requests)).toHaveLength(0);

    await user.type(input, "teel");
    expect(await screen.findByText("Steel Bottle")).toBeInTheDocument();
    const calls = suggestionCalls(requests);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.searchParams.get("q")).toBe("steel");
  });

  it("renders suggestions, announces the count and opens the active product on Enter", async () => {
    const user = userEvent.setup();
    installFetch();
    renderWithProviders(<SearchCombobox />);

    await user.type(screen.getByRole("combobox", { name: "Search products" }), "steel");

    expect(await screen.findByText("Steel Bottle")).toBeInTheDocument();
    expect(screen.getByText("Steel Mug")).toBeInTheDocument();
    expect(screen.getByText("₹400")).toBeInTheDocument();
    expect(
      screen.getByText("2 suggestions — use ↑ ↓ to choose, Enter to open."),
    ).toBeInTheDocument();

    const combobox = screen.getByRole("combobox", { name: "Search products" });
    expect(combobox).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{ArrowDown}");
    const firstOption = screen.getAllByRole("option")[0];
    expect(firstOption).toHaveAttribute("aria-selected", "true");
    expect(combobox).toHaveAttribute("aria-activedescendant", firstOption.id);

    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/product/steel-bottle"),
    );
  });

  it("wraps with ArrowUp and closes with Escape", async () => {
    const user = userEvent.setup();
    installFetch();
    renderWithProviders(<SearchCombobox />);

    const combobox = screen.getByRole("combobox", { name: "Search products" });
    await user.type(combobox, "steel");
    await screen.findByText("Steel Bottle");

    // ArrowUp from nothing active lands on the last option, including the
    // trailing "Search for …" action.
    await user.keyboard("{ArrowUp}");
    const options = screen.getAllByRole("option");
    expect(options[options.length - 1]).toHaveAttribute("aria-selected", "true");
    expect(options[options.length - 1]).toHaveTextContent('Search for “steel”');

    await user.keyboard("{Escape}");
    expect(combobox).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("searches with Enter when nothing is highlighted and remembers the term", async () => {
    const user = userEvent.setup();
    installFetch();
    renderWithProviders(<SearchCombobox />);

    const combobox = screen.getByRole("combobox", { name: "Search products" });
    await user.type(combobox, "steel{Enter}");

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/search?q=steel"),
    );
    expect(JSON.parse(window.localStorage.getItem("buyo:recent-searches") ?? "[]")).toEqual([
      "steel",
    ]);
  });

  it("offers recent searches when the input is empty", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("buyo:recent-searches", JSON.stringify(["bottle"]));
    installFetch();
    renderWithProviders(<SearchCombobox />);

    await user.click(screen.getByRole("combobox", { name: "Search products" }));

    expect(screen.getByText("Recent searches")).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /bottle/i }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/search?q=bottle"),
    );
    // Running a recent search moves it back to the top of the list.
    expect(window.localStorage.getItem("buyo:recent-searches")).toContain("bottle");
  });

  it("submits a search when the endpoint has no matches", async () => {
    const user = userEvent.setup();
    installFetch();
    renderWithProviders(<SearchCombobox />, { route: "/search" });

    const input = screen.getByRole("combobox", { name: "Search products" });
    await user.type(input, "obsidian");

    expect(
      await screen.findByText("No matching products — press Enter to search."),
    ).toBeInTheDocument();

    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/search?q=obsidian"),
    );
    expect(window.localStorage.getItem("buyo:recent-searches")).toContain("obsidian");
  });

  it("keeps manual search available when suggestions fail", async () => {
    const user = userEvent.setup();
    installFetch({ status: 500 });
    renderWithProviders(<SearchCombobox />);

    await user.type(screen.getByRole("combobox", { name: "Search products" }), "steel");

    expect(
      await screen.findByText("Suggestions are unavailable — press Enter to search."),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Search for “steel”/ })).toBeInTheDocument();
  });
});
