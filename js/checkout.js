// js/checkout.js — COD checkout (Phase 9)
// Reference: design-references/checkout.png (two panels: order review left,
// step flow right — Information → Payment → Completed), adapted to BuyO's real
// API surface:
//   GET    /api/cart        -> review items + server totals
//   GET    /api/addresses   -> saved-address radio cards
//   POST   /api/addresses   -> add address (modal form, server-validated)
//   POST   /api/orders      -> { addressId, idempotencyKey } — COD only
//
// Idempotency: the key is generated once per checkout attempt and kept in
// sessionStorage, so retrying after a network failure cannot double-order.
// Deviations from the reference (deliberate, no fake UI): no card/wallet forms
// (COD is the only implemented method), no coupon field, no discount rows.
(function () {
  "use strict";

  var CATALOG = window.BuyOCatalog;
  if (!CATALOG || !window.BuyOApi) return;

  var els = {
    guest: document.getElementById("checkout-guest"),
    empty: document.getElementById("checkout-empty"),
    body: document.getElementById("checkout-body"),
    reviewItems: document.getElementById("review-items"),
    reviewTotals: document.getElementById("review-totals"),
    reviewNotice: document.getElementById("review-notice"),
    choices: document.getElementById("address-choices"),
    addBtn: document.getElementById("add-address-btn"),
    toPayment: document.getElementById("to-payment-btn"),
    stepInfo: document.getElementById("step-info"),
    stepPay: document.getElementById("step-pay"),
    stepDone: document.getElementById("step-done"),
    payAddress: document.getElementById("pay-address"),
    placeOrder: document.getElementById("place-order-btn"),
    backInfo: document.getElementById("back-info-btn"),
    doneMeta: document.getElementById("done-meta"),
    modal: document.getElementById("address-modal"),
    addressForm: document.getElementById("address-form"),
    saveBtn: document.getElementById("save-address-btn")
  };

  var state = {
    cart: null,
    addresses: [],
    selectedAddressId: null,
    step: "info", // info | pay | done
    placing: false
  };

  function toast(message, type) {
    if (window.BuyOUi) BuyOUi.toast(message, { type: type || "info" });
  }

  function show(view) {
    els.guest.hidden = view !== "guest";
    els.empty.hidden = view !== "empty";
    els.body.hidden = view !== "body";
  }

  // ---------- Idempotency key (one per attempt, reused on retry) ----------
  var IDEMPOTENCY_STORAGE = "buyo:checkout:idempotencyKey";

  function idempotencyKey() {
    try {
      var existing = sessionStorage.getItem(IDEMPOTENCY_STORAGE);
      if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
      var bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      var key = Array.prototype.map
        .call(bytes, function (b) {
          return ("0" + b.toString(16)).slice(-2);
        })
        .join("");
      sessionStorage.setItem(IDEMPOTENCY_STORAGE, key);
      return key;
    } catch (e) {
      // Storage/crypto unavailable — fall back to a per-call random key.
      return "co-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    }
  }

  function clearIdempotencyKey() {
    try {
      sessionStorage.removeItem(IDEMPOTENCY_STORAGE);
    } catch (e) {
      /* nothing to clear */
    }
  }

  // ---------- Order review panel ----------
  function renderReview(cart) {
    els.reviewItems.innerHTML = cart.items
      .map(function (item) {
        var safeImage = CATALOG.safeImageUrl(item.image);
        var media = safeImage
          ? '<img src="' + CATALOG.esc(safeImage) + '" alt="" loading="lazy">'
          : CATALOG.esc(String(item.name || "?").charAt(0).toUpperCase());
        return (
          '<li class="ui-checkout-item">' +
          '<span class="ui-checkout-item__media">' +
          media +
          "</span>" +
          "<span>" +
          '<span class="ui-checkout-item__name">' +
          CATALOG.esc(item.name) +
          "</span>" +
          '<span class="ui-checkout-item__meta">Qty ' +
          item.qty +
          (item.unavailable ? " · unavailable" : "") +
          "</span>" +
          "</span>" +
          '<span class="ui-checkout-item__price">' +
          CATALOG.formatPrice(item.lineTotal) +
          "</span>" +
          "</li>"
        );
      })
      .join("");

    var totals = cart.totals || {};
    var tax = totals.tax || { total: 0 };
    function row(label, value, extraClass) {
      return (
        '<div class="ui-summary__row' +
        (extraClass ? " " + extraClass : "") +
        '">' +
        "<dt>" +
        label +
        "</dt>" +
        '<dd class="ui-summary__value">' +
        value +
        "</dd>" +
        "</div>"
      );
    }
    els.reviewTotals.innerHTML =
      row("Subtotal", CATALOG.formatPrice(totals.subtotal)) +
      row("Tax (GST)", CATALOG.formatPrice(tax.total)) +
      row("Total", CATALOG.formatPrice(totals.grandTotal), "ui-summary__row--total");
    els.reviewNotice.textContent = cart.totalsNotice || "";
    els.reviewNotice.hidden = !cart.totalsNotice;
  }

  // ---------- Address step ----------
  function renderAddressChoices() {
    if (!state.addresses.length) {
      els.choices.innerHTML =
        '<p class="ui-address-card__text" style="margin: 0;">No saved addresses yet — add one to continue.</p>';
      els.toPayment.disabled = true;
      return;
    }
    els.choices.innerHTML = state.addresses
      .map(function (address) {
        var selected = address.id === state.selectedAddressId;
        return (
          '<label class="ui-address-card' +
          (selected ? " ui-address-card--selected" : "") +
          '" data-address-id="' +
          address.id +
          '">' +
          '<input type="radio" name="shipping-address" value="' +
          address.id +
          '"' +
          (selected ? " checked" : "") +
          " />" +
          '<span class="ui-address-card__body">' +
          '<span class="ui-address-card__name">' +
          CATALOG.esc(address.fullName) +
          "</span>" +
          '<span class="ui-address-card__text">' +
          CATALOG.esc(
            [address.line1, address.line2, address.city + " " + address.pincode, address.state]
              .filter(Boolean)
              .join(", ")
          ) +
          "<br>" +
          CATALOG.esc(address.phone) +
          "</span>" +
          (address.isDefault
            ? '<span class="ui-address-card__badges"><span class="ui-badge ui-badge--neutral">Default</span></span>'
            : "") +
          "</span>" +
          "</label>"
        );
      })
      .join("");
    els.toPayment.disabled = !state.selectedAddressId;
  }

  function selectedAddress() {
    return (
      state.addresses.find(function (a) {
        return a.id === state.selectedAddressId;
      }) || null
    );
  }

  function renderPayAddress() {
    var address = selectedAddress();
    if (!address) {
      els.payAddress.innerHTML = "";
      return;
    }
    els.payAddress.innerHTML =
      '<div class="ui-address-card ui-address-card--selected" style="cursor: default;">' +
      '<span class="ui-address-card__body">' +
      '<span class="ui-address-card__name">Deliver to ' +
      CATALOG.esc(address.fullName) +
      "</span>" +
      '<span class="ui-address-card__text">' +
      CATALOG.esc(
        [address.line1, address.line2, address.city + " " + address.pincode, address.state]
          .filter(Boolean)
          .join(", ")
      ) +
      "<br>" +
      CATALOG.esc(address.phone) +
      "</span>" +
      "</span>" +
      "</div>";
  }

  // ---------- Step machine ----------
  function setStep(step) {
    state.step = step;
    els.stepInfo.hidden = step !== "info";
    els.stepPay.hidden = step !== "pay";
    els.stepDone.hidden = step !== "done";

    var order = { info: 0, pay: 1, done: 2 };
    var indicators = document.querySelectorAll("[data-step-indicator]");
    Array.prototype.forEach.call(indicators, function (node) {
      var nodeStep = node.getAttribute("data-step-indicator");
      node.classList.remove("ui-steps__item--active", "ui-steps__item--done");
      node.removeAttribute("aria-current");
      var num = node.querySelector(".ui-steps__num");
      if (order[nodeStep] < order[step]) {
        node.classList.add("ui-steps__item--done");
        if (num) num.textContent = "✓";
      } else if (nodeStep === step) {
        node.classList.add("ui-steps__item--active");
        node.setAttribute("aria-current", "step");
        if (num) num.textContent = String(order[nodeStep] + 1);
      } else if (num) {
        num.textContent = String(order[nodeStep] + 1);
      }
    });

    if (step === "pay") renderPayAddress();
    var heading = step === "info" ? "Delivery Address" : step === "pay" ? "Payment" : "Completed";
    document.title = "Checkout (" + heading + ") — BuyO";
  }

  // ---------- Loading ----------
  async function loadCart() {
    var res = await BuyOApi.get("/cart");
    if (res.status === 401) {
      show("guest");
      return null;
    }
    if (!res.ok) {
      show("empty");
      toast(res.message || "Couldn't load your cart.", "error");
      return null;
    }
    if (!res.data || !res.data.count) {
      show("empty");
      return null;
    }
    state.cart = res.data;
    renderReview(res.data);
    show("body");
    return res.data;
  }

  async function loadAddresses() {
    var res = await BuyOApi.get("/addresses");
    if (!res.ok) {
      if (res.status === 401) {
        show("guest");
      }
      return;
    }
    state.addresses = (res.data && res.data.addresses) || [];
    if (!state.selectedAddressId) {
      var defaultAddr = state.addresses.find(function (a) {
        return a.isDefault;
      });
      state.selectedAddressId = defaultAddr
        ? defaultAddr.id
        : state.addresses.length
        ? state.addresses[0].id
        : null;
    }
    renderAddressChoices();
  }

  // ---------- Address form (modal) ----------
  function fieldError(name, message) {
    var el = els.addressForm.querySelector('[data-error-for="' + name + '"]');
    var input = els.addressForm.elements[name];
    if (el) {
      el.textContent = message || "";
      el.hidden = !message;
    }
    if (input) {
      if (message) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
  }

  function clearFormErrors() {
    ["fullName", "phone", "line1", "city", "state", "pincode"].forEach(function (name) {
      fieldError(name, "");
    });
  }

  // Client mirror of the server rules (addressRoutes schema) for instant
  // feedback; the server remains the authority and its message wins.
  function validateAddressForm(data) {
    var errors = {};
    if (!data.fullName || data.fullName.length < 2) errors.fullName = "Enter the recipient's full name (2+ characters).";
    if (!data.phone || !/^\+?\d{10,15}$/.test(String(data.phone).replace(/[\s-]/g, "")))
      errors.phone = "Enter a 10-15 digit phone number.";
    if (!data.line1 || data.line1.length < 3) errors.line1 = "Enter the street address (3+ characters).";
    if (!data.city || data.city.length < 2) errors.city = "Enter the city.";
    if (!data.state || data.state.length < 2) errors.state = "Enter the state.";
    if (!/^[1-9][0-9]{5}$/.test(String(data.pincode || "")))
      errors.pincode = "PIN code must be 6 digits and start with 1-9.";
    return errors;
  }

  // Modal wiring is guarded: a page without the modal must still be able to
  // pick a saved address and place the order.
  if (els.modal && els.addressForm && els.addBtn) {
    els.addBtn.addEventListener("click", function () {
      els.addressForm.reset();
      clearFormErrors();
      if (window.BuyOUi) BuyOUi.openModal(els.modal);
    });

    els.addressForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      clearFormErrors();

      var form = els.addressForm.elements;
      var payload = {
        fullName: form.fullName.value.trim(),
        phone: form.phone.value.trim(),
        line1: form.line1.value.trim(),
        line2: form.line2.value.trim() || undefined,
        city: form.city.value.trim(),
        state: form.state.value.trim(),
        pincode: form.pincode.value.trim(),
        label: form.label.value.trim() || undefined,
        isDefault: form.isDefault.checked ? true : undefined
      };

      var clientErrors = validateAddressForm(payload);
      var names = Object.keys(clientErrors);
      if (names.length) {
        names.forEach(function (name) {
          fieldError(name, clientErrors[name]);
        });
        var firstInput = els.addressForm.elements[names[0]];
        if (firstInput) firstInput.focus();
        return;
      }

      els.saveBtn.setAttribute("aria-busy", "true");
      els.saveBtn.disabled = true;
      var res = await BuyOApi.post("/addresses", payload);
      els.saveBtn.removeAttribute("aria-busy");
      els.saveBtn.disabled = false;

      if (!res.ok) {
        // Server validation failures return 400 { message: "Validation failed",
        // errors: ["<field> ...", ...] }. Each entry starts with the field name,
        // so map it back to the input; anything else surfaces as a toast.
        var message = res.message || "Couldn't save the address.";
        var serverErrors = (res.data && res.data.errors) || [];
        var fieldNames = ["fullName", "phone", "line1", "city", "state", "pincode"];
        var mapped = false;
        if (Array.isArray(serverErrors)) {
          serverErrors.forEach(function (entry) {
            var text = String(entry);
            for (var i = 0; i < fieldNames.length; i++) {
              if (text.indexOf(fieldNames[i]) === 0) {
                fieldError(fieldNames[i], text);
                mapped = true;
                break;
              }
            }
          });
        }
        if (!mapped) toast(message, "error");
        return;
      }

      var created = res.data && res.data.address;
      if (window.BuyOUi) BuyOUi.closeModal(els.modal);
      toast(res.data && res.data.message ? res.data.message : "Address saved.", "success");
      if (created && created.id) state.selectedAddressId = created.id;
      await loadAddresses();
    });

    // Live-clear a field's error as the user types.
    els.addressForm.addEventListener("input", function (event) {
      var name = event.target && event.target.name;
      if (name) fieldError(name, "");
    });
  } /* end modal guard */

  // ---------- Address selection ----------
  els.choices.addEventListener("change", function (event) {
    if (event.target.name !== "shipping-address") return;
    state.selectedAddressId = Number(event.target.value) || null;
    renderAddressChoices();
  });

  els.toPayment.addEventListener("click", function () {
    if (!state.selectedAddressId) return;
    setStep("pay");
    els.placeOrder.focus();
  });

  els.backInfo.addEventListener("click", function () {
    setStep("info");
  });

  // ---------- Place order (COD) ----------
  els.placeOrder.addEventListener("click", async function () {
    if (state.placing || !state.selectedAddressId) return;
    state.placing = true;
    els.placeOrder.setAttribute("aria-busy", "true");
    els.placeOrder.disabled = true;

    var res = await BuyOApi.post("/orders", {
      addressId: state.selectedAddressId,
      idempotencyKey: idempotencyKey()
    });

    state.placing = false;
    els.placeOrder.removeAttribute("aria-busy");
    els.placeOrder.disabled = false;

    if (res.ok || (res.data && res.data.idempotentReplay)) {
      clearIdempotencyKey();
      var order = res.data && res.data.order;
      if (order) {
        els.doneMeta.innerHTML =
          "Order <strong>" +
          CATALOG.esc(order.orderNumber || "#" + order.id) +
          "</strong> · Total <strong>" +
          CATALOG.formatPrice(order.grandTotal) +
          "</strong> · Cash on delivery";
      }
      setStep("done");
      try {
        document.dispatchEvent(new CustomEvent("buyo:cart-updated"));
      } catch (e) { /* degrade silently */ }
      if (res.data && res.data.idempotentReplay) {
        toast("This order was already placed — showing the confirmation again.", "info");
      }
      return;
    }

    toast(res.message || "Couldn't place the order.", "error");
    if (res.status === 401) show("guest");
  });

  // ---------- Boot ----------
  document.addEventListener("buyo:signed-out", function () {
    show("guest");
  });
  document.addEventListener("buyo:session-cleared", function () {
    show("guest");
  });

  (async function init() {
    if (!window.BuyOApi.getToken()) {
      show("guest");
      return;
    }
    var cart = await loadCart();
    if (!cart) return;
    await loadAddresses();
    setStep("info");
  })();
})();
