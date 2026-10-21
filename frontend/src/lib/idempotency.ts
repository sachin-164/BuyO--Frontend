/**
 * The legacy checkout used this exact sessionStorage key, so a retry in the
 * React app remains idempotent against the same server-side order.
 */
export const CHECKOUT_IDEMPOTENCY_KEY = "buyo:checkout:idempotencyKey";
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

let memoryKey: string | null = null;

function generateKey(): string {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function getCheckoutIdempotencyKey(): string {
  try {
    const stored = window.sessionStorage.getItem(CHECKOUT_IDEMPOTENCY_KEY);
    if (stored && KEY_PATTERN.test(stored)) {
      memoryKey = stored;
      return stored;
    }
  } catch {
    /* sessionStorage may be unavailable */
  }

  if (memoryKey && KEY_PATTERN.test(memoryKey)) return memoryKey;

  memoryKey = generateKey();
  try {
    window.sessionStorage.setItem(CHECKOUT_IDEMPOTENCY_KEY, memoryKey);
  } catch {
    /* keep the in-memory key so retries in this tab stay idempotent */
  }
  return memoryKey;
}

export function clearCheckoutIdempotencyKey(): void {
  memoryKey = null;
  try {
    window.sessionStorage.removeItem(CHECKOUT_IDEMPOTENCY_KEY);
  } catch {
    /* ignore */
  }
}
