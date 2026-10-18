// js/login.js — BuyO sign-in (Phase 9 rewrite)
// Replaces the old alert()-based handler with the real API contract:
//   POST /api/auth/login { email, password } -> { token, user }
//   401 "Invalid email or password."  |  403 "Email not verified..."
// Server messages are surfaced honestly (inline alert region, no alerts).
//
// ?next= redirect support (used by the cart/checkout guest states AND the
// admin gate) — accepted only when it is a plain same-site page name
// ("cart.html") or an admin page ("admin/products.html"), so a crafted URL
// can never bounce users off-site (open-redirect guard). The admin gate
// re-verifies database-backed admin rights after the redirect anyway.
(function () {
  "use strict";
  if (!window.BuyOApi) return;

  var form = document.getElementById("loginForm");
  var alertEl = document.getElementById("login-alert");
  var submitBtn = document.getElementById("login-submit");
  var pwInput = document.getElementById("login-password");
  var pwToggle = document.getElementById("login-password-toggle");

  function safeNext() {
    var match = location.search.match(/[?&]next=([^&]+)/);
    if (!match) return "index.html";
    var value = "";
    try {
      value = decodeURIComponent(match[1]);
    } catch (e) {
      return "index.html";
    }
    // Plain page name (optionally inside /admin): no protocols, hosts, or
    // extra segments. Never bounce back into the auth pages themselves.
    if (
      /^(admin\/)?[A-Za-z0-9_-]+\.html$/.test(value) &&
      !/(^|\/)(login|signup)\.html$/.test(value)
    ) {
      return value;
    }
    return "index.html";
  }

  function showAlert(message) {
    if (!alertEl) return;
    alertEl.textContent = message || "";
    alertEl.hidden = !message;
  }

  // Password visibility toggle (login.png reference shows an eye control).
  if (pwToggle && pwInput) {
    pwToggle.addEventListener("click", function () {
      var show = pwInput.type === "password";
      pwInput.type = show ? "text" : "password";
      pwToggle.setAttribute("aria-pressed", show ? "true" : "false");
      pwToggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
      pwInput.focus();
    });
  }

  // Already signed in? Leave for the destination instead of showing the form.
  if (BuyOApi.getToken()) {
    BuyOApi.get("/auth/me", { auth: "required" }).then(function (res) {
      if (res.ok) window.location.replace(safeNext());
      // 401 -> api.js cleared the stale session; the form stays usable.
    });
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    showAlert("");

    var email = form.email.value.trim();
    var password = form.password.value;

    if (!email || !password) {
      showAlert("Enter your email and password.");
      return;
    }

    submitBtn.setAttribute("aria-busy", "true");
    submitBtn.disabled = true;

    var res = await BuyOApi.post("/auth/login", { email: email, password: password });

    submitBtn.removeAttribute("aria-busy");
    submitBtn.disabled = false;

    if (res.ok && res.data && res.data.token) {
      try {
        localStorage.setItem("token", res.data.token);
        // Legacy flag kept in sync for older pages that still read it.
        localStorage.setItem("isLoggedIn", "true");
      } catch (e) {
        showAlert("Signed in, but this browser blocked storage — please check your privacy settings.");
        return;
      }
      window.location.href = safeNext();
      return;
    }

    showAlert(res.message || "Sign in failed. Please try again.");
    if (res.timedOut) {
      showAlert("The server didn't respond in time. Please check your connection and try again.");
    }
  });
})();
