// js/api.js — BuyO frontend API client (Phase 7)
// Load AFTER js/config.js (needs CONFIG.API_URL) and BEFORE page scripts.
//
// Why this exists: login.js / signup.js / product-details.js each call fetch()
// directly. Those callers are intentionally left untouched this phase (rewiring
// live auth flows is Phase 9+ risk); this client is the single fetch wrapper
// for all NEW code (layout shell, product search) and becomes the standard for
// every later phase.
//
// Contract:
//   await BuyOApi.get("/products?q=laptop")
//   -> { ok, status, data, message, timedOut? }
// Never throws; network/timeout/parse failures come back as ok:false.
//
// 401 policy ("careful 401"): a session is cleared ONLY when a request that
// actually carried a token is rejected with 401 — i.e. the token we hold is
// provably invalid. Public requests (no token) and unrelated failures never
// touch the session, so there is no way to log a user out by hitting a public
// endpoint, and no redirect happens automatically (redirect loops are
// impossible; the header reacts to the "buyo:session-cleared" event instead).
(function (global) {
  "use strict";

  var TOKEN_KEY = "token";
  var LEGACY_LOGGED_IN_KEY = "isLoggedIn"; // set by login.js — kept in sync
  var DEFAULT_TIMEOUT_MS = 10000;

  function baseUrl() {
    // js/config.js declares `const CONFIG` — a global-lexical binding, NOT a
    // window property. Reference it through typeof (safe) so the legacy
    // const-style config keeps working untouched.
    var cfg = typeof CONFIG !== "undefined" ? CONFIG : null;
    return (cfg && cfg.API_URL) || "/api";
  }

  function getToken() {
    try {
      return global.localStorage.getItem(TOKEN_KEY);
    } catch (e) {
      return null;
    }
  }

  function clearSession() {
    try {
      global.localStorage.removeItem(TOKEN_KEY);
      global.localStorage.removeItem(LEGACY_LOGGED_IN_KEY);
    } catch (e) {
      /* storage unavailable — nothing to clear */
    }
  }

  function notifySessionCleared() {
    try {
      document.dispatchEvent(new CustomEvent("buyo:session-cleared"));
    } catch (e) {
      /* CustomEvent unsupported — degrade silently */
    }
  }

  function buildUrl(path) {
    if (/^https?:\/\//i.test(path)) return path;
    return baseUrl() + (path.charAt(0) === "/" ? path : "/" + path);
  }

  async function request(path, options) {
    options = options || {};
    var method = (options.method || "GET").toUpperCase();
    var body = options.body;
    var extraHeaders = options.headers || {};
    var timeoutMs =
      typeof options.timeoutMs === "number" && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_TIMEOUT_MS;
    // auth: "if-present" (default) attaches the token when one exists;
    // "never" guarantees no Authorization header (pure public requests).
    var auth = options.auth === "never" ? "never" : "if-present";

    var headers = { Accept: "application/json" };
    Object.keys(extraHeaders).forEach(function (key) {
      headers[key] = extraHeaders[key];
    });

    var token = auth === "never" ? null : getToken();
    if (token) headers.Authorization = "Bearer " + token;

    var payload;
    if (body === undefined || body === null) {
      payload = undefined;
    } else if (typeof FormData !== "undefined" && body instanceof FormData) {
      payload = body; // let the browser set the multipart boundary
    } else {
      payload = JSON.stringify(body);
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    }

    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, timeoutMs);

    var response;
    try {
      response = await fetch(buildUrl(path), {
        method: method,
        headers: headers,
        body: payload,
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === "AbortError") {
        return {
          ok: false,
          status: 0,
          data: null,
          timedOut: true,
          message: "Request timed out. Please try again."
        };
      }
      return {
        ok: false,
        status: 0,
        data: null,
        message: "Network error. Please check your connection."
      };
    }
    clearTimeout(timer);

    var data = null;
    var text = "";
    try {
      text = await response.text();
      if (text) data = JSON.parse(text);
    } catch (e) {
      data = null; // non-JSON body (e.g. an HTML error page)
    }

    if (response.status === 401 && token) {
      // Only a token-bearing request can invalidate the session.
      clearSession();
      notifySessionCleared();
    }

    var message = null;
    if (data && typeof data === "object") {
      if (typeof data.message === "string") message = data.message;
      else if (Array.isArray(data.errors) && data.errors.length)
        message = String(data.errors[0]);
    }
    if (!message && !response.ok)
      message = "Request failed (" + response.status + ").";

    return {
      ok: response.ok,
      status: response.status,
      data: data,
      message: message
    };
  }

  global.BuyOApi = {
    request: request,
    get: function (path, options) {
      options = options || {};
      options.method = "GET";
      return request(path, options);
    },
    post: function (path, body, options) {
      options = options || {};
      options.method = "POST";
      options.body = body;
      return request(path, options);
    },
    put: function (path, body, options) {
      options = options || {};
      options.method = "PUT";
      options.body = body;
      return request(path, options);
    },
    del: function (path, options) {
      options = options || {};
      options.method = "DELETE";
      return request(path, options);
    },
    getToken: getToken,
    clearSession: clearSession,
    // Explicit sign-out (user action). Clears the local session and tells
    // listeners; no server call is required because JWTs are stateless.
    signOut: function () {
      clearSession();
      try {
        document.dispatchEvent(new CustomEvent("buyo:signed-out"));
      } catch (e) {
        /* degrade silently */
      }
    }
  };
})(window);
