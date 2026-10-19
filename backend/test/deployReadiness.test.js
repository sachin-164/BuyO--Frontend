// test/deployReadiness.test.js — Phase 8: production dependency + Vercel
// serverless-candidate checks.
//
// 1. package.json: `pg` must be a PRODUCTION dependency (a deployed
//    PostgreSQL backend loads it at runtime); MySQL stays until the cutover
//    and rollback plan no longer need it; the embedded-PostgreSQL test
//    tooling stays a devDependency.
// 2. api/index.js restoreApiPrefix(): the documented URL-normalization cases.
// 3. A REAL HTTP round trip through the candidate serverless handler — no
//    Vercel involved, but the same entry function, proving stripped, full and
//    function-name path deliveries all route correctly through the actual
//    Express app (and that a public DB-backed route answers through it).
//
// Uses the standard scratch harness (helpers.js) — never the real buyoDB.
const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");

const helpers = require("./helpers"); // env must be in place before app modules

test("package.json: pg is a production dependency; test tooling intact", () => {
  const pkg = require("../package.json");
  assert.ok(pkg.dependencies.pg, "pg must be in dependencies (deployed PG runtime needs it)");
  assert.ok(!pkg.devDependencies || !pkg.devDependencies.pg, "pg must not remain in devDependencies");
  assert.ok(pkg.dependencies.mysql2, "MySQL dependency preserved until cutover/rollback no longer needs it");
  assert.ok(pkg.devDependencies["embedded-postgres"], "embedded-postgres stays a devDependency");
  // The win32 platform binary must be OPTIONAL, never a hard dev/prod
  // dependency: a non-optional dep with "os": ["win32"] hard-fails every
  // non-win32 install (npm EBADPLATFORM) — which is exactly how the Vercel
  // linux/x64 builder died whenever a dev-inclusive `npm install` ran (the
  // dashboard/redeploy path ignored the pinned installCommand). As an
  // optionalDependency npm SKIPS it with a warning on other platforms, so
  // `npm install` and `npm ci` now succeed everywhere; on Windows it still
  // installs for the local PG test suites.
  assert.ok(
    pkg.optionalDependencies && pkg.optionalDependencies["@embedded-postgres/windows-x64"],
    "win32 platform binary must be pinned in optionalDependencies (platform-tolerant installs)"
  );
  assert.ok(
    !pkg.devDependencies || !pkg.devDependencies["@embedded-postgres/windows-x64"],
    "win32 platform binary must not be a hard devDependency (EBADPLATFORM on linux builders)"
  );
  assert.ok(
    !pkg.dependencies || !pkg.dependencies["@embedded-postgres/windows-x64"],
    "win32 platform binary must not be a hard production dependency"
  );
  assert.ok(!pkg.dependencies["embedded-postgres"], "test-only tooling must not ship to production");
});

test("vercel.json: builder install omits devDependencies (linux/x64)", () => {
  // Defense layer 1: Vercel installs at the repo root and npm workspaces pull
  // backend's devDependencies, so pin the builder install to production deps
  // only. Defense layer 2 (backend/package.json): the win32-only embedded-PG
  // binary is an optionalDependency, so even a dev-inclusive `npm install`
  // (the path the dashboard/redeploy builds actually took) skips it on
  // non-win32 platforms instead of dying with EBADPLATFORM.
  const vercel = require("../../vercel.json");
  assert.ok(
    typeof vercel.installCommand === "string" && vercel.installCommand.includes("--omit=dev"),
    "installCommand must omit devDependencies (EBADPLATFORM on linux for the win32-only embedded-PG binary)"
  );
});

const handler = require("../../api/index.js");

test("restoreApiPrefix: documented normalization cases", () => {
  const { restoreApiPrefix } = handler;
  // full path delivery — passthrough
  assert.equal(restoreApiPrefix("/api/products?q=laptop"), "/api/products?q=laptop");
  assert.equal(restoreApiPrefix("/api"), "/api");
  assert.equal(restoreApiPrefix("/api/"), "/api/");
  // stripped sub-path delivery — restore the prefix, keep query + sub-path
  assert.equal(restoreApiPrefix("/products?q=laptop"), "/api/products?q=laptop");
  assert.equal(restoreApiPrefix("/auth/login"), "/api/auth/login");
  assert.equal(restoreApiPrefix("/"), "/api");
  assert.equal(restoreApiPrefix("?page=2"), "/api?page=2");
  // function-name delivery — collapse /api/index back to /api
  assert.equal(restoreApiPrefix("/api/index"), "/api");
  assert.equal(restoreApiPrefix("/api/index/products"), "/api/products");
  assert.equal(restoreApiPrefix("/api/index/auth/login?x=1"), "/api/auth/login?x=1");
  // degenerate inputs
  assert.equal(restoreApiPrefix(""), "/api");
  assert.equal(restoreApiPrefix(undefined), "/api");
});

test("serverless handler round trip: stripped, full and function-name deliveries", async (t) => {
  // Boot the scratch DB + models (tables exist for the positive-path check).
  const app = await helpers.startTestApp();
  t.after(() => app.close());

  // Our own HTTP server wrapping the SAME handler api/index.js exports.
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  // Stripped delivery of an unknown route: prefix restored, query preserved —
  // the Express 404 handler echoes the FULL route it saw.
  const stripped = await fetch(base + "/definitely-missing?a=b");
  assert.equal(stripped.status, 404);
  assert.match((await stripped.json()).message, /\/api\/definitely-missing\?a=b/);

  // Full-path delivery passes through untouched.
  const full = await fetch(base + "/api/definitely-missing");
  assert.equal(full.status, 404);
  assert.match((await full.json()).message, /^Route GET \/api\/definitely-missing not found$/);

  // Function-name delivery is collapsed to the plain /api path.
  const fnForm = await fetch(base + "/api/index/definitely-missing");
  assert.equal(fnForm.status, 404);
  assert.match((await fnForm.json()).message, /^Route GET \/api\/definitely-missing not found$/);

  // Positive path through the real router + database with a stripped URL.
  const products = await fetch(base + "/products?limit=1");
  assert.equal(products.status, 200);
  const catalog = await products.json();
  assert.equal(catalog.success, true);
  assert.ok(Array.isArray(catalog.products));
});
