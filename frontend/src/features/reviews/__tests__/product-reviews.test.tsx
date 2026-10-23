import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductReviews } from "@/components/product/product-reviews";
import { clearToken, setToken } from "@/lib/api";
import { jsonResponse, renderWithProviders } from "@/test/render";
import type { OwnReview } from "@/types/reviews";

const PRODUCT = { id: 3, name: "Steel Bottle", slug: "steel-bottle", image: null };
const CUSTOMER = { id: 1, name: "Anita Rao", email: "anita@example.com" };

const PENDING_OWN: OwnReview = {
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
  moderator: null,
};

function emptyReviews() {
  return {
    success: true,
    productId: 3,
    count: 0,
    reviews: [],
    summary: {
      count: 0,
      average: null,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    },
    pagination: {
      page: 1,
      limit: 5,
      total: 0,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    },
  };
}

function installReviewsFetch({
  own = null as OwnReview | null,
  postResponse = "created" as "created" | "duplicate" | "invalid",
} = {}) {
  let currentOwn = own;
  const requests: Array<{ url: URL; method: string; body?: string }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    requests.push({
      url,
      method,
      body: typeof init?.body === "string" ? init.body : undefined,
    });

    if (method === "GET" && url.pathname === "/api/auth/me") {
      return jsonResponse({
        success: true,
        user: {
          id: CUSTOMER.id,
          name: CUSTOMER.name,
          email: CUSTOMER.email,
          isVerified: true,
          role: "customer",
          isAdmin: false,
        },
      });
    }
    if (method === "GET" && url.pathname === "/api/reviews/mine") {
      return jsonResponse({
        success: true,
        count: currentOwn ? 1 : 0,
        reviews: currentOwn ? [currentOwn] : [],
      });
    }
    if (method === "GET" && url.pathname === "/api/products/steel-bottle/reviews") {
      return jsonResponse(emptyReviews());
    }
    if (method === "POST" && url.pathname === "/api/products/steel-bottle/reviews") {
      if (postResponse === "duplicate") {
        return jsonResponse(
          {
            success: false,
            code: "REVIEW_EXISTS",
            message: "You have already reviewed this product",
          },
          409,
        );
      }
      if (postResponse === "invalid") {
        return jsonResponse(
          {
            success: false,
            message: "Validation failed",
            errors: ["Review must be at least 10 characters"],
          },
          400,
        );
      }
      currentOwn = PENDING_OWN;
      return jsonResponse(
        {
          success: true,
          message: "Thanks! Your review is pending approval.",
          review: {
            id: PENDING_OWN.id,
            productId: PENDING_OWN.product!.id,
            rating: PENDING_OWN.rating,
            title: PENDING_OWN.title,
            body: PENDING_OWN.body,
            status: "pending",
            createdAt: PENDING_OWN.createdAt,
          },
        },
        201,
      );
    }
    return jsonResponse({ success: false, message: "Not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return requests;
}

function renderReviews() {
  return renderWithProviders(
    <ProductReviews identifier="steel-bottle" productId={3} loginNext="/product/steel-bottle" />,
    { route: "/product/steel-bottle" },
  );
}

beforeEach(() => setToken("customer-token"));

afterEach(() => {
  vi.unstubAllGlobals();
  clearToken();
});

describe("ProductReviews", () => {
  it("requires a rating and submits only rating/title/body", async () => {
    const user = userEvent.setup();
    const requests = installReviewsFetch();
    renderReviews();

    await screen.findByRole("heading", { name: "Write a review" });
    await user.click(screen.getByRole("button", { name: "Submit for approval" }));
    expect(screen.getByText("Choose a rating from 1 to 5 stars.")).toBeInTheDocument();
    expect(
      requests.some((request) => request.method === "POST"),
    ).toBe(false);

    await user.click(screen.getByRole("button", { name: "Rate 5 out of 5 stars" }));
    await user.type(screen.getByLabelText("Title"), "Keeps tea hot");
    await user.type(
      screen.getByRole("textbox", { name: /^Review/ }),
      "It kept my tea hot for the whole morning commute.",
    );
    await user.click(screen.getByRole("button", { name: "Submit for approval" }));

    expect(
      await screen.findByText("Your review is pending approval"),
    ).toBeInTheDocument();

    const post = requests.find((request) => request.method === "POST");
    expect(JSON.parse(post?.body ?? "{}")).toEqual({
      rating: 5,
      title: "Keeps tea hot",
      body: "It kept my tea hot for the whole morning commute.",
    });
    // A customer cannot mass-assign moderation state from the browser.
    expect(post?.body).not.toContain("status");
    expect(post?.body).not.toContain("userId");
  });

  it("shows an existing pending review with status instead of another form", async () => {
    installReviewsFetch({ own: PENDING_OWN });
    renderReviews();

    expect(
      await screen.findByText("Your review is pending approval"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Write a review" })).not.toBeInTheDocument();
    expect(screen.getByText(/Submitted/)).toBeInTheDocument();
  });

  it("maps a duplicate or invalid review back to the form", async () => {
    const user = userEvent.setup();
    installReviewsFetch({ postResponse: "duplicate" });
    renderReviews();

    await screen.findByRole("heading", { name: "Write a review" });
    await user.click(screen.getByRole("button", { name: "Rate 4 out of 5 stars" }));
    await user.type(
      screen.getByRole("textbox", { name: /^Review/ }),
      "A useful review body for this product.",
    );
    await user.click(screen.getByRole("button", { name: "Submit for approval" }));

    expect(
      await screen.findByText("You have already reviewed this product"),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Write a review" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Submit for approval" })).toBeEnabled(),
    );
  });
});
