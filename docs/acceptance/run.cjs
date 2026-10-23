/* BuyO acceptance harness — real MySQL, real Express, real browser.
 * Run from the repo root:  node docs/acceptance/run.cjs
 * Requires: local MySQL + backend/.env, Google Chrome, and Playwright installed
 * without saving it to package.json:
 *   npm i --no-save --no-package-lock playwright
 * It recreates the disposable `buyoDB_ph2_test` database (never the dev DB),
 * starts Express on :5000 and Vite on :5173, then drives Chrome.
 * Writes out/report.json plus failure screenshots.
 */
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { createRequire } = require("node:module");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const BACKEND = path.join(ROOT, "backend");
const FRONTEND = path.join(ROOT, "frontend");
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });

const requireBackend = createRequire(path.join(BACKEND, "package.json"));
const FRONTEND_URL = "http://localhost:5173";
const BASE = "http://localhost:5000";

const report = { startedAt: new Date().toISOString(), steps: [], consoleErrors: [], checks: {} };
const results = [];
let ctx; // browser context
let page;
let vite;

function log(...args) {
  console.log("[e2e]", ...args);
}

async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    const ms = Date.now() - started;
    results.push({ name, ok: true, ms });
    report.steps.push({ name, ok: true, ms });
    log(`PASS ${name} (${ms} ms)`);
  } catch (error) {
    const ms = Date.now() - started;
    results.push({ name, ok: false, ms, error: String(error && error.stack || error) });
    report.steps.push({ name, ok: false, ms, error: String(error && error.stack || error) });
    log(`FAIL ${name}: ${error && error.message ? error.message : error}`);
    if (page) {
      const safe = name.replace(/[^a-z0-9]+/gi, "-").slice(0, 60);
      await page.screenshot({ path: path.join(OUT, `fail-${safe}.png`), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(OUT, `fail-${safe}.html`), await page.content().catch(() => ""), "utf8");
    }
  }
}

async function waitForHttp(url, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlZsAAAAASUVORK5CYII=",
  "base64",
);

async function api(pathname, { method = "GET", token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + pathname, { method, headers, body: payload, redirect: "manual" });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* plain text */ }
  return { status: res.status, text, json, headers: res.headers };
}

async function boot() {
  // helpers loads backend/.env and forces the disposable *_test database.
  const helpers = requireBackend("./test/helpers");
  assert.equal(helpers.TEST_DB_NAME, "buyoDB_ph2_test");
  process.env.NODE_ENV = "test";
  process.env.MAIL_TRANSPORT = "json";
  process.env.FRONTEND_URL = FRONTEND_URL;
  process.env.BACKEND_URL = BASE;

  const { resolveMysqlSettings } = requireBackend("./config/dbConnectionOptions");
  const settings = resolveMysqlSettings();
  const mysql = requireBackend("mysql2/promise");
  const conn = await mysql.createConnection({
    host: settings.host,
    port: settings.port,
    user: settings.username,
    password: settings.password,
    ...(settings.ssl ? { ssl: settings.ssl } : {}),
  });
  await conn.query("DROP DATABASE IF EXISTS `buyoDB_ph2_test`");
  await conn.query("CREATE DATABASE `buyoDB_ph2_test`");
  await conn.end();

  const sequelize = requireBackend("./config/db");
  for (const model of ["user", "category", "product", "productVariant", "productReview", "cart", "wishlist", "address", "productImage", "order"]) {
    requireBackend(`./models/${model}`);
  }
  await sequelize.sync();

  const app = requireBackend("./app").createApp();
  const server = app.listen(5000);
  await new Promise((resolve) => server.once("listening", resolve));

  const mailer = requireBackend("./utils/mailer");
  const models = {
    User: requireBackend("./models/user"),
    Category: requireBackend("./models/category"),
    Product: requireBackend("./models/product"),
    CartItem: requireBackend("./models/cart"),
    Address: requireBackend("./models/address"),
    Order: requireBackend("./models/order"),
    OrderItem: requireBackend("./models/orderItem"),
    ProductVariant: requireBackend("./models/productVariant"),
    ProductReview: requireBackend("./models/productReview"),
  };

  return {
    helpers, sequelize, server, mailer, models,
    close: async () => {
      await new Promise((r) => server.close(r));
      await sequelize.close();
    },
  };
}

async function seed(app) {
  const { helpers } = app;
  const admin = await helpers.createAdminUser(BASE);
  const created = {};

  const mkCategory = async (name, parentId, taxRate = 5) => {
    const res = await api("/api/categories", {
      method: "POST", token: admin.token, body: { name, parentId: parentId ?? null, taxRate },
    });
    assert.equal(res.status, 201, res.text);
    return res.json.category;
  };
  created.kitchen = await mkCategory("Kitchen", null, 5);
  created.bottles = await mkCategory("Bottles", created.kitchen.id, 5);
  created.cookware = await mkCategory("Cookware", created.kitchen.id, 12);
  created.garden = await mkCategory("Garden", null, 5);

  const mkProduct = async ({ name, category, categoryId, price, mrp, stock, image = true }) => {
    const form = new FormData();
    form.append("name", name);
    form.append("category", category);
    form.append("categoryId", String(categoryId));
    form.append("mrpPrice", String(mrp));
    form.append("sellingPrice", String(price));
    form.append("stock", String(stock));
    form.append("description", `${name} — seeded for acceptance testing.`);
    if (image) form.append("image", new Blob([PNG], { type: "image/png" }), `${name.replace(/\W+/g, "-").toLowerCase()}.png`);
    const res = await api("/api/products", { method: "POST", token: admin.token, form });
    assert.equal(res.status, 201, res.text);
    return res.json.product;
  };

  created.bottle = await mkProduct({
    name: "Steel Bottle 750 ml", category: "Bottles", categoryId: created.bottles.id,
    mrp: 999, price: 799, stock: 5,
  });
  created.pan = await mkProduct({
    name: "Cast Iron Pan", category: "Cookware", categoryId: created.cookware.id,
    mrp: 2499, price: 1999, stock: 3,
  });
  created.tumbler = await mkProduct({
    name: "Glass Tumbler", category: "Bottles", categoryId: created.bottles.id,
    mrp: 499, price: 349, stock: 2,
  });
  created.gnome = await mkProduct({
    name: "Garden Gnome", category: "Garden", categoryId: created.garden.id,
    mrp: 899, price: 699, stock: 4,
  });

  // A real variant-managed product. Its base stock starts at 0; each variant
  // write recomputes the aggregate, exactly as an admin would via the UI.
  created.tee = await mkProduct({
    name: "Everyday Tee", category: "Bottles", categoryId: created.bottles.id,
    mrp: 1200, price: 1000, stock: 0, image: false,
  });
  const mkVariant = async (body) => {
    const res = await api(`/api/products/${created.tee.id}/variants`, {
      method: "POST", token: admin.token, body,
    });
    assert.equal(res.status, 201, res.text);
    return res.json.variant;
  };
  created.teeBlackM = await mkVariant({
    sku: "TEE-BLK-M", size: "M", color: "Black", priceAdjustment: 100, stock: 3,
  });
  created.teeWhiteL = await mkVariant({
    sku: "TEE-WHT-L", size: "L", color: "White", priceAdjustment: 0, stock: 2,
  });

  return { admin, created };
}

async function startVite() {
  vite = spawn("cmd.exe", ["/c", "npm run dev -- --port 5173 --strictPort"], {
    cwd: FRONTEND,
    env: { ...process.env, BROWSER: "none" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  vite.stdout.on("data", (d) => { output += d.toString(); });
  vite.stderr.on("data", (d) => { output += d.toString(); });
  fs.writeFileSync(path.join(OUT, "vite.log"), output, "utf8");
  await waitForHttp(FRONTEND_URL, 90000);
  await new Promise((r) => setTimeout(r, 1000));
}

function main() {
  const started = Date.now();
  (async () => {
    const app = await boot();
    const { helpers, models } = app;
    const { admin, created } = await seed(app);
    report.checks.seed = {
      categories: [created.kitchen.id, created.bottles.id, created.cookware.id, created.garden.id],
      products: [created.bottle.id, created.pan.id, created.tumbler.id, created.gnome.id],
    };
    await startVite();

    const browser = await chromium.launch({ channel: "chrome", headless: true });
    ctx = await browser.newContext({ baseURL: FRONTEND_URL, viewport: { width: 1440, height: 900 } });
    page = await ctx.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") report.consoleErrors.push({ url: page.url(), text: msg.text() });
    });
    page.on("pageerror", (err) => report.consoleErrors.push({ url: page.url(), text: `pageerror: ${err.message}` }));

    const buyerEmail = `buyer.e2e.${Date.now()}@buyotest.local`;
    let buyerPassword = "Secret123!";
    let buyerToken = null;
    let orderId = null;
    let orderNumber = null;

    const expectText = async (locator, text, timeout = 15000) => {
      await locator.first().waitFor({ state: "visible", timeout });
      const content = await locator.first().textContent();
      assert.match(content || "", text instanceof RegExp ? text : new RegExp(String(text), "i"));
    };

    await step("storefront home renders with a single H1 and product cards", async () => {
      await page.goto("/");
      await expectText(page.locator("h1"), /./);
      assert.equal(await page.locator("h1").count(), 1);
      await page.getByRole("link", { name: /Steel Bottle 750 ml/ }).first().waitFor({ timeout: 15000 });
      assert.equal(await page.title() !== "", true);
    });

    await step("category tree is navigable and filtered shop links work", async () => {
      await page.goto("/categories");
      await expectText(page.locator("h1"), /Shop by category/);
      await page.getByRole("link", { name: "Kitchen", exact: true }).waitFor();
      const bottles = page.getByRole("link", { name: /Bottles/ }).first();
      await bottles.click();
      await page.waitForURL(/\/shop\?category=bottles/);
      await expectText(page.locator("h1"), /Bottles/);
      await page.getByRole("link", { name: /Steel Bottle 750 ml/ }).first().waitFor();
      await page.getByRole("navigation", { name: /Category navigation for Bottles/ }).waitFor();
    });

    await step("search suggestions respond to typing", async () => {
      await page.goto("/shop");
      if (!(await page.getByRole("combobox", { name: "Search products" }).isVisible().catch(() => false))) {
        await page.getByRole("button", { name: "Open search" }).click();
      }
      const input = page.getByRole("combobox", { name: "Search products" });
      await input.fill("Steel");
      await page.getByRole("listbox", { name: /Product suggestions/ }).waitFor({ timeout: 10000 });
      await page.getByRole("option", { name: /Steel Bottle 750 ml/ }).first().waitFor();
      await input.fill("");
    });

    await step("product detail shows the real uploaded image, gallery and related products", async () => {
      await page.goto(`/product/${created.bottle.slug}`);
      await expectText(page.locator("h1"), /Steel Bottle 750 ml/);
      const img = page.locator("img").first();
      await img.waitFor();
      await page.waitForFunction(() => {
        const el = document.querySelector("img");
        return el && el.complete && el.naturalWidth > 0;
      }, null, { timeout: 15000 });
      await page.getByRole("heading", { name: "You may also like" }).waitFor({ timeout: 10000 });
      await page.getByRole("link", { name: /Glass Tumbler/ }).first().waitFor();
    });

    await step("guest adds to cart, cart page is reachable and stores locally", async () => {
      await page.goto(`/product/${created.bottle.slug}`);
      await page.getByRole("button", { name: "Add to cart", exact: true }).click();
      await page.getByRole("link", { name: /Cart, 1 item/ }).waitFor({ timeout: 10000 });
      await page.goto("/cart");
      await expectText(page.locator("h1"), /Your cart/);
      await page.getByText("Steel Bottle 750 ml").first().waitFor();
      await page.getByRole("link", { name: "Sign in to checkout" }).waitFor();
      const guest = await page.evaluate(() => window.localStorage.getItem("buyo.guestCart.v1"));
      assert.ok(guest && guest.includes(String(created.bottle.id)), "guest cart persisted in localStorage");
    });

    await step("guest chooses a real variant; price, SKU and identity persist", async () => {
      await page.goto(`/product/${created.tee.slug}`);
      await expectText(page.locator("h1"), /Everyday Tee/);
      const size = page.getByLabel("Size");
      await size.waitFor();
      assert.equal(await size.inputValue(), "M", "first in-stock variant is auto-selected");
      assert.equal(await page.getByLabel("Colour").inputValue(), "Black");
      await page.getByText("Selected: Size M · Colour Black").waitFor();
      await page.getByText("SKU TEE-BLK-M").waitFor();
      await page.getByText("₹1,100").first().waitFor();

      await page.getByRole("button", { name: "Add to cart", exact: true }).click();
      await page.getByRole("link", { name: /Cart, 2 items/ }).waitFor({ timeout: 10000 });
      const guest = JSON.parse(await page.evaluate(() => window.localStorage.getItem("buyo.guestCart.v1")));
      const line = guest.find((entry) => entry.productId === created.tee.id);
      assert.ok(line, "guest cart contains the variant product");
      assert.equal(line.variantId, created.teeBlackM.id);
      assert.equal(line.unitPrice, 1100);
      report.checks.variantGuestLine = { productId: line.productId, variantId: line.variantId, unitPrice: line.unitPrice };
    });

    await step("signup sends a verification email; the link verifies and login works", async () => {
      await page.goto("/signup");
      await page.getByLabel("Full name").fill("E2E Buyer");
      await page.getByLabel("Email").fill(buyerEmail);
      await page.getByLabel(/^Password/).fill(buyerPassword);
      await page.getByLabel("Confirm password").fill(buyerPassword);
      await page.getByRole("button", { name: "Create account" }).click();
      await expectText(page.getByRole("status"), /Account created/);

      // Unverified login must be refused and must offer a resend form (items 14/15).
      await page.goto("/login");
      await page.getByLabel("Email").fill(buyerEmail);
      await page.getByLabel(/^Password/).fill(buyerPassword);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expectText(page.getByText("Sign in failed"), /Sign in failed/);
      await page.getByText("Your email address is not verified yet", { exact: false }).waitFor();
      await page.getByRole("button", { name: "Resend verification email" }).click();
      await page.getByText("Request received").waitFor();
      await page.getByRole("button", { name: /Resend in \d+s/ }).waitFor();

      const mail = [...app.mailer.getOutbox()].reverse().find((m) => m.to === buyerEmail && /verify/i.test(m.subject));
      assert.ok(mail, "verification mail captured");
      const verifyMails = app.mailer.getOutbox().filter((m) => m.to === buyerEmail && /verify/i.test(m.subject));
      assert.equal(verifyMails.length, 2, "signup + resend both captured");
      const link = mail.html.match(/href="([^"]*\/api\/auth\/verify\?token=[^"]+)"/)[1].replace(/&amp;/g, "&");
      await page.goto(link);
      await page.waitForURL(/\/login\?status=success/);
      await page.getByText("Email verified", { exact: true }).waitFor({ timeout: 15000 });

      await page.getByLabel("Email").fill(buyerEmail);
      await page.getByLabel(/^Password/).fill(buyerPassword);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByRole("link", { name: `Account: E2E Buyer` }).waitFor({ timeout: 15000 });
      buyerToken = await page.evaluate(() => window.localStorage.getItem("token"));
      assert.ok(buyerToken, "token stored");
    });

    await step("guest cart merges into the account cart after sign-in", async () => {
      await page.goto("/cart");
      await expectText(page.locator("h1"), /Your cart/);
      await page.getByText("Steel Bottle 750 ml").first().waitFor();
      assert.equal(await page.getByRole("link", { name: "Sign in to checkout" }).count(), 0);
      await page.getByRole("link", { name: /Proceed to checkout/ }).waitFor();
      const buyer = await models.User.findOne({ where: { email: buyerEmail } });
      const dbCart = await models.CartItem.findAll({ where: { UserId: buyer.id } });
      assert.ok(dbCart.length >= 2, "server cart has the merged base and variant lines");
      assert.ok(
        dbCart.some((line) => line.productId === created.tee.id && line.variantId === created.teeBlackM.id),
        "variant identity survived the guest merge",
      );
      await page.getByText("Size M · Colour Black").first().waitFor();
      await page.getByText("SKU TEE-BLK-M").first().waitFor();
      report.checks.mergedCartLines = dbCart.map((line) => ({
        productId: line.productId, variantId: line.variantId, qty: line.qty,
      }));
      const guest = await page.evaluate(() => window.localStorage.getItem("buyo.guestCart.v1"));
      assert.ok(guest === null || JSON.parse(guest).length === 0, "guest cart cleared after a confirmed merge");
    });

    await step("profile name update persists to the database", async () => {
      await page.goto("/account");
      await expectText(page.locator("h1"), /E2E Buyer/);
      const nameInput = page.getByLabel("Display name");
      await nameInput.fill("E2E Buyer Updated");
      await page.getByRole("button", { name: "Save changes" }).click();
      await expectText(page.getByText("Profile updated"), /Profile updated/);
      await page.getByRole("link", { name: /Account: E2E Buyer Updated/ }).waitFor();
      const user = await models.User.findOne({ where: { email: buyerEmail } });
      assert.equal(user.name, "E2E Buyer Updated");
    });

    await step("password change rejects a wrong current password then succeeds", async () => {
      await page.goto("/account");
      const form = page.locator("form", { has: page.getByLabel("Current password") });
      await form.getByLabel("Current password").fill("WrongPass123!");
      await form.getByLabel(/^New password/).fill("Secret456!");
      await form.getByLabel("Confirm new password").fill("Secret456!");
      await form.getByRole("button", { name: "Update password" }).click();
      await expectText(page.getByText("Current password is incorrect"), /Current password is incorrect/);

      await form.getByLabel("Current password").fill("Secret123!");
      await form.getByRole("button", { name: "Update password" }).click();
      await expectText(page.getByText("Password updated"), /Password updated/);
      buyerPassword = "Secret456!";

      await page.getByRole("button", { name: "Sign out" }).click();
      await page.goto("/login");
      await page.getByLabel("Email").fill(buyerEmail);
      await page.getByLabel(/^Password/).fill("Secret456!");
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByRole("link", { name: /Account: E2E Buyer Updated/ }).waitFor();
    });

    await step("forgot/reset password issues a working single-use link", async () => {
      await page.getByRole("link", { name: /Account: E2E Buyer Updated/ }).click();
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.goto("/forgot-password");
      await page.getByLabel("Email").fill(buyerEmail);
      await page.getByRole("button", { name: "Email reset link" }).click();
      await expectText(page.getByRole("status"), /Reset request received/);

      const resetMail = [...app.mailer.getOutbox()].reverse().find((m) => m.to === buyerEmail && /reset/i.test(m.subject));
      assert.ok(resetMail, "reset mail captured");
      const link = resetMail.html.match(/href="([^"]*reset-password\.html\?token=[^"]+)"/)[1].replace(/&amp;/g, "&");
      await page.goto(link);
      await page.waitForURL(/\/reset-password\?token=/);
      await page.getByLabel(/^New password/).fill("Secret789!");
      await page.getByLabel("Confirm new password").fill("Secret789!");
      await page.getByRole("button", { name: "Update password" }).click();
      await expectText(page.getByRole("status"), /You can sign in again/);
      buyerPassword = "Secret789!";

      await page.getByRole("link", { name: "Go to sign in" }).click();
      await page.getByLabel("Email").fill(buyerEmail);
      await page.getByLabel(/^Password/).fill(buyerPassword);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByRole("link", { name: /Account: E2E Buyer Updated/ }).waitFor({ timeout: 15000 });
      const me = await api("/api/auth/me", { token: buyerToken });
      assert.equal(me.status, 401, "pre-reset token is invalidated by the password change");
      buyerToken = await page.evaluate(() => window.localStorage.getItem("token"));
    });

    await step("address creation validates and persists", async () => {
      await page.goto("/account/addresses");
      await page.getByRole("button", { name: "Add address" }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await dialog.getByLabel("Label").fill("Home");
      await dialog.getByLabel("Full name").fill("E2E Buyer");
      await dialog.getByLabel("Phone").fill("98765 43210");
      await dialog.getByLabel("Address line 1").fill("12 Test Lane");
      await dialog.getByLabel("City").fill("Pune");
      await dialog.getByLabel("State").fill("Maharashtra");
      await dialog.getByLabel("PIN code").fill("411001");
      await dialog.getByRole("checkbox").check();
      await dialog.getByRole("button", { name: "Save address" }).click();
      await expectText(page.getByText("Address saved"), /Address saved/);
      await page.getByText("12 Test Lane").first().waitFor();
      const addresses = await models.Address.findAll();
      assert.equal(addresses.length, 1);
      assert.equal(addresses[0].isDefault, true);
    });

    await step("COD checkout places exactly one order and decrements stock", async () => {
      const before = await models.Product.findByPk(created.bottle.id);
      const variantBefore = await models.ProductVariant.findByPk(created.teeBlackM.id);
      await page.goto("/checkout");
      await expectText(page.locator("h1"), /Review and place order/);
      await page.getByLabel("Delivery notes").fill("Call on arrival.");
      await page.getByRole("button", { name: "Place COD order" }).click();
      await page.waitForURL(/\/checkout\/confirmation\/\d+/, { timeout: 20000 });
      orderId = Number(page.url().match(/confirmation\/(\d+)/)[1]);
      await page.getByText("Confirmed", { exact: true }).waitFor({ timeout: 15000 });
      const order = await models.Order.findByPk(orderId);
      orderNumber = order.orderNumber;
      assert.equal(order.status, "placed");
      assert.equal(order.paymentMethod, "cod");
      assert.equal(Number(order.grandTotal) > 0, true);
      const after = await models.Product.findByPk(created.bottle.id);
      assert.equal(after.stock, before.stock - 1);
      const variantAfter = await models.ProductVariant.findByPk(created.teeBlackM.id);
      assert.equal(variantAfter.stock, variantBefore.stock - 1, "variant stock decremented once");
      const teeAfter = await models.Product.findByPk(created.tee.id);
      assert.equal(
        teeAfter.stock,
        variantAfter.stock + Number((await models.ProductVariant.findByPk(created.teeWhiteL.id)).stock),
        "product aggregate equals active variant stock",
      );
      const items = await models.OrderItem.findAll({ where: { orderId } });
      const variantItem = items.find((item) => item.productId === created.tee.id);
      assert.ok(variantItem, "order contains the variant line");
      assert.equal(variantItem.variantId, created.teeBlackM.id);
      assert.equal(variantItem.variantSku, "TEE-BLK-M");
      assert.equal(variantItem.variantSize, "M");
      assert.equal(variantItem.variantColor, "Black");
      assert.equal(Number(variantItem.unitPrice), 1100);
      report.checks.order = {
        id: orderId, number: orderNumber, total: Number(order.grandTotal),
        items: items.map((item) => ({
          productId: item.productId, variantId: item.variantId, sku: item.variantSku,
          qty: item.qty, unitPrice: Number(item.unitPrice),
        })),
      };
    });

    await step("order history shows the order; customer cancellation restocks exactly once", async () => {
      await page.goto("/orders");
      await page.getByRole("link", { name: "View details" }).first().click();
      await page.waitForURL(/\/orders\/\d+/);
      await page.getByRole("button", { name: "Cancel order" }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await dialog.getByRole("button", { name: "Cancel order" }).click();
      await expectText(page.getByText("Order cancelled"), /Order cancelled/);
      await page.getByText(/returned to stock/i).first().waitFor();
      const order = await models.Order.findByPk(orderId);
      assert.equal(order.status, "cancelled");
      const product = await models.Product.findByPk(created.bottle.id);
      assert.equal(product.stock, 5, "stock restored once");
      const variant = await models.ProductVariant.findByPk(created.teeBlackM.id);
      assert.equal(variant.stock, 3, "variant stock restored exactly once");
      const tee = await models.Product.findByPk(created.tee.id);
      assert.equal(tee.stock, 5, "variant aggregate restored");
      const events = await requireBackend("./models/orderStatusEvent").findAll({ where: { orderId } });
      assert.equal(events.length, 2);
    });

    await step("status notifications were captured (receipt + cancellation)", async () => {
      const mails = app.mailer.getOutbox().filter((m) => m.to === buyerEmail);
      const subjects = mails.map((m) => m.subject);
      assert.ok(subjects.some((s) => /confirmed|thank|order/i.test(s)), `receipt mail present: ${subjects.join(" | ")}`);
      assert.ok(subjects.some((s) => /cancelled/i.test(s)), `cancellation mail present: ${subjects.join(" | ")}`);
      report.checks.mailSubjects = subjects;
    });

    await step("customer sees the cancelled order and the timeline", async () => {
      await page.reload();
      await expectText(page.getByText(/This order was cancelled/i), /This order was cancelled/i);
      await page.getByRole("heading", { name: "Status history" }).waitFor();
    });

    await step("admin analytics match direct database aggregates and the dashboard", async () => {
      // log the admin in through the UI in a second context
      const adminCtx = await browser.newContext({ baseURL: FRONTEND_URL, viewport: { width: 1440, height: 900 } });
      const adminPage = await adminCtx.newPage();
      const adminAuth = admin;
      await adminPage.goto("/login");
      await adminPage.getByLabel("Email").fill(admin.email);
      await adminPage.getByLabel(/^Password/).fill(admin.password);
      await adminPage.getByRole("button", { name: "Sign in" }).click();
      await adminPage.getByRole("link", { name: /Account:/ }).waitFor({ timeout: 15000 });
      await adminPage.goto("/admin");
      await adminPage.getByRole("heading", { name: "Dashboard" }).waitFor({ timeout: 15000 }).catch(() => {});

      const summary = await api("/api/admin/analytics/summary", { token: adminAuth.token });
      assert.equal(summary.status, 200, summary.text);
      const data = summary.json;
      const nonCancelled = await models.Order.count({ where: { status: { [requireBackend("sequelize").Op.ne]: "cancelled" } } });
      const total = await models.Order.count();
      assert.equal(data.orders.total, total);
      assert.equal(data.orders.nonCancelledCount, nonCancelled);
      const gross = Number(await models.Order.sum("grandTotal", { where: { status: { [requireBackend("sequelize").Op.ne]: "cancelled" } } }) || 0);
      assert.equal(Number(data.orders.grossOrderValue), gross);
      report.checks.analytics = { total, nonCancelled, gross };

      const ordersCard = adminPage.getByRole("main").getByRole("link", { name: /Orders/ }).first();
      await ordersCard.waitFor();
      assert.match(await ordersCard.textContent(), new RegExp(String(total)));
      await adminPage.screenshot({ path: path.join(OUT, "admin-dashboard.png"), fullPage: true });

      // customer cannot reach admin
      app.adminPage = adminPage;
      app.adminBrowserCtx = adminCtx;
      await page.goto("/admin");
      await page.getByText("Administrator access required").waitFor({ timeout: 10000 });
      const forbidden = await api("/api/admin/analytics/summary", { token: buyerToken });
      assert.equal(forbidden.status, 403);

      report.checks.adminCtx = true;
    });

    await step("admin confirms a new order; the customer notification is captured", async () => {
      // build a second order via the API (still a real server + DB)
      const cart = await api("/api/cart", { method: "POST", token: buyerToken, body: { productId: created.pan.id, qty: 1 } });
      assert.ok([200, 201].includes(cart.status), cart.text);
      const addresses = await models.Address.findAll();
      const res = await api("/api/orders", {
        method: "POST", token: buyerToken,
        body: { addressId: addresses[0].id, idempotencyKey: `e2e-admin-${Date.now()}` },
      });
      assert.equal(res.status, 201, res.text);
      const secondId = res.json.order.id;
      const adminPage = app.adminPage;
      await adminPage.goto(`/admin/orders/${secondId}`);
      await adminPage.getByRole("button", { name: "Confirm order" }).click();
      const dialog = adminPage.getByRole("dialog");
      await dialog.waitFor();
      await dialog.getByRole("button", { name: "Confirm order" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 15000 });
      const order = await models.Order.findByPk(secondId);
      assert.equal(order.status, "confirmed");
      const mails = app.mailer.getOutbox().filter((m) => m.to === buyerEmail);
      assert.ok(mails.length >= 3, "status mail captured");
      report.checks.secondOrder = secondId;

      // Admin free-text order search (item 5), URL-driven.
      await adminPage.goto("/admin/orders");
      await adminPage.getByPlaceholder("Order number, customer name or email").fill(order.orderNumber);
      await adminPage.getByRole("row", { name: new RegExp(order.orderNumber) }).waitFor({ timeout: 10000 });
      await adminPage.waitForURL(/q=/);
      await adminPage.screenshot({ path: path.join(OUT, "admin-orders-search.png"), fullPage: true });
    });

    await step("admin creates a child category through the UI", async () => {
      const adminPage = app.adminPage;
      await adminPage.goto("/admin/categories");
      await adminPage.getByRole("button", { name: /Add category/ }).click();
      const dialog = adminPage.getByRole("dialog");
      await dialog.waitFor();
      await dialog.getByLabel("Name").fill("E2E Storage");
      await dialog.getByLabel(/^Parent category/).selectOption({ label: "Kitchen" });
      await dialog.getByRole("button", { name: "Add category" }).click();
      await dialog.waitFor({ state: "hidden" });
      const row = adminPage.getByRole("row", { name: /E2E Storage/ });
      await row.waitFor();
      const createdCat = await models.Category.findOne({ where: { name: "E2E Storage" } });
      assert.ok(createdCat);
      assert.equal(createdCat.parentId, created.kitchen.id);
      await adminPage.screenshot({ path: path.join(OUT, "admin-categories.png"), fullPage: true });
    });

    await step("admin customers search and detail work", async () => {
      const adminPage = app.adminPage;
      await adminPage.goto("/admin/customers");
      await adminPage.getByPlaceholder("Name or email").fill("buyer.e2e");
      await adminPage.getByText(buyerEmail).first().waitFor({ timeout: 10000 });
      await adminPage.getByRole("link", { name: "View", exact: true }).first().click();
      await adminPage.waitForURL(/\/admin\/customers\/\d+/, { timeout: 10000 });
      await adminPage.getByText(buyerEmail).first().waitFor();
      await adminPage.screenshot({ path: path.join(OUT, "admin-customers.png"), fullPage: true });
    });

    await step("admin edits, adds and deactivates variants through the UI", async () => {
      const adminPage = app.adminPage;
      await adminPage.goto(`/admin/products/${created.tee.id}/edit`);
      await adminPage.getByRole("heading", { name: "Variants" }).waitFor({ timeout: 15000 });
      await adminPage.getByText("TEE-BLK-M").waitFor();
      assert.ok(await adminPage.getByText("TEE-WHT-L").isVisible());

      // Edit an existing variant's stock.
      const whiteRow = adminPage.getByRole("listitem").filter({ hasText: "TEE-WHT-L" }).first();
      await whiteRow.getByRole("button", { name: "Edit" }).click();
      const stockInput = adminPage.locator("#variant-stock");
      await stockInput.fill("4");
      await adminPage.getByRole("button", { name: "Save variant" }).click();
      await expectText(adminPage.getByText("Variant updated"), /Variant updated/);
      const white = await models.ProductVariant.findByPk(created.teeWhiteL.id);
      assert.equal(white.stock, 4);
      assert.equal((await models.Product.findByPk(created.tee.id)).stock, 7);

      // Add a third real variant.
      await adminPage.getByRole("button", { name: "Add variant" }).first().click();
      await adminPage.locator("#variant-sku").fill("TEE-NVY-S");
      await adminPage.locator("#variant-size").fill("S");
      await adminPage.locator("#variant-color").fill("Navy");
      await adminPage.locator("#variant-stock").fill("1");
      await adminPage.locator("#variant-price-adjustment").fill("50");
      await adminPage.getByRole("button", { name: "Add variant" }).first().click();
      await expectText(adminPage.getByText("Variant added"), /Variant added/);
      const navy = await models.ProductVariant.findOne({ where: { sku: "TEE-NVY-S" } });
      assert.ok(navy, "variant created through the admin UI");
      assert.equal(navy.stock, 1);
      assert.equal(Number(navy.priceAdjustment), 50);
      assert.equal((await models.Product.findByPk(created.tee.id)).stock, 8);
      await adminPage.getByText("TEE-NVY-S").waitFor({ timeout: 10000 });

      // Deactivate the third variant: it disappears from public sale but the
      // row stays for order-history snapshots.
      const navyRow = adminPage.getByRole("listitem").filter({ hasText: "TEE-NVY-S" }).first();
      await navyRow.getByRole("button", { name: "Deactivate" }).click();
      const dialog = adminPage.getByRole("dialog");
      await dialog.waitFor();
      await dialog.getByRole("button", { name: "Deactivate" }).click();
      await expectText(adminPage.getByText("Variant deactivated"), /Variant deactivated/);
      await navy.reload();
      assert.equal(navy.isActive, false);
      assert.equal((await models.Product.findByPk(created.tee.id)).stock, 7);
      assert.equal(await adminPage.locator("#product-stock").isDisabled(), true);

      await page.goto(`/product/${created.tee.slug}`);
      await page.getByLabel("Size").waitFor();
      const sizes = await page.getByLabel("Size").locator("option").allTextContents();
      const colours = await page.getByLabel("Colour").locator("option").allTextContents();
      assert.ok(!sizes.includes("S"), "deactivated size is not sold");
      assert.ok(!colours.includes("Navy"), "deactivated colour is not sold");
      report.checks.variantsAdmin = { edited: white.id, added: navy.id, deactivated: navy.isActive === false };
    });

    const reviewTitle = "Honest everyday tee";
    const reviewBody = "The cotton is soft and the fit is right for daily wear.";
    let reviewId = null;

    await step("customer submits a review; it stays pending and invisible to the public", async () => {
      const buyer = await models.User.findOne({ where: { email: buyerEmail } });
      await page.goto(`/product/${created.tee.slug}`);
      await page.getByRole("heading", { name: "Write a review" }).waitFor({ timeout: 15000 });
      await page.getByRole("button", { name: "Rate 5 out of 5 stars" }).click();
      await page.getByRole("textbox", { name: /^Title/ }).fill(reviewTitle);
      await page.locator("#review-body").fill(reviewBody);
      await page.getByRole("button", { name: "Submit for approval" }).click();
      await page.getByText("Your review is pending approval").waitFor({ timeout: 15000 });

      const own = await api(`/api/reviews/mine?productId=${created.tee.id}`, { token: buyerToken });
      assert.equal(own.status, 200, own.text);
      assert.equal(own.json.count, 1);
      assert.equal(own.json.reviews[0].status, "pending");
      reviewId = own.json.reviews[0].id;

      const review = await models.ProductReview.findByPk(reviewId);
      assert.equal(review.status, "pending");
      assert.equal(review.userId, buyer.id, "server assigned the authenticated author");
      assert.equal(review.moderatedAt, null);

      const publicList = await api(`/api/products/${created.tee.slug}/reviews`);
      assert.equal(publicList.status, 200, publicList.text);
      assert.equal(publicList.json.count, 0, "pending review is not public");
      assert.equal(publicList.json.summary.count, 0, "pending review does not affect the aggregate");

      // A signed-out shopper cannot see the pending review either.
      const publicCtx = await browser.newContext({ baseURL: FRONTEND_URL, viewport: { width: 1440, height: 900 } });
      const publicPage = await publicCtx.newPage();
      await publicPage.goto(`/product/${created.tee.slug}`);
      await publicPage.getByText("No reviews yet").waitFor({ timeout: 15000 });
      assert.equal(await publicPage.getByText(reviewTitle).count(), 0);
      assert.equal(await publicPage.getByText(reviewBody).count(), 0);
      app.publicPage = publicPage;
      app.publicCtx = publicCtx;
      report.checks.review = { id: reviewId, status: review.status, authorId: review.userId };
    });

    await step("admin approves the review; public aggregate updates and abuse is denied", async () => {
      const buyer = await models.User.findOne({ where: { email: buyerEmail } });
      const duplicate = await api(`/api/products/${created.tee.slug}/reviews`, {
        method: "POST", token: buyerToken, body: { rating: 4, body: "A second review should not be allowed." },
      });
      assert.equal(duplicate.status, 409, duplicate.text);
      assert.equal(await models.ProductReview.count({ where: { productId: created.tee.id, userId: buyer.id } }), 1);

      const forbidden = await api(`/api/admin/reviews/${reviewId}`, {
        method: "PATCH", token: buyerToken, body: { status: "approved" },
      });
      assert.equal(forbidden.status, 403, forbidden.text);

      const adminPage = app.adminPage;
      await adminPage.goto("/admin/reviews");
      await adminPage.getByRole("heading", { name: "Review moderation" }).waitFor({ timeout: 15000 });
      await adminPage.getByText(reviewTitle).waitFor({ timeout: 15000 });
      await adminPage.getByText(buyerEmail).waitFor();
      await adminPage.getByRole("link", { name: "Everyday Tee" }).waitFor();
      await adminPage.getByRole("button", { name: "Approve", exact: true }).click();
      const dialog = adminPage.getByRole("dialog");
      await dialog.waitFor();
      await dialog.getByRole("button", { name: "Approve" }).click();
      await expectText(adminPage.getByText("Review approved"), /Review approved/);

      await new Promise((r) => setTimeout(r, 250));
      const approved = await models.ProductReview.findByPk(reviewId);
      assert.equal(approved.status, "approved");
      assert.equal(approved.moderatedBy, admin.user.id);
      assert.ok(approved.moderatedAt, "moderation timestamp recorded");

      const repeat = await api(`/api/admin/reviews/${reviewId}`, {
        method: "PATCH", token: admin.token, body: { status: "approved" },
      });
      assert.equal(repeat.status, 200, repeat.text);
      assert.equal(repeat.json.unchanged, true);
      const unchanged = await models.ProductReview.findByPk(reviewId);
      assert.equal(String(unchanged.moderatedAt), String(approved.moderatedAt), "repeated moderation keeps metadata");

      const publicList = await api(`/api/products/${created.tee.slug}/reviews`);
      assert.equal(publicList.status, 200, publicList.text);
      assert.equal(publicList.json.count, 1);
      assert.equal(publicList.json.summary.count, 1);
      assert.equal(publicList.json.summary.average, 5);
      assert.equal(publicList.json.reviews[0].title, reviewTitle);

      const publicPage = app.publicPage;
      await publicPage.reload();
      await publicPage.getByText(reviewTitle).waitFor({ timeout: 15000 });
      await publicPage.getByText(reviewBody).waitFor();
      await publicPage.getByText("1 approved review").waitFor();

      await adminPage.goto("/admin/reviews?status=approved");
      await adminPage.getByText(reviewTitle).waitFor({ timeout: 15000 });
      await adminPage.getByText(/Moderated .* by #/).waitFor();
      await adminPage.screenshot({ path: path.join(OUT, "admin-reviews-approved.png"), fullPage: true });
      report.checks.review = {
        id: reviewId, status: approved.status, moderatedBy: approved.moderatedBy,
        publicAverage: publicList.json.summary.average,
      };
    });

    await step("security and error paths (401/403/404, stock, idempotency)", async () => {
      const anon = await api("/api/orders");
      assert.equal(anon.status, 401);
      const other = await helpers.createVerifiedUser(BASE, { email: `other.${Date.now()}@buyotest.local` });
      const foreign = await api(`/api/orders/${orderId}`, { token: other.token });
      assert.equal(foreign.status, 404, foreign.text);

      // idempotent replay: same key returns the same order and never duplicates
      const addr = (await models.Address.findAll())[0];
      const key = `e2e-idem-${Date.now()}`;
      await api("/api/cart", { method: "POST", token: buyerToken, body: { productId: created.tumbler.id, qty: 1 } });
      const mailsBefore = app.mailer.getOutbox().filter((m) => m.to === buyerEmail).length;
      const first = await api("/api/orders", { method: "POST", token: buyerToken, body: { addressId: addr.id, idempotencyKey: key } });
      assert.equal(first.status, 201, first.text);
      const replay = await api("/api/orders", { method: "POST", token: buyerToken, body: { addressId: addr.id, idempotencyKey: key } });
      assert.equal(replay.status, 200, replay.text);
      assert.equal(replay.json.order.id, first.json.order.id);
      const rows = await models.Order.count({ where: { idempotencyKey: key } });
      assert.equal(rows, 1);
      const mailsAfter = app.mailer.getOutbox().filter((m) => m.to === buyerEmail).length;
      assert.equal(mailsAfter - mailsBefore, 1, "exactly one receipt for the real checkout");

      // stale stock blocks checkout without creating an order
      await api("/api/cart", { method: "POST", token: buyerToken, body: { productId: created.gnome.id, qty: 1 } });
      const update = await api(`/api/products/${created.gnome.id}`, { method: "PUT", token: admin.token, body: { stock: 0 } });
      assert.equal(update.status, 200, update.text);
      const totalBefore = await models.Order.count();
      const blocked = await api("/api/orders", {
        method: "POST", token: buyerToken,
        body: { addressId: addr.id, idempotencyKey: `e2e-stock-${Date.now()}` },
      });
      assert.ok([400, 409].includes(blocked.status), `stock conflict status ${blocked.status}: ${blocked.text}`);
      assert.equal(await models.Order.count(), totalBefore);
      await api(`/api/products/${created.gnome.id}`, { method: "PUT", token: admin.token, body: { stock: 4 } });

      // upload security
      const badForm = new FormData();
      badForm.append("name", "Bad Upload");
      badForm.append("category", "Garden");
      badForm.append("mrpPrice", "10");
      badForm.append("sellingPrice", "5");
      badForm.append("image", new Blob(["not an image"], { type: "text/plain" }), "evil.txt");
      const badUpload = await api("/api/products", { method: "POST", token: admin.token, form: badForm });
      assert.equal(badUpload.status, 400, badUpload.text);
      const unauthUpload = await api("/api/products", { method: "POST", token: buyerToken, form: badForm });
      assert.equal(unauthUpload.status, 403, unauthUpload.text);
    });

    await step("responsive layout: no horizontal overflow on phone, mobile nav works", async () => {
      const mobile = await browser.newContext({ baseURL: FRONTEND_URL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const m = await mobile.newPage();
      for (const url of ["/", "/shop", `/product/${created.bottle.slug}`, `/product/${created.tee.slug}`, "/cart", "/admin"]) {
        await m.goto(url);
        await m.waitForLoadState("networkidle").catch(() => {});
        const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(overflow <= 2, `${url} overflows by ${overflow}px`);
      }
      await m.goto("/");
      await m.getByRole("button", { name: "Open menu" }).click();
      await m.getByRole("navigation", { name: "Mobile" }).waitFor();
      await m.screenshot({ path: path.join(OUT, "mobile-home-menu.png"), fullPage: true });
      await mobile.close();
    });

    await step("accessibility basics: one H1, labelled controls, alt text, landmarks", async () => {
      await page.goto("/");
      await page.getByRole("link", { name: /Steel Bottle 750 ml/ }).first().waitFor();
      const audit = await page.evaluate(() => {
        const images = [...document.images];
        const unlabeled = [...document.querySelectorAll("button")].filter(
          (b) => !(b.textContent || "").trim() && !b.getAttribute("aria-label") && !b.getAttribute("aria-labelledby"),
        );
        return {
          h1: document.querySelectorAll("h1").length,
          lang: document.documentElement.lang,
          images: images.length,
          imagesMissingAlt: images.filter((i) => !i.hasAttribute("alt")).length,
          unlabeledButtons: unlabeled.length,
          main: document.querySelectorAll("main").length,
        };
      });
      assert.equal(audit.h1, 1);
      assert.equal(audit.lang, "en");
      assert.equal(audit.imagesMissingAlt, 0);
      assert.equal(audit.unlabeledButtons, 0);
      assert.ok(audit.main >= 1);
      report.checks.a11y = audit;
    });

    await step("SEO metadata and document titles", async () => {
      await page.goto("/");
      const meta = await page.evaluate(() => ({
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.content || "",
        ogTitle: document.querySelector('meta[property="og:title"]')?.content || "",
        canonical: document.querySelector('link[rel="canonical"]')?.href || "",
      }));
      assert.ok(meta.description.length > 20, "meta description present");
      assert.ok(meta.ogTitle, "og:title present");
      await page.goto(`/product/${created.bottle.slug}`);
      await expectText(page.locator("h1"), /Steel Bottle/);
      assert.match(await page.title(), /Steel Bottle/);
      report.checks.seo = meta;
    });

    await step("performance: page timings and production bundle budget", async () => {
      await page.goto("/shop");
      await page.waitForLoadState("load");
      const timing = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0];
        return { dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, transfer: performance.getEntriesByType("resource").reduce((s, r) => s + (r.transferSize || 0), 0) };
      });
      assert.ok(timing.dcl < 5000, `DCL ${timing.dcl}ms`);
      const dist = path.join(FRONTEND, "dist", "assets");
      const main = fs.readdirSync(dist).find((f) => /^index-.*\.js$/.test(f));
      const bytes = fs.statSync(path.join(dist, main)).size;
      assert.ok(bytes < 800 * 1024, `main bundle ${bytes}`);
      report.checks.perf = { timing, mainBundleBytes: bytes };
    });

    await step("no unexpected browser console errors", async () => {
      const relevant = report.consoleErrors.filter((e) =>
        !/favicon|Download the React DevTools|net::ERR_ABORTED/.test(e.text) &&
        !(e.url.endsWith("/account") && /status of 400/.test(e.text)) &&
        !(e.url.endsWith("/login") && /status of 403/.test(e.text)),
      );
      report.checks.consoleErrors = relevant;
      assert.equal(relevant.length, 0, JSON.stringify(relevant.slice(0, 5), null, 2));
    });

    await browser.close();
    await app.close();
    if (vite) vite.kill();
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - started;
    report.summary = { total: results.length, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
    fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2), "utf8");
    log(JSON.stringify(report.summary));
    process.exit(report.summary.failed ? 1 : 0);
  })().catch(async (error) => {
    console.error("[e2e] FATAL", error);
    report.fatal = String(error && error.stack || error);
    fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2), "utf8");
    if (vite) vite.kill();
    process.exit(2);
  });
}

main();
