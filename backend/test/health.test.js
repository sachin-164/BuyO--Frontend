// test/health.test.js — Phase 9: /api/health (liveness) and /api/health/ready
// (bounded database readiness).
//
// Uses the standard scratch harness — never the real buyoDB. One boot per
// process: closing the shared Sequelize pool (the outage simulation below)
// is terminal for this file, so everything runs in a single test in order —
// healthy checks first, outage behavior last.
const test = require("node:test");
const assert = require("node:assert");

const helpers = require("./helpers");

test("health: public liveness, bounded readiness, safe 503 outage behavior", async (t) => {
  const app = await helpers.startTestApp();
  t.after(() => app.close().catch(() => {})); // pool closed in the outage phase

  // --- healthy database ---
  // No auth header needed (deployment probes have no credentials).
  const live = await helpers.api(app.baseUrl, "/api/health");
  assert.equal(live.status, 200);
  assert.deepEqual(live.json, { success: true, status: "ok" });

  const ready = await helpers.api(app.baseUrl, "/api/health/ready");
  assert.equal(ready.status, 200);
  assert.deepEqual(ready.json, { success: true, ready: true });

  // Unknown subpaths and non-GET verbs stay on the JSON 404 path.
  const bogus = await helpers.api(app.baseUrl, "/api/health/bogus");
  assert.equal(bogus.status, 404);
  assert.equal(bogus.json.success, false);
  const post = await helpers.api(app.baseUrl, "/api/health", { method: "POST" });
  assert.equal(post.status, 404);

  // --- database gone (pool closed, as during an outage) ---
  await app.sequelize.close();

  const dead = await helpers.api(app.baseUrl, "/api/health/ready");
  assert.equal(dead.status, 503);
  assert.deepEqual(dead.json, { success: false, ready: false, message: "Database not ready" });
  // The failure body must leak nothing internal.
  assert.ok(
    !/127\.0\.0\.1|localhost|buyo|postgres|mysql|password|Error|at [A-Za-z]+ \(/i.test(dead.text),
    `readiness body leaked internals: ${dead.text}`
  );

  // Liveness keeps answering — it has no database dependency.
  const stillLive = await helpers.api(app.baseUrl, "/api/health");
  assert.equal(stillLive.status, 200);
  assert.deepEqual(stillLive.json, { success: true, status: "ok" });
});
