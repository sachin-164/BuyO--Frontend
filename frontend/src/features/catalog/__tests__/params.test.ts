import { describe, expect, it } from "vitest";
import {
  DEFAULT_CATALOG_QUERY,
  buildCatalogHref,
  buildCatalogSearch,
  hasActiveFilters,
  hasPriceRangeError,
  parseCatalogQuery,
  toApiProductQuery,
} from "@/features/catalog/params";

describe("catalog URL state", () => {
  it("parses every supported parameter", () => {
    const query = parseCatalogQuery(
      new URLSearchParams(
        "q=%20lamp%20&category=lighting&sort=price_desc&page=3&minPrice=500&maxPrice=2000&inStock=1",
      ),
    );

    expect(query).toEqual({
      q: "lamp",
      category: "lighting",
      sort: "price_desc",
      page: 3,
      minPrice: 500,
      maxPrice: 2000,
      inStock: true,
    });
  });

  it("falls back safely for invalid shared links", () => {
    const query = parseCatalogQuery(
      new URLSearchParams("sort=popular&page=-2&minPrice=abc&maxPrice=-4&inStock=yes"),
    );

    expect(query.sort).toBe(DEFAULT_CATALOG_QUERY.sort);
    expect(query.page).toBe(1);
    expect(query.minPrice).toBeNull();
    expect(query.maxPrice).toBeNull();
    expect(query.inStock).toBe(false);
  });

  it("omits defaults so shared URLs stay short", () => {
    const params = buildCatalogSearch({ ...DEFAULT_CATALOG_QUERY });
    expect(params.toString()).toBe("");
    expect(buildCatalogHref("/shop", DEFAULT_CATALOG_QUERY)).toBe("/shop");

    const filtered = buildCatalogHref("/search", {
      ...DEFAULT_CATALOG_QUERY,
      q: "desk lamp",
      category: "lighting",
      sort: "price_asc",
      page: 2,
      minPrice: 100,
      inStock: true,
    });
    expect(filtered).toBe(
      "/search?q=desk+lamp&category=lighting&sort=price_asc&page=2&minPrice=100&inStock=1",
    );
  });

  it("maps URL state onto the real API contract", () => {
    const apiQuery = toApiProductQuery({
      ...DEFAULT_CATALOG_QUERY,
      q: "lamp",
      category: "lighting",
      minPrice: 500,
      maxPrice: 2000,
      inStock: true,
      sort: "name_asc",
      page: 2,
    });

    expect(apiQuery).toEqual({
      q: "lamp",
      category: "lighting",
      minPrice: 500,
      maxPrice: 2000,
      inStock: true,
      sort: "name_asc",
      page: 2,
      limit: 12,
    });
  });

  it("detects active filters and inverted price ranges", () => {
    expect(hasActiveFilters(DEFAULT_CATALOG_QUERY)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_CATALOG_QUERY, inStock: true })).toBe(true);
    expect(
      hasPriceRangeError({ ...DEFAULT_CATALOG_QUERY, minPrice: 900, maxPrice: 100 }),
    ).toBe(true);
    expect(
      hasPriceRangeError({ ...DEFAULT_CATALOG_QUERY, minPrice: 100, maxPrice: 900 }),
    ).toBe(false);
  });
});
