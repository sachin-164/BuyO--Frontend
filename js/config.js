// Central frontend configuration.
// Load this <script> BEFORE js/api.js and every page script (unchanged rule).
//
// API base URL resolution (Phase 8 — tested in backend/test/frontendConfig.test.js):
//   1. window.BUYO_API_URL, when set to a non-empty string, ALWAYS wins.
//      To run the frontend against a dedicated API host, add this BEFORE the
//      config.js script tag (or have the platform inject it):
//        <script>window.BUYO_API_URL = "https://api.example.com/api";</script>
//   2. Local development — page served from localhost / 127.0.0.1 / [::1]
//      (or opened directly via file://) — keeps the pre-Phase-8 behavior:
//        http://localhost:5000/api
//   3. Any other host (a deployed site) — same-origin "/api". A production
//      page therefore talks to the API deployed beside it and can NEVER
//      silently fall back to localhost.
// The resolved value is exposed as window.CONFIG (js/api.js reads CONFIG via
// `typeof CONFIG`, which finds window properties in browsers unchanged).
(function (global) {
  var LOCAL_API_URL = "http://localhost:5000/api";
  var LOCAL_HOSTNAMES = { localhost: 1, "127.0.0.1": 1, "[::1]": 1, "::1": 1, "": 1 };

  function resolveApiUrl() {
    var override = global.BUYO_API_URL;
    if (typeof override === "string" && override.replace(/\s/g, "") !== "") {
      return override;
    }
    var hostname = "";
    try {
      hostname = String((global.location && global.location.hostname) || "").toLowerCase();
    } catch (e) {
      hostname = "";
    }
    return LOCAL_HOSTNAMES[hostname] ? LOCAL_API_URL : "/api";
  }

  global.CONFIG = { API_URL: resolveApiUrl() };
})(window);
