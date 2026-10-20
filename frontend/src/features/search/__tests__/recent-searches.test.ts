import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  addRecentSearch,
  clearRecentSearches,
  useRecentSearches,
} from "@/features/search/recent-searches";

const KEY = "buyo:recent-searches";

describe("recent searches", () => {
  it("keeps the newest six unique terms, case-insensitively", () => {
    ["one", "two", "three", "four", "five", "six", "seven"].forEach(addRecentSearch);
    addRecentSearch("THREE");

    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "[]")).toEqual([
      "THREE",
      "seven",
      "six",
      "five",
      "four",
      "two",
    ]);
  });

  it("clears stored searches", () => {
    addRecentSearch("lamp");
    clearRecentSearches();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("survives malformed storage", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(() => addRecentSearch("lamp")).not.toThrow();
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "[]")).toEqual(["lamp"]);
  });

  it("updates mounted consumers when a search is added", () => {
    const { result } = renderHook(() => useRecentSearches());

    act(() => {
      result.current.add("desk lamp");
    });

    expect(result.current.searches).toEqual(["desk lamp"]);

    act(() => {
      result.current.clear();
    });

    expect(result.current.searches).toEqual([]);
  });
});
