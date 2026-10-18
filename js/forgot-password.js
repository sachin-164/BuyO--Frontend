// js/forgot-password.js — password reset request (Phase 9)
// POST /api/auth/forgot-password { email } — the server always answers with
// the same neutral message (no account enumeration), so success and failure
// show identical honest copy.
(function () {
  "use strict";
  if (!window.BuyOApi) return;

  var form = document.getElementById("forgotForm");
  var alertEl = document.getElementById("forgot-alert");
  var submitBtn = document.getElementById("forgot-submit");

  function showAlert(message, type) {
    if (!alertEl) return;
    alertEl.textContent = message || "";
    alertEl.classList.toggle("ui-form-alert--success", type === "success");
    alertEl.hidden = !message;
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    showAlert("");

    var email = form.email.value.trim();
    if (!email) {
      showAlert("Enter your account email.");
      return;
    }

    submitBtn.setAttribute("aria-busy", "true");
    submitBtn.disabled = true;

    var res = await BuyOApi.post("/auth/forgot-password", { email: email });

    submitBtn.removeAttribute("aria-busy");
    submitBtn.disabled = false;

    var message =
      (res.ok && res.data && res.data.message) ||
      res.message ||
      "If an account exists for that email, a password reset link has been sent.";

    if (res.ok) {
      form.hidden = true;
      var foot = document.querySelector(".ui-auth__foot");
      if (foot) foot.hidden = true;
      showAlert(message, "success");
      var hint = document.createElement("p");
      hint.className = "ui-auth__foot";
      hint.textContent = "The link expires shortly — check spam if it doesn't arrive.";
      alertEl.insertAdjacentElement("afterend", hint);
      return;
    }

    if (res.timedOut) {
      showAlert("The server didn't respond in time. Please try again.");
      return;
    }
    // Any non-network failure still shows the neutral message (mirrors server).
    showAlert(message);
  });
})();
