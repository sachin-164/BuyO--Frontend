import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminReviewsPage from "@/pages/admin/reviews-page";
import { clearToken, setToken } from "@/lib/api";
import { installAdminFetch, type MockHandler } from "@/test/admin";
import { jsonResponse, renderWithProviders } from "@/test/render";
import type { AdminReview, ReviewStatus } from "@/types/reviews";

const PRODUCT = { id: 3, name: "Steel Bottle", slug: "steel-bottle", image: null };
const CUSTOMER = { id: 1, name: "Anita Rao", email: "anita@example.com" };

const PENDING: AdminReview = {
  id: 77,
  rating: 5,
  title: "Keeps tea hot",
  body: "It kept my tea hot for the whole morning commute.",
  status: "pending",
  moderatedBy: null,
  moderatedAt: null,
  createdAt: "2026-01-05T10:00:00.000Z",
  updatedAt: "2026-01-05T10:00:00.000Z",
  product: PRODUCT,
  customer: CUSTOMER,
};

const APPROVED: AdminReview = {
  ...PENDING,
  id: 78,
  title: "Good bottle",
  body: "A sturdy bottle that survived a full month of commuting.",
  status: "approved",
  moderatedBy: 2,
  moderatedAt: "2026-01-06T09:00:00.000Z",
};

function reviewResponse(
  reviews: AdminReview[] = [PENDING],
  statusCounts: Record<ReviewStatus, number> = { pending: 1, approved: 0, rejected: 0 },
  total = reviews.length,
) {
  return jsonResponse({
    success: true,
    count: reviews.length,
    reviews,
    statusCounts,
    pagination: {
      page: 1,
      limit: 20,
      total,
      totalPages: Math.max(1, Math.ceil(total / 20)),
      hasNext: false,
      hasPrev: false,
    },
  });
}

function installReviewFetch(overrides: MockHandler = () => undefined) {
  return installAdminFetch((request) => {
    const { url, method } = request;
    const override = overrides(request);
    if (override) return override;

    if (method === "GET" && url.pathname === "/api/admin/reviews") {
      if (url.searchParams.get("status") === "approved") {
        return reviewResponse([APPROVED], { pending: 1, approved: 1, rejected: 0 }, 2);
      }
      if (url.searchParams.get("status") === "all") {
        return reviewResponse([PENDING, APPROVED], { pending: 1, approved: 1, rejected: 0 }, 2);
      }
      return reviewResponse();
    }
    if (method === "PATCH" && /^\/api\/admin\/reviews\/\d+$/.test(url.pathname)) {
      return jsonResponse({
        success: true,
        unchanged: false,
        message: "Review approved",
        review: {
          id: PENDING.id,
          productId: 3,
          status: "approved",
          moderatedBy: 2,
          moderatedAt: "2026-01-06T09:00:00.000Z",
          updatedAt: "2026-01-06T09:00:00.000Z",
        },
      });
    }
    return undefined;
  });
}

function renderPage(route = "/admin/reviews") {
  return renderWithProviders(<AdminReviewsPage />, { route });
}

beforeEach(() => setToken("admin-token"));

afterEach(() => {
  vi.unstubAllGlobals();
  clearToken();
});

describe("AdminReviewsPage", () => {
  it("lists pending reviews with product, customer and status counts", async () => {
    installReviewFetch();
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Review moderation" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Keeps tea hot")).toBeInTheDocument();
    expect(screen.getByText("It kept my tea hot for the whole morning commute.")).toBeInTheDocument();
    expect(screen.getByText("Anita Rao")).toBeInTheDocument();
    expect(screen.getByText("anita@example.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Steel Bottle" })).toHaveAttribute(
      "href",
      "/product/steel-bottle",
    );
    expect(screen.getByRole("button", { name: /Pending/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Approved/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("approves after confirmation and sends only the whitelisted status", async () => {
    const user = userEvent.setup();
    const { requests } = installReviewFetch();
    renderPage();

    await screen.findByText("Keeps tea hot");
    await user.click(screen.getByRole("button", { name: "Approve" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Publish this review?")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));

    expect(await screen.findByText("Review approved")).toBeInTheDocument();
    const patch = requests.find((request) => request.method === "PATCH");
    expect(patch?.url.pathname).toBe("/api/admin/reviews/77");
    expect(JSON.parse(patch?.body ?? "{}")).toEqual({ status: "approved" });
  });

  it("filters by status, searches and can change an approved review", async () => {
    const user = userEvent.setup();
    const { requests } = installReviewFetch();
    renderPage();

    await screen.findByText("Keeps tea hot");
    await user.click(screen.getByRole("button", { name: /Approved/ }));

    expect(await screen.findByText("Good bottle")).toBeInTheDocument();
    expect(screen.getByText(/Moderated .* by #2/)).toBeInTheDocument();
    expect(
      requests.some(
        (request) =>
          request.method === "GET" &&
          request.url.pathname === "/api/admin/reviews" &&
          request.url.searchParams.get("status") === "approved",
      ),
    ).toBe(true);

    // An approved review can still be rejected, and cannot be approved twice
    // from the UI (the server also treats a repeated status as a safe no-op).
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reject" }));
    const rejectDialog = await screen.findByRole("dialog");
    expect(within(rejectDialog).getByText("Reject this review?")).toBeInTheDocument();
    await user.click(within(rejectDialog).getByRole("button", { name: "Reject" }));

    await waitFor(() => {
      const patch = requests.find((request) => request.method === "PATCH");
      expect(JSON.parse(patch?.body ?? "{}")).toEqual({ status: "rejected" });
    });

    await user.type(screen.getByLabelText("Search reviews"), "cotton");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      const search = requests.find(
        (request) =>
          request.method === "GET" &&
          request.url.pathname === "/api/admin/reviews" &&
          request.url.searchParams.get("q") === "cotton",
      );
      expect(search?.url.searchParams.get("status")).toBe("approved");
    });
  });

  it("shows an empty queue", async () => {
    installReviewFetch(({ url, method }) => {
      if (method === "GET" && url.pathname === "/api/admin/reviews") {
        return reviewResponse([], { pending: 0, approved: 0, rejected: 0 }, 0);
      }
      return undefined;
    });
    renderPage();

    expect(await screen.findByText("No pending reviews")).toBeInTheDocument();
  });

  it("shows a retryable error state", async () => {
    installReviewFetch(({ url, method }) => {
      if (method === "GET" && url.pathname === "/api/admin/reviews") {
        return jsonResponse({ success: false, message: "Review queue failed" }, 500);
      }
      return undefined;
    });
    renderPage();

    expect(await screen.findByText("Couldn't load reviews")).toBeInTheDocument();
    expect(screen.getByText("Review queue failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
