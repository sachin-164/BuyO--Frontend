import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom does not implement scrolling; React Router calls it on navigation.
window.scrollTo = () => {};

afterEach(() => {
  cleanup();
  // Tokens and the checkout idempotency key are always test-local.
  window.localStorage.clear();
  window.sessionStorage.clear();
});
