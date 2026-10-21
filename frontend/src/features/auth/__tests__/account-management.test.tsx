import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";
import AccountPage from "@/pages/account-page";
import LoginPage from "@/pages/auth/login-page";
import VerifyPage from "@/pages/auth/verify-page";
import { RequireAuth } from "@/features/auth/guards";
import { clearToken, getToken, setToken } from "@/lib/api";
import { jsonResponse, renderWithProviders } from "@/test/render";

const USER = {
  id: 1,
  name: "Anita Rao",
  email: "anita@example.com",
  isVerified: true,
  role: "customer",
  isAdmin: false,
};

interface Options {
  patchStatus?: number;
  changePasswordStatus?: number;
  loginStatus?: number;
}

function installFetch({
  patchStatus = 200,
  changePasswordStatus = 200,
  loginStatus = 200,
}: Options = {}) {
  const requests: Array<{ url: URL; method: string; body: unknown }> = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    let body: unknown = null;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    requests.push({ url, method, body });

    if (method === "GET" && url.pathname === "/api/auth/me") {
      return jsonResponse({ success: true, user: USER });
    }
    if (method === "PATCH" && url.pathname === "/api/auth/me") {
      if (patchStatus >= 400) {
        return jsonResponse({ success: false, message: "Profile could not be updated." }, patchStatus);
      }
      const name = (body as { name: string }).name;
      return jsonResponse({
        success: true,
        message: "Profile updated",
        user: { ...USER, name },
      });
    }
    if (method === "POST" && url.pathname === "/api/auth/change-password") {
      if (changePasswordStatus === 400) {
        return jsonResponse(
          {
            success: false,
            code: "INVALID_CURRENT_PASSWORD",
            message: "Current password is incorrect.",
          },
          400,
        );
      }
      if (changePasswordStatus >= 400) {
        return jsonResponse({ success: false, message: "Password could not be updated." }, 500);
      }
      return jsonResponse({
        success: true,
        message: "Password updated. Other devices have been signed out.",
        token: "fresh-token",
        user: USER,
      });
    }
    if (method === "POST" && url.pathname === "/api/auth/resend-verification") {
      return jsonResponse({
        success: true,
        message:
          "If an unverified account exists for that email, a new verification link has been sent.",
      });
    }
    if (method === "POST" && url.pathname === "/api/auth/login") {
      if (loginStatus === 403) {
        return jsonResponse(
          {
            success: false,
            message: "Email not verified. Please check your inbox for the verification link.",
          },
          403,
        );
      }
      return jsonResponse({
        success: true,
        message: "Login successful",
        token: "login-token",
        user: USER,
      });
    }
    return jsonResponse({ success: false, message: "Not found" }, 404);
  });

  vi.stubGlobal("fetch", fetchMock);
  return requests;
}

function renderAccount() {
  return renderWithProviders(
    <Routes>
      <Route
        path="/account"
        element={
          <RequireAuth>
            <AccountPage />
          </RequireAuth>
        }
      />
      <Route path="/login" element={<p>Login page</p>} />
    </Routes>,
    { route: "/account" },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearToken();
  window.localStorage.clear();
});

describe("account profile editing", () => {
  it("prefills the current name and saves a new one", async () => {
    setToken("customer-token");
    const user = userEvent.setup();
    const requests = installFetch();
    renderAccount();

    const nameInput = await screen.findByLabelText(/display name/i);
    expect(nameInput).toHaveValue("Anita Rao");

    await user.clear(nameInput);
    await user.type(nameInput, "Anita R. Rao");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      const patch = requests.find(
        (request) => request.method === "PATCH" && request.url.pathname === "/api/auth/me",
      );
      expect(patch?.body).toEqual({ name: "Anita R. Rao" });
    });

    expect(await screen.findByText("Profile updated")).toBeInTheDocument();
    // The auth cache was replaced with the returned user, so the heading updates.
    expect(await screen.findByRole("heading", { level: 1, name: "Anita R. Rao" })).toBeInTheDocument();
  });

  it("blocks an empty name before calling the API", async () => {
    setToken("customer-token");
    const user = userEvent.setup();
    const requests = installFetch();
    renderAccount();

    const nameInput = await screen.findByLabelText(/display name/i);
    await user.clear(nameInput);
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(requests.some((request) => request.method === "PATCH")).toBe(false);
  });
});

describe("password change", () => {
  it("refuses mismatched confirmation without calling the API", async () => {
    setToken("customer-token");
    const user = userEvent.setup();
    const requests = installFetch();
    renderAccount();

    await user.type(await screen.findByLabelText(/current password/i), "Password123!");
    await user.type(screen.getByLabelText(/^new password/i), "RotatedPass456!");
    await user.type(screen.getByLabelText(/confirm new password/i), "RotatedPass999!");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(
      requests.some((request) => request.url.pathname === "/api/auth/change-password"),
    ).toBe(false);
  });

  it("sends the current and new password, then stores the replacement token", async () => {
    setToken("customer-token");
    const user = userEvent.setup();
    const requests = installFetch();
    renderAccount();

    await user.type(await screen.findByLabelText(/current password/i), "Password123!");
    await user.type(screen.getByLabelText(/^new password/i), "RotatedPass456!");
    await user.type(screen.getByLabelText(/confirm new password/i), "RotatedPass456!");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => {
      const call = requests.find(
        (request) => request.url.pathname === "/api/auth/change-password",
      );
      expect(call?.body).toEqual({
        currentPassword: "Password123!",
        newPassword: "RotatedPass456!",
      });
    });

    expect(await screen.findByText("Password updated")).toBeInTheDocument();
    expect(getToken()).toBe("fresh-token");
    // Form was cleared, so the fields no longer hold secrets.
    expect(screen.getByLabelText(/current password/i)).toHaveValue("");
    expect(screen.getByLabelText(/^new password/i)).toHaveValue("");
  });

  it("maps a wrong current password onto the field", async () => {
    setToken("customer-token");
    const user = userEvent.setup();
    installFetch({ changePasswordStatus: 400 });
    renderAccount();

    await user.type(await screen.findByLabelText(/current password/i), "wrong-password");
    await user.type(screen.getByLabelText(/^new password/i), "RotatedPass456!");
    await user.type(screen.getByLabelText(/confirm new password/i), "RotatedPass456!");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Current password is incorrect")).toBeInTheDocument();
    expect(getToken()).toBe("customer-token");
  });
});

describe("verification resend", () => {
  it("offers a prefilled resend after an unverified sign-in attempt", async () => {
    const user = userEvent.setup();
    const requests = installFetch({ loginStatus: 403 });
    renderWithProviders(<LoginPage />, { route: "/login" });

    await user.type(screen.getByLabelText(/email/i), "anita@example.com");
    await user.type(screen.getByLabelText(/^password/i), "Password123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const resendInput = await screen.findByLabelText(/email/i, { selector: "#resend-email" });
    expect(resendInput).toHaveValue("anita@example.com");

    await user.click(screen.getByRole("button", { name: "Resend verification email" }));

    await waitFor(() => {
      const call = requests.find(
        (request) => request.url.pathname === "/api/auth/resend-verification",
      );
      expect(call?.body).toEqual({ email: "anita@example.com" });
    });

    // The generic server wording is repeated verbatim, never "we found you".
    expect(await screen.findByText(/If an unverified account exists for that email/i)).toBeInTheDocument();
  });

  it("shows the resend form when a verification link is missing", async () => {
    const user = userEvent.setup();
    const requests = installFetch();
    renderWithProviders(<VerifyPage />, { route: "/verify" });

    expect(screen.getByText("No verification token found")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/email/i), "someone@example.com");
    await user.click(screen.getByRole("button", { name: "Resend verification email" }));

    await waitFor(() => {
      const call = requests.find(
        (request) => request.url.pathname === "/api/auth/resend-verification",
      );
      expect(call?.body).toEqual({ email: "someone@example.com" });
    });

    expect(await screen.findByText(/If an unverified account exists for that email/i)).toBeInTheDocument();
  });
});
