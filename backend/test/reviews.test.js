// test/reviews.test.js — checklist items 23–25.
//
// Real Express + real database. Proves the moderation boundary: pending and
// rejected rows never reach public lists/aggregates, customers can see their
// own status but cannot moderate, and admin decisions record identity/time and
// are safe to repeat.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const helpers = require("./helpers");

describe("Product reviews (items 23–25)", () => {
  let ctx;
  let admin;
  let product;
  let seed = 0;

  const uniqueBody = (label) => `${label} review body ${Date.now()}-${seed++} with enough characters`;

  async function createProduct(name = `Review Product ${seed++}`) {
    const res = await helpers.api(ctx.baseUrl, "/api/products", {
      method: "POST",
      token: admin.token,
      body: {
        name,
        category: "Review Test",
        description: "review fixture",
        mrpPrice: 500,
        sellingPrice: 400,
        stock: 5
      }
    });
    assert.equal(res.status, 201, res.text);
    return res.json.product;
  }

  async function submit(token, productIdentifier, body) {
    return helpers.api(ctx.baseUrl, `/api/products/${productIdentifier}/reviews`, {
      method: "POST",
      token,
      body
    });
  }

  async function publicReviews(productIdentifier, query = "") {
    return helpers.api(ctx.baseUrl, `/api/products/${productIdentifier}/reviews${query}`);
  }

  async function adminList(query = "") {
    return helpers.api(ctx.baseUrl, `/api/admin/reviews${query}`, { token: admin.token });
  }

  async function moderate(id, status, token = admin.token) {
    return helpers.api(ctx.baseUrl, `/api/admin/reviews/${id}`, {
      method: "PATCH",
      token,
      body: { status }
    });
  }

  before(async () => {
    ctx = await helpers.startTestApp();
    admin = await helpers.createAdminUser(ctx.baseUrl);
    product = await createProduct("Moderated Review Lamp");
  });

  after(async () => {
    await ctx.close();
  });

  it("requires authentication and validates rating/title/body on the server", async () => {
    const buyer = await helpers.createVerifiedUser(ctx.baseUrl);

    const anonymous = await helpers.api(ctx.baseUrl, `/api/products/${product.slug}/reviews`, {
      method: "POST",
      body: { rating: 5, body: uniqueBody("anonymous") }
    });
    assert.equal(anonymous.status, 401, anonymous.text);

    const noMine = await helpers.api(ctx.baseUrl, "/api/reviews/mine");
    assert.equal(noMine.status, 401, noMine.text);

    const cases = [
      { rating: 0, body: uniqueBody("zero") },
      { rating: 6, body: uniqueBody("six") },
      { rating: 4.5, body: uniqueBody("half") },
      { rating: 5, body: "too short" },
      { rating: 5, body: "x".repeat(2001) },
      { rating: 5, body: uniqueBody("title"), title: "x".repeat(121) },
      { rating: "five", body: uniqueBody("string-rating") }
    ];
    for (const body of cases) {
      const res = await submit(buyer.token, product.id, body);
      assert.equal(res.status, 400, `${JSON.stringify(body).slice(0, 80)} => ${res.text}`);
    }

    const missingProduct = await submit(buyer.token, 9999999, {
      rating: 5,
      body: uniqueBody("missing")
    });
    assert.equal(missingProduct.status, 404, missingProduct.text);
  });

  it("forces pending status, ignores mass-assigned fields and keeps the review private until approved", async () => {
    const buyer = await helpers.createVerifiedUser(ctx.baseUrl);
    const other = await helpers.createVerifiedUser(ctx.baseUrl);
    const bodyText = uniqueBody("pending");

    const created = await submit(buyer.token, product.slug, {
      rating: 4,
      title: "  Nice lamp  ",
      body: bodyText,
      // Must all be ignored:
      status: "approved",
      userId: other.user.id,
      verifiedPurchase: true,
      moderatedBy: admin.user.id,
      moderatedAt: new Date().toISOString()
    });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.json.review.status, "pending");
    assert.equal(created.json.review.title, "Nice lamp");
    assert.equal(created.json.review.body, bodyText);

    const publicList = await publicReviews(product.slug);
    assert.equal(publicList.status, 200, publicList.text);
    assert.equal(publicList.json.summary.count, 0);
    assert.equal(publicList.json.summary.average, null);
    assert.equal(publicList.json.reviews.length, 0);
    assert.ok(!publicList.text.includes(bodyText), "pending body must not leak publicly");
    assert.match(publicList.headers.get("cache-control") || "", /no-store/i);

    const detail = await helpers.api(ctx.baseUrl, `/api/products/${product.slug}`);
    assert.equal(detail.status, 200, detail.text);
    assert.ok(!detail.text.includes(bodyText), "product detail must not leak pending reviews");
    assert.ok(!detail.text.includes("ProductReviews"), "product detail must not expose review rows");

    const list = await helpers.api(ctx.baseUrl, `/api/products?q=${encodeURIComponent(product.name)}`);
    assert.ok(!list.text.includes(bodyText), "catalog search must not leak pending reviews");

    const mine = await helpers.api(ctx.baseUrl, `/api/reviews/mine?productId=${product.id}`, {
      token: buyer.token
    });
    assert.equal(mine.status, 200, mine.text);
    assert.equal(mine.json.count, 1);
    assert.equal(mine.json.reviews[0].status, "pending");
    assert.equal(mine.json.reviews[0].body, bodyText);
    assert.equal(mine.json.reviews[0].customer, null, "own-review payload does not expose a user record");
    assert.equal(mine.json.reviews[0].product.id, product.id);

    // Another customer sees only their own (empty) list.
    const otherMine = await helpers.api(ctx.baseUrl, "/api/reviews/mine", { token: other.token });
    assert.equal(otherMine.status, 200, otherMine.text);
    assert.equal(otherMine.json.count, 0);

    // Duplicate policy: friendly precheck and DB unique index.
    const duplicate = await submit(buyer.token, product.id, { rating: 5, body: uniqueBody("dup") });
    assert.equal(duplicate.status, 409, duplicate.text);
    assert.equal(duplicate.json.code, "REVIEW_EXISTS");

    // Store the id for the moderation test.
    product.pendingReviewId = created.json.review.id;
    product.pendingBody = bodyText;
    product.buyer = buyer;
    product.other = other;
  });

  it("admin queue is admin-only, returns context, and public aggregates change only on approval", async () => {
    const buyer = product.buyer;
    const other = product.other;

    const nonAdminQueue = await helpers.api(ctx.baseUrl, "/api/admin/reviews", { token: buyer.token });
    assert.equal(nonAdminQueue.status, 403, nonAdminQueue.text);
    const anonymousQueue = await helpers.api(ctx.baseUrl, "/api/admin/reviews");
    assert.equal(anonymousQueue.status, 401, anonymousQueue.text);

    const nonAdminPatch = await moderate(product.pendingReviewId, "approved", buyer.token);
    assert.equal(nonAdminPatch.status, 403, nonAdminPatch.text);

    const pendingQueue = await adminList();
    assert.equal(pendingQueue.status, 200, pendingQueue.text);
    assert.equal(pendingQueue.json.statusCounts.pending, 1);
    const queued = pendingQueue.json.reviews.find((r) => r.id === product.pendingReviewId);
    assert.ok(queued, "pending review must be in the default queue");
    assert.equal(queued.product.id, product.id);
    assert.equal(queued.customer.email, buyer.email);

    // Reject a second review from another customer; only approved rows aggregate.
    const rejectedBody = uniqueBody("rejected");
    const second = await submit(other.token, product.id, { rating: 1, body: rejectedBody });
    assert.equal(second.status, 201, second.text);
    const rejected = await moderate(second.json.review.id, "rejected");
    assert.equal(rejected.status, 200, rejected.text);
    assert.equal(rejected.json.review.status, "rejected");

    const stillHidden = await publicReviews(product.id);
    assert.equal(stillHidden.json.summary.count, 0);
    assert.ok(!stillHidden.text.includes(rejectedBody));
    const otherMine = await helpers.api(ctx.baseUrl, `/api/reviews/mine?productId=${product.id}`, {
      token: other.token
    });
    assert.equal(otherMine.json.reviews[0].status, "rejected", "author still sees rejection");

    const approved = await moderate(product.pendingReviewId, "approved");
    assert.equal(approved.status, 200, approved.text);
    assert.equal(approved.json.review.status, "approved");
    assert.equal(approved.json.review.moderatedBy, admin.user.id);
    assert.ok(approved.json.review.moderatedAt);

    const publicAfter = await publicReviews(product.slug);
    assert.equal(publicAfter.json.summary.count, 1);
    assert.equal(publicAfter.json.summary.average, 4);
    assert.deepEqual(publicAfter.json.summary.distribution, { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 });
    assert.equal(publicAfter.json.reviews[0].body, product.pendingBody);
    assert.equal(publicAfter.json.reviews[0].author.name, buyer.name);
    assert.ok(!publicAfter.text.includes("buyer@"), "public author payload must not include email");

    // Repeat the same decision: safe no-op, original moderator/time preserved.
    const firstModeratedAt = approved.json.review.moderatedAt;
    const repeated = await moderate(product.pendingReviewId, "approved");
    assert.equal(repeated.status, 200, repeated.text);
    assert.equal(repeated.json.unchanged, true);
    assert.equal(
      new Date(repeated.json.review.moderatedAt).toISOString().slice(0, 19),
      new Date(firstModeratedAt).toISOString().slice(0, 19),
      "repeating the same decision must not overwrite the original moderation time"
    );

    // Changing status is allowed and immediately removes the review from public.
    const reRejected = await moderate(product.pendingReviewId, "rejected");
    assert.equal(reRejected.status, 200, reRejected.text);
    assert.equal(reRejected.json.unchanged, false);
    const hiddenAgain = await publicReviews(product.id);
    assert.equal(hiddenAgain.json.summary.count, 0);
    assert.equal(hiddenAgain.json.reviews.length, 0);

    const own = await helpers.api(ctx.baseUrl, `/api/reviews/mine?productId=${product.id}`, {
      token: buyer.token
    });
    assert.equal(own.json.reviews[0].status, "rejected");

    // Moderation target is whitelisted: customers cannot set "pending" or
    // arbitrary values, and only an admin can reach the route at all.
    const badTarget = await moderate(product.pendingReviewId, "pending");
    assert.equal(badTarget.status, 400, badTarget.text);
    const missing = await moderate(9999999, "approved");
    assert.equal(missing.status, 404, missing.text);
  });

  it("concurrent duplicate submissions collapse to one review via the DB unique index", async () => {
    const concurrentProduct = await createProduct("Concurrent Review Chair");
    const buyer = await helpers.createVerifiedUser(ctx.baseUrl);
    const body = { rating: 5, body: uniqueBody("concurrent") };

    const [a, b] = await Promise.all([
      submit(buyer.token, concurrentProduct.id, body),
      submit(buyer.token, concurrentProduct.id, body)
    ]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409], `${a.text}\n${b.text}`);

    const mine = await helpers.api(ctx.baseUrl, `/api/reviews/mine?productId=${concurrentProduct.id}`, {
      token: buyer.token
    });
    assert.equal(mine.json.count, 1);
  });

  it("queue filtering/search and pagination stay accurate without leaking rejected rows", async () => {
    const filteredProduct = await createProduct("Filtered Review Desk");
    const buyer = await helpers.createVerifiedUser(ctx.baseUrl);
    const created = await submit(buyer.token, filteredProduct.id, {
      rating: 3,
      body: uniqueBody("filterable")
    });
    assert.equal(created.status, 201, created.text);

    const byProduct = await adminList(`?status=pending&q=${encodeURIComponent("Filtered Review Desk")}`);
    assert.equal(byProduct.status, 200, byProduct.text);
    assert.ok(byProduct.json.reviews.some((r) => r.id === created.json.review.id));

    const byCustomer = await adminList(`?status=pending&q=${encodeURIComponent(buyer.name)}`);
    assert.equal(byCustomer.status, 200, byCustomer.text);
    assert.ok(byCustomer.json.reviews.some((r) => r.id === created.json.review.id));

    const all = await adminList("?status=all&limit=100");
    assert.equal(all.status, 200, all.text);
    assert.ok(all.json.reviews.some((r) => r.id === created.json.review.id));
    assert.equal(typeof all.json.statusCounts.pending, "number");
    assert.equal(typeof all.json.statusCounts.approved, "number");
    assert.equal(typeof all.json.statusCounts.rejected, "number");

    const invalid = await adminList("?status=deleted");
    assert.equal(invalid.status, 400, invalid.text);

    const publicFiltered = await helpers.api(ctx.baseUrl, `/api/products/${filteredProduct.id}/reviews?page=1&limit=5`);
    assert.equal(publicFiltered.status, 200, publicFiltered.text);
    assert.equal(publicFiltered.json.pagination.page, 1);
    assert.equal(publicFiltered.json.pagination.limit, 5);
    assert.equal(publicFiltered.json.reviews.length, 0, "pending review is not public");
  });
});
