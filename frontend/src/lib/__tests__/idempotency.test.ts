import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHECKOUT_IDEMPOTENCY_KEY,
  clearCheckoutIdempotencyKey,
  getCheckoutIdempotencyKey,
} from "@/lib/idempotency";

describe("checkout idempotency", () => {
  beforeEach(() => {
    clearCheckoutIdempotencyKey();
    window.sessionStorage.clear();
  });

  it("returns the same key across retries of one checkout attempt", () => {
    const first = getCheckoutIdempotencyKey();
    const second = getCheckoutIdempotencyKey();

    expect(first).toMatch(/^[A-F0-9]{32}$/i);
    expect(second).toBe(first);
  });

  it("preserves the legacy key and clears it only after success", () => {
    window.sessionStorage.setItem(CHECKOUT_IDEMPOTENCY_KEY, "existing_retry_key_123");

    expect(getCheckoutIdempotencyKey()).toBe("existing_retry_key_123");

    clearCheckoutIdempotencyKey();
    expect(window.sessionStorage.getItem(CHECKOUT_IDEMPOTENCY_KEY)).toBeNull();
    expect(getCheckoutIdempotencyKey()).not.toBe("existing_retry_key_123");
  });

  it("falls back to an in-memory key when sessionStorage is unavailable", () => {
    const getItemSpy = vi
      .spyOn(window.sessionStorage, "getItem")
      .mockImplementation(() => {
        throw new Error("storage suspense");
      });
    const setItemSpy = vi
      .spyOn(window.sessionStorage, "setItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });
    const removeItemSpy = vi
      .spyOn(window.sessionStorage, "removeItem")
      .mockImplementation(() => {});

    const first = getCheckoutIdempotencyKey();
    const second = getCheckoutIdempotencyKey();

    expect(first).toBe(second);
    expect(removeItemSpy).toBeDefined();
    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });
});
