// test/frontendConfig.test.js — Phase 8: js/config.js API-URL resolution.
//
// Runs the REAL js/config.js in a sandboxed Node VM whose global object plays
// the role of `window` (in browsers window === globalThis, so window.CONFIG is
// the bare CONFIG that js/api.js checks with `typeof CONFIG`). No server, no
// database, no network — this file is dialect-agnostic.
//
// Documents and pins the three resolution rules (see js/config.js header):
//   1. window.BUYO_API_URL override always wins,
//   2. local hosts keep http://localhost:5000/api (pre-Phase-8 behavior),
//   3. any other host resolves to same-origin "/api" and NEVER localhost.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const CONFIG_SOURCE = fs.readFileSync(path.join(__dirname, "..", "..", "js", "config.js"), "utf8");

function resolveConfig({ hostname, override } = {}) {
  const sandbox = {};
  sandbox.window = sandbox; // window === globalThis, as in a browser
  sandbox.location = { protocol: "https:", hostname };
  if (override !== undefined) sandbox.BUYO_API_URL = override;
  vm.runInNewContext(CONFIG_SOURCE, sandbox);
  return sandbox;
}

test("local development: localhost / 127.0.0.1 / [::1] / empty hostname keep the local API", () => {
  for (const hostname of ["localhost", "127.0.0.1", "[::1]", "LOCALHOST"]) {
    const sandbox = resolveConfig({ hostname });
    assert.equal(sandbox.CONFIG.API_URL, "http://localhost:5000/api", `hostname=${hostname}`);
  }
  // file:// pages have an empty hostname — same behavior as before Phase 8
  const filePage = resolveConfig({ hostname: "" });
  assert.equal(filePage.CONFIG.API_URL, "http://localhost:5000/api");
});

test("production hosts resolve to same-origin /api and NEVER localhost", () => {
  for (const hostname of ["buyo.example.com", "vercel.app-domain.example", "192.168.1.20"]) {
    const sandbox = resolveConfig({ hostname });
    assert.equal(sandbox.CONFIG.API_URL, "/api", `hostname=${hostname}`);
    assert.ok(
      !/localhost|127\.0\.0\.1/i.test(sandbox.CONFIG.API_URL),
      `production config must not point at localhost (got ${sandbox.CONFIG.API_URL})`
    );
  }
});

test("window.BUYO_API_URL override wins on any host", () => {
  const prod = resolveConfig({ hostname: "buyo.example.com", override: "https://api.buyo.example.com/api" });
  assert.equal(prod.CONFIG.API_URL, "https://api.buyo.example.com/api");

  const local = resolveConfig({ hostname: "localhost", override: "https://api.buyo.example.com/api" });
  assert.equal(local.CONFIG.API_URL, "https://api.buyo.example.com/api");
});

test("whitespace or non-string overrides are ignored (fall through to the rules)", () => {
  assert.equal(resolveConfig({ hostname: "buyo.example.com", override: "   " }).CONFIG.API_URL, "/api");
  assert.equal(resolveConfig({ hostname: "localhost", override: 42 }).CONFIG.API_URL, "http://localhost:5000/api");
});

test("CONFIG is reachable as a bare global, exactly like before (js/api.js contract)", () => {
  const sandbox = resolveConfig({ hostname: "buyo.example.com" });
  // js/api.js does `typeof CONFIG !== "undefined" ? CONFIG : null` — that only
  // works if CONFIG is a property of the global object, not a private binding.
  assert.equal(vm.runInNewContext("typeof CONFIG", sandbox), "object");
  assert.equal(vm.runInNewContext("CONFIG.API_URL", sandbox), "/api");
});
