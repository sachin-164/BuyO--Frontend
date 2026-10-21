import { describe, expect, it } from "vitest";
import { loginHref, nextFromSearch, safeNextPath } from "@/lib/auth-return";

describe("return-to helpers", () => {
  it.each([
    ["/account", "/account"],
    [
      "/product/test-lamp?next=1#desc",
      "/product/test-lamp?next=1#desc",
    ],
  ])("accepts same-origin app paths (%s)", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    ["//evil.example/account"],
    ["https://evil.example/account"],
    ["/reset-password"],
    ["/login"],
    ["/signup"],
    [""],
    [null],
  ])("rejects unsafe paths (%s)", (input) => {
    expect(safeNextPath(input as string | null)).toBeNull();
  });

  it("generates a login URL preserving a safe destination", () => {
    expect(loginHref("/orders")).toBe("/login?next=%2Forders");
    expect(loginHref(null)).toBe("/login");
  });

  it("safely parses ?next= from the login route", () => {
    expect(nextFromSearch("?next=%2Faccount")).toBe("/account");
    expect(nextFromSearch("?next=%2F%2Fevil.example")).toBeNull();
  });
});
