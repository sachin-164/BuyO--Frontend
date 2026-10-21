import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/pages/auth/login-page";
import SignupPage from "@/pages/auth/signup-page";
import CartPage from "@/pages/cart-page";
import { RequireAdmin, RequireAuth } from "@/features/auth/guards";
import {
  jsonResponse,
  renderWithProviders,
} from "@/test/render";
import { clearToken, getToken, setToken } from "@/lib/api";

const CUSTOMER = {
  id: 1,
  name: "Anita Rao",
  email: "anita@example.com",
  isVerified: true,
  role: "customer",
  isAdmin: false,
};

const ADMIN = { ...CUSTOMER, id: 2, role: "admin", isAdmin: true };

function installFetch() {
  const requests: Array<{ url: URL; method: string; body?: string }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    requests.push({ url, method, body });

    if (method === "GET" && url.pathname === "/api/auth/me") {
      return jsonResponse({ success: true, user: CUSTOMER });
    }
    if (method === "POST" && url.pathname === "/api/auth/login") {
      return jsonResponse({
        success: true,
        message: "Signed in",
        token: "token-from-login",
        user: CUSTOMER,
      });
    }
    if (method === "POST" && url.pathname === "/api/auth/signup") {
      return jsonResponse(
        { success: true, message: "Signup successful. Please verify your email." },
        201,
      );
    }
    if (method === "GET" && url.pathname === "/api/cart") {
      return jsonResponse({ success: true, count: 0, items: [], totals: {
        subtotal: 0,
        tax: { total: 0, byCategory: [], preview: true },
        grandTotal: 0,
      } });
    }
    return jsonResponse({ success: false, message: "Not found" }, 404);
  });

  vi.stubGlobal("fetch", fetchMock);
  return requests;
}

describe("route guards", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearToken();
    window.localStorage.clear();
  });

  it("redirects anonymous visitors to login and preserves the destination", () => {
    renderWithProviders(
      <Routes>
        <Route
          path="/account"
          element={
            <RequireAuth>
              <CartPage />
            </RequireAuth>
          }
        />
        <Route path="/login" element={<p>Login page</p>} />
      </Routes>,
      { route: "/account" },
    );

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/login?next=%2Faccount",
    );
  });

  it("clears an invalid token after /api/auth/me returns 401 and redirects", async () => {
    setToken("stale-token");
    const requests: Array<{ url: URL; method: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        requests.push({ url, method: init?.method ?? "GET" });
        if (url.pathname === "/api/auth/me") {
          return jsonResponse(
            { success: false, message: "Invalid or expired session. Please sign in again." },
            401,
          );
        }
        return jsonResponse({ success: false, message: "Not found" }, 404);
      }),
    );

    renderWithProviders(
      <Routes>
        <Route
          path="/account"
          element={
            <RequireAuth>
              <p>Protected content</p>
            </RequireAuth>
          }
        />
        <Route path="/login" element={<p>Login page</p>} />
      </Routes>,
      { route: "/account" },
    );

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/login");
    });
    expect(getToken()).toBeNull();
    expect(requests.some((request) => request.url.pathname === "/api/auth/me")).toBe(true);
  });

  it("shows a session error screen when /api/auth/me fails with a server error", async () => {
    setToken("kept-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ success: false, message: "Server offline" }, 500),
      ),
    );

    renderWithProviders(
      <Routes>
        <Route
          path="/account"
          element={
            <RequireAuth>
              <p>Protected content</p>
            </RequireAuth>
          }
        />
      </Routes>,
      { route: "/account" },
    );

    expect(
      await screen.findByText(/We could not check your session/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("shows the 403 page when a signed-in customer opens an admin route", async () => {
    setToken("customer-token");
    installFetch();
    renderWithProviders(
      <Routes>
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <p>Admin workspace</p>
            </RequireAdmin>
          }
        />
      </Routes>,
      { route: "/admin" },
    );

    expect(await screen.findByText("403 — Access denied")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Administrator access required/i }),
    ).toBeInTheDocument();
  });

  it("renders admin children for an administrator session", async () => {
    setToken("admin-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname === "/api/auth/me") {
          return jsonResponse({ success: true, user: ADMIN });
        }
        return jsonResponse({ success: false, message: "Not found" }, 404);
      }),
    );

    renderWithProviders(
      <Routes>
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <p>Admin workspace</p>
            </RequireAdmin>
          }
        />
      </Routes>,
      { route: "/admin" },
    );

    expect(await screen.findByText("Admin workspace")).toBeInTheDocument();
  });
});

describe("LoginPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearToken();
    window.localStorage.clear();
  });

  it("signs in and honours a safe ?next= destination", async () => {
    const user = userEvent.setup();
    const requests = installFetch();
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/account" element={<p>Account page</p>} />
      </Routes>,
      { route: "/login?next=%2Faccount" },
    );

    await user.type(screen.getByLabelText(/Email/i), "anita@example.com");
    await user.type(screen.getByLabelText(/Password/i), "correct-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Account page")).toBeInTheDocument();
    expect(getToken()).toBe("token-from-login");
    expect(
      requests.find((request) => request.url.pathname === "/api/auth/login")?.body,
    ).toBe(JSON.stringify({ email: "anita@example.com", password: "correct-password" }));
  });

  it("reports invalid credentials without signing in", async () => {
    const user = userEvent.setup();
    const requests = installFetch();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        requests.push({ url, method: init?.method ?? "GET", body: init?.body as string });
        if (url.pathname === "/api/auth/login") {
          return jsonResponse({ success: false, message: "Invalid email or password" }, 401);
        }
        return jsonResponse({ success: false, message: "Not found" }, 404);
      }),
    );

    renderWithProviders(<LoginPage />, { route: "/login" });

    await user.type(screen.getByLabelText(/Email/i), "anita@example.com");
    await user.type(screen.getByLabelText(/Password/i), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Sign in failed")).toBeInTheDocument();
    expect(screen.getByText("Invalid email or password")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/login");
  });

  it("explains the unverified account state returned by the server", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { success: false, message: "Please verify your email before signing in." },
          403,
        ),
      ),
    );

    renderWithProviders(<LoginPage />, { route: "/login" });

    await user.type(screen.getByLabelText(/Email/i), "anita@example.com");
    await user.type(screen.getByLabelText(/Password/i), "correct-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Sign in failed")).toBeInTheDocument();
    expect(
      screen.getByText(/Please verify your email before signing in/i),
    ).toBeInTheDocument();
  });

  it("shows the server-driven verification status banner", () => {
    renderWithProviders(<LoginPage />, { route: "/login?status=success" });

    expect(screen.getByText("Email verified")).toBeInTheDocument();
    expect(
      screen.getByText(/Your email address is confirmed\. You can now sign in\./i),
    ).toBeInTheDocument();
  });

  it("requires both fields before submitting", async () => {
    const user = userEvent.setup();
    installFetch();
    renderWithProviders(<LoginPage />, { route: "/login" });

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByText("Email is required")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
  });
});

describe("SignupPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearToken();
    window.localStorage.clear();
  });

  it("creates an account and asks the user to verify the email", async () => {
    const user = userEvent.setup();
    const requests = installFetch();
    renderWithProviders(<SignupPage />, { route: "/signup" });

    await user.type(screen.getByLabelText(/Full name/i), "Anita Rao");
    await user.type(screen.getByLabelText(/Email/i), "anita@example.com");
    await user.type(screen.getByLabelText(/^Password/i), "long-password");
    await user.type(screen.getByLabelText(/Confirm password/i), "long-password");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    expect(
      screen.getByText(/We sent a verification link to anita@example\.com/i),
    ).toBeInTheDocument();
    expect(
      requests.find((request) => request.url.pathname === "/api/auth/signup")?.body,
    ).toBe(
      JSON.stringify({ name: "Anita Rao", email: "anita@example.com", password: "long-password" }),
    );
  });

  it("reports a duplicate email from the server", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ success: false, message: "Email is already registered" }, 409),
      ),
    );

    renderWithProviders(<SignupPage />, { route: "/signup" });

    await user.type(screen.getByLabelText(/Full name/i), "Anita Rao");
    await user.type(screen.getByLabelText(/Email/i), "anita@example.com");
    await user.type(screen.getByLabelText(/^Password/i), "long-password");
    await user.type(screen.getByLabelText(/Confirm password/i), "long-password");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Signup failed")).toBeInTheDocument();
    expect(screen.getByText("Email is already registered")).toBeInTheDocument();
  });

  it("rejects mismatched passwords without a request", async () => {
    const user = userEvent.setup();
    const requests = installFetch();
    renderWithProviders(<SignupPage />, { route: "/signup" });

    await user.type(screen.getByLabelText(/Full name/i), "Anita Rao");
    await user.type(screen.getByLabelText(/Email/i), "anita@example.com");
    await user.type(screen.getByLabelText(/^Password/i), "long-password");
    await user.type(screen.getByLabelText(/Confirm password/i), "different-password");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByText("Passwords do not match")).toBeInTheDocument();
    expect(
      requests.filter((request) => request.url.pathname === "/api/auth/signup"),
    ).toHaveLength(0);
  });
});
