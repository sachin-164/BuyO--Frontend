import { afterEach, describe, expect, it, vi } from "vitest";
import { getToken, setToken } from "@/lib/api";
import { MAX_IMAGE_BYTES, uploadProductImage, validateImageFile } from "@/features/admin/upload";
import { jsonResponse } from "@/test/render";

function imageFile(size = 2048, type = "image/png") {
  return new File([new Uint8Array(size)], "photo.png", { type });
}

const AUTHORIZATION = {
  success: true,
  objectPath: "products/server-generated.png",
  signedUploadUrl: "https://storage.example.test/object/upload/sign/abc?token=secret",
  publicUrl: "https://storage.example.test/object/public/products/server-generated.png",
  expiresAt: "2026-01-01T00:05:00.000Z",
  maxBytes: MAX_IMAGE_BYTES,
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("admin product image upload", () => {
  it("authorizes once, PUTs bytes to the signed URL without the app token, and returns the object path", async () => {
    setToken("admin-token");
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.includes("/api/uploads/authorize")) return jsonResponse(AUTHORIZATION);
        if (url.startsWith("https://storage.example.test/")) return new Response(null, { status: 200 });
        return jsonResponse({ success: false, message: "unexpected" }, 500);
      }),
    );

    const result = await uploadProductImage(imageFile());

    expect(result).toEqual({
      mode: "direct",
      objectPath: AUTHORIZATION.objectPath,
      publicUrl: AUTHORIZATION.publicUrl,
    });
    expect(calls).toHaveLength(2);

    const authorizeHeaders = new Headers(calls[0].init?.headers);
    expect(authorizeHeaders.get("Authorization")).toBe("Bearer admin-token");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      filename: "photo.png",
      contentType: "image/png",
      size: 2048,
    });

    expect(calls[1].init?.method).toBe("PUT");
    const storageHeaders = new Headers(calls[1].init?.headers);
    expect(storageHeaders.get("Authorization")).toBeNull();
    expect(storageHeaders.get("Content-Type")).toBe("image/png");
    expect(calls[1].init?.credentials).toBe("omit");
  });

  it("returns local mode when the API reports local storage and never PUTs bytes", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        { success: false, code: "local-storage", message: "Direct upload is unavailable." },
        409,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadProductImage(imageFile());

    expect(result).toEqual({ mode: "local" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces authorization failures without uploading", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: false, message: "Access denied" }, 403),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadProductImage(imageFile());

    expect(result).toMatchObject({ mode: "error", status: 403, message: "Access denied" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a failed storage PUT and does not claim success", async () => {
    setToken("admin-token");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/uploads/authorize")) return jsonResponse(AUTHORIZATION);
      return new Response("nope", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadProductImage(imageFile());

    expect(result).toMatchObject({
      mode: "error",
      status: 500,
      message: "The image could not be uploaded to storage. Nothing was saved.",
    });
  });

  it("turns a network failure on authorization into an actionable error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));

    const result = await uploadProductImage(imageFile());

    expect(result.mode).toBe("error");
    if (result.mode === "error") {
      expect(result.message).toMatch(/connection/i);
    }
  });

  it("validates image type, empty files and the size cap before authorizing", async () => {
    expect(validateImageFile(imageFile(2048, "image/svg+xml"))).toMatch(/JPEG/);
    expect(validateImageFile(new File([], "empty.png", { type: "image/png" }))).toMatch(/empty/);
    expect(validateImageFile(imageFile(MAX_IMAGE_BYTES + 1))).toMatch(/5 MB/);
    expect(validateImageFile(imageFile())).toBeNull();
  });

  it("does not clear an existing session while authorizing", async () => {
    setToken("admin-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/uploads/authorize")) return jsonResponse(AUTHORIZATION);
        return new Response(null, { status: 200 });
      }),
    );

    await uploadProductImage(imageFile());

    expect(getToken()).toBe("admin-token");
  });
});
