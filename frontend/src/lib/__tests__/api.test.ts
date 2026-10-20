import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, clearToken, getToken, setToken } from "@/lib/api";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api client", () => {
  beforeEach(() => {
    clearToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores the session under the legacy `token` key", () => {
    setToken("abc");
    expect(getToken()).toBe("abc");
    expect(window.localStorage.getItem("token")).toBe("abc");
  });

  it("attaches the bearer token to requests", async () => {
    setToken("test-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, message: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    await api.get("/api/auth/me");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer test-token");
    expect(headers.get("Accept")).toBe("application/json");
  });

  it("normalizes error responses into ApiError", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: false, message: "Admin only" }, 403));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get("/api/admin/orders")).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      message: "Admin only",
    });
  });

  it("returns null for empty successful bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(api.delete("/api/cart/1")).resolves.toBeNull();
  });

  it("reports network failures without leaking internals", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(api.get("/api/products")).rejects.toBeInstanceOf(ApiError);
    await expect(api.get("/api/products")).rejects.toMatchObject({ status: 0 });
  });
});
