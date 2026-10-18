// js/signup.js — BuyO account creation (Phase 9 rewrite)
// Real API contract:
//   POST /api/auth/signup { name, email, password } -> 201 on success,
//   400 "User already exists", 503 when the verification email could not be
//   sent (the account is rolled back server-side, so retrying is safe),
//   500 fallback.
// Signup never signs the user in (the API returns no token) — success swaps
// the form for an honest "check your email to verify" state instead of
// pretending to log in.
(function () {
  "use strict";
  if (!window.BuyOApi) return;

  var form = document.getElementById("signupForm");
  var alertEl = document.getElementById("signup-alert");
  var submitBtn = document.getElementById("signup-submit");
  var pwInput = document.getElementById("signup-password");
  var pwToggle = document.getElementById("signup-password-toggle");
  var confirmInput = document.getElementById("signup-confirm");
  var confirmError = document.getElementById("signup-confirm-error");

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

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    showAlert("");

    var name = form.name.value.trim();
    var email = form.email.value.trim();
    var password = form.password.value;
    var confirm = form.confirm.value;

    if (!name || !email || !password || !confirm) {
      showAlert("Fill in all fields.");
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
    if (password.length < 8) {
      showAlert("Password must be at least 8 characters.");
      pwInput.focus();
      return;
    }

    submitBtn.setAttribute("aria-busy", "true");
    submitBtn.disabled = true;

    var res = await BuyOApi.post("/auth/signup", { name: name, email: email, password: password });

    submitBtn.removeAttribute("aria-busy");
    submitBtn.disabled = false;

    if (res.ok) {
      // Honest success state — verification email instructions, sign-in link.
      form.hidden = true;
      var foot = document.querySelector(".ui-auth__foot");
      if (foot) foot.hidden = true;
      showAlert(
        (res.data && res.data.message) ||
          "Signup successful! Check your email for verification.",
        "success"
      );
      var wrapper = document.createElement("p");
      wrapper.className = "ui-auth__foot";
      wrapper.innerHTML =
        'Verified already? <a href="login.html">Sign in</a>';
      alertEl.insertAdjacentElement("afterend", wrapper);
      alertEl.focus && alertEl.focus();
      return;
    }

    showAlert(res.message || "Signup failed. Please try again.");
    if (res.timedOut) {
      showAlert("The server didn't respond in time. Please check your connection and try again.");
    }
  });
})();
