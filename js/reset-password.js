// js/reset-password.js — password reset confirmation (Phase 9)
// The reset email links to reset-password.html?token=... (backend contract).
//   POST /api/auth/reset-password { token, password } -> 200 on success,
//   400 "Invalid or expired reset link." / 500 fallback.
(function () {
  "use strict";
  if (!window.BuyOApi) return;

  var form = document.getElementById("resetForm");
  var alertEl = document.getElementById("reset-alert");
  var submitBtn = document.getElementById("reset-submit");
  var pwInput = document.getElementById("reset-password");
  var pwToggle = document.getElementById("reset-password-toggle");
  var confirmInput = document.getElementById("reset-confirm");
  var confirmError = document.getElementById("reset-confirm-error");

  var token = "";
  try {
    token = new URLSearchParams(location.search).get("token") || "";
  } catch (e) {
    token = "";
  }

  function showAlert(message, type) {
    if (!alertEl) return;
    alertEl.textContent = message || "";
    alertEl.classList.toggle("ui-form-alert--success", type === "success");
    alertEl.hidden = !message;
  }

  if (pwToggle && pwInput) {
    pwToggle.addEventListener("click", function () {
      var show = pwInput.type === "password";
      pwInput.type = show ? "text" : "password";
      pwToggle.setAttribute("aria-pressed", show ? "true" : "false");
      pwToggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
      pwInput.focus();
    });
  }

  if (confirmInput) {
    confirmInput.addEventListener("input", function () {
      if (confirmError) {
        confirmError.hidden = true;
        confirmError.textContent = "";
      }
      confirmInput.removeAttribute("aria-invalid");
    });
  }

  // No/short token in the URL: the form cannot work — say so honestly.
  if (!token || token.length < 10) {
    form.hidden = true;
    var foot = document.querySelector(".ui-auth__foot");
    if (foot) foot.hidden = true;
    showAlert(
      "This reset link is incomplete. Request a new one below — reset links expire quickly."
    );
    var hint = document.createElement("p");
    hint.className = "ui-auth__foot";
    hint.innerHTML = '<a href="forgot-password.html">Request a new reset link</a>';
    if (alertEl) alertEl.insertAdjacentElement("afterend", hint);
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    showAlert("");

    var password = form.password.value;
    var confirm = form.confirm.value;

    if (password.length < 8) {
      showAlert("Password must be at least 8 characters.");
      pwInput.focus();
      return;
    }
    if (password !== confirm) {
      if (confirmError) {
        confirmError.textContent = "Passwords don't match.";
        confirmError.hidden = false;
      }
      confirmInput.setAttribute("aria-invalid", "true");
      confirmInput.focus();
      return;
    }

    submitBtn.setAttribute("aria-busy", "true");
    submitBtn.disabled = true;

    var res = await BuyOApi.post("/auth/reset-password", { token: token, password: password });

    submitBtn.removeAttribute("aria-busy");
    submitBtn.disabled = false;

    if (res.ok) {
      form.hidden = true;
      var pageFoot = document.querySelector(".ui-auth__foot");
      if (pageFoot) pageFoot.hidden = true;
      showAlert(
        (res.data && res.data.message) || "Password updated. You can now sign in.",
        "success"
      );
      var link = document.createElement("p");
      link.className = "ui-auth__foot";
      link.innerHTML = '<a href="login.html">Sign in with your new password</a>';
      alertEl.insertAdjacentElement("afterend", link);
      return;
    }

    if (res.timedOut) {
      showAlert("The server didn't respond in time. Please try again.");
      return;
    }
    showAlert(res.message || "Couldn't reset the password.");
    if (res.status === 400) {
      // Expired/used link — offer a fresh one.
      var retry = document.createElement("p");
      retry.className = "ui-auth__foot";
      retry.innerHTML = '<a href="forgot-password.html">Request a new reset link</a>';
      alertEl.insertAdjacentElement("afterend", retry);
    }
  });
})();
