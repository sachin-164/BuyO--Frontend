// admin/js/order-detail.js — single order view + status transitions (Phase 10)
// Endpoints: GET  /api/admin/orders/:id  (order + shippingAddress + statusEvents)
//            PUT  /api/admin/orders/:id/status  { status, note? }
// The transition buttons come from a CLIENT-SIDE MIRROR of the server's
// ALLOWED_TRANSITIONS (display only): the server re-validates every change and
// answers 409 for anything illegal (verified against the live API in the Phase
// 10 verification run — invalid moves and terminal states all 409).
(function () {
  "use strict";
  if (!window.BuyOShell || !window.BuyOApi) return;

  var C = window.BuyOCatalog;
  var U = window.BuyOUi;

  var ACTION_LABEL = {
    confirmed: "Confirm order",
    shipped: "Mark shipped",
    delivered: "Mark delivered",
    cancelled: "Cancel order"
  };
  var ACTION_VARIANT = {
    confirmed: "ui-btn--secondary",
    shipped: "ui-btn--secondary",
    delivered: "ui-btn--primary",
    cancelled: "ui-btn--danger"
  };

  var params = new URLSearchParams(window.location.search);
  var rawId = params.get("id");
  var orderId = /^\d+$/.test(rawId || "") ? rawId : null;
  var lastNote = ""; // survives the refresh after a rejected transition
  var currentStatus = null;
  var els = {};

  BuyOShell.ready.then(start).catch(function (err) {
    /* "admin gate: …" errors are expected — the shell already rendered the
       gate/denied card. Anything else is a real bug in this page. */
    if (err && String(err.message || err).indexOf("admin gate") === 0) return;
    if (window.BuyOUi) window.BuyOUi.toast("Something went wrong on this page.", { type: "error" });
    if (console && console.error) console.error("[admin/order-detail]", err);
  });

  /* ---------------- helpers ---------------- */

  function esc(v) { return C.esc(v); }

  function fmtDateTime(iso) {
    try {
      return new Date(iso).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (e) { return ""; }
  }

  function paymentLabel(method) {
    return method === "cod" ? "Cash on delivery" : method ? String(method).toUpperCase() : "—";
  }

  /* ---------------- states ---------------- */

  function skeleton() {
    return (
      '<section class="adm-card"><div class="adm-card__head">' +
        '<div class="ui-skeleton" style="height: 22px; width: 220px;"></div></div>' +
        '<div class="adm-card__body">' +
        '<div class="ui-skeleton" style="height: 14px; width: 60%; margin-bottom: 10px;"></div>' +
        '<div class="ui-skeleton" style="height: 14px; width: 40%;"></div></div></section>' +
      '<div class="adm-detail"><section class="adm-card"><div class="adm-card__body">' +
        '<div class="ui-skeleton" style="height: 16px; width: 70%; margin-bottom: 12px;"></div>' +
        '<div class="ui-skeleton" style="height: 16px; width: 55%; margin-bottom: 12px;"></div>' +
        '<div class="ui-skeleton" style="height: 16px; width: 65%;"></div>' +
      "</div></section></div>"
    );
  }

  function errorState(message) {
    return C.emptyState({
      icon: BuyOShell.icon("alert", 26),
      title: "Couldn’t load this order",
      text: message || "Something went wrong while loading the order.",
      action: '<button type="button" class="ui-btn ui-btn--primary" data-retry>Try again</button>'
    });
  }

  /* ---------------- render ---------------- */

  function itemsHtml(order) {
    var rows = (order.items || [])
      .map(function (item) {
        return (
          "<tr>" +
          "<td>" + esc(item.name) + "</td>" +
          '<td class="adm-num">' + esc(item.qty) + "</td>" +
          '<td class="adm-num">' + esc(C.formatPrice(item.unitPrice)) + "</td>" +
          '<td class="adm-num">' + esc(C.formatPrice(item.lineTotal)) + "</td>" +
          "</tr>"
        );
      })
      .join("");

    return (
      '<section class="adm-card" aria-labelledby="items-title">' +
        '<div class="adm-card__head"><h2 class="adm-card__title" id="items-title">Items</h2></div>' +
        '<div class="adm-table-wrap"><table class="adm-table">' +
          "<thead><tr><th>Product</th><th>Qty</th><th>Unit price</th><th>Line total</th></tr></thead>" +
          "<tbody>" + rows + "</tbody></table></div>" +
        '<div class="adm-card__body"><dl class="adm-kv">' +
          "<dt>Subtotal</dt><dd>" + esc(C.formatPrice(order.subtotal)) + "</dd>" +
          "<dt>Tax</dt><dd>" + esc(C.formatPrice(order.taxTotal)) + "</dd>" +
          "<dt>Order total</dt><dd><strong>" + esc(C.formatPrice(order.grandTotal)) + "</strong></dd>" +
        "</dl></div>" +
      "</section>"
    );
  }

  function customerHtml(order) {
    var user = order.user;
    var a = order.shippingAddress;
    var addressHtml = "—";
    if (a) {
      var lines = [
        esc(a.fullName || ""),
        esc([a.line1, a.line2].filter(Boolean).join(", ")),
        esc([a.city, a.state].filter(Boolean).join(", ")) + (a.pincode ? " " + esc(a.pincode) : ""),
        esc(a.phone || "")
      ].filter(Boolean);
      addressHtml = lines.join("<br>");
    }

    return (
      '<section class="adm-card" aria-labelledby="customer-title">' +
        '<div class="adm-card__head"><h2 class="adm-card__title" id="customer-title">Customer & delivery</h2></div>' +
        '<div class="adm-card__body"><dl class="adm-kv">' +
          "<dt>Name</dt><dd>" + esc((user && user.name) || "—") + "</dd>" +
          "<dt>Email</dt><dd>" + esc((user && user.email) || "—") + "</dd>" +
          "<dt>Payment</dt><dd>" + esc(paymentLabel(order.paymentMethod)) + "</dd>" +
          "<dt>Deliver to</dt><dd>" + addressHtml + "</dd>" +
        "</dl>" +
        (user ? "" : '<p class="adm-hint" style="margin-top: var(--space-3);">The customer account no longer exists; the order snapshot is preserved.</p>') +
      "</div>" +
      "</section>"
    );
  }

  function statusHtml(order) {
    var events = order.statusEvents || [];
    var timeline = events.length
      ? '<ul class="ui-timeline">' +
        events
          .map(function (event) {
            var label = BuyOShell.STATUS_LABEL[event.toStatus] || event.toStatus;
            return (
              "<li><span>" + esc(label) + (event.note ? " — " + esc(event.note) : "") + "</span>" +
              '<span class="ui-timeline__time">' + esc(fmtDateTime(event.createdAt || "")) + "</span></li>"
            );
          })
          .join("") +
        "</ul>"
      : '<p class="adm-status-closed">No status events recorded yet.</p>';

    var allowed = BuyOShell.ALLOWED_TRANSITIONS[order.status] || [];
    var actions;
    if (allowed.length) {
      var buttons = allowed
        .map(function (status) {
          return (
            '<button type="button" class="ui-btn ' + ACTION_VARIANT[status] + '" data-transition="' + status + '">' +
            esc(ACTION_LABEL[status]) +
            "</button>"
          );
        })
        .join("");
      actions =
        '<div class="ui-field" style="margin-top: var(--space-4);">' +
          '<label class="ui-label" for="status-note">Note <span style="font-weight: 400; color: var(--color-text-muted);">(optional — recorded in the history)</span></label>' +
          '<textarea class="ui-input" id="status-note" rows="2" maxlength="500" placeholder="e.g. Packed and handed to courier"></textarea>' +
        "</div>" +
        '<div class="adm-actions-row">' + buttons + "</div>";
    } else {
      actions =
        '<p class="adm-status-closed">This order is closed — no further status changes are available.</p>';
    }

    return (
      '<section class="adm-card adm-card--full" aria-labelledby="status-title">' +
        '<div class="adm-card__head"><h2 class="adm-card__title" id="status-title">Status & history</h2></div>' +
        '<div class="adm-card__body">' + timeline + actions + "</div>" +
      "</section>"
    );
  }

  function render(order) {
    currentStatus = order.status;
    BuyOShell.setTitle("Order " + order.orderNumber);
    els.host.innerHTML =
      '<section class="adm-card" aria-labelledby="order-title">' +
        '<div class="adm-card__head">' +
          '<h2 class="adm-card__title" id="order-title">' + esc(order.orderNumber) + "</h2>" +
          '<div class="adm-card__head-actions">' + BuyOShell.statusBadge(order.status) + "</div>" +
          '<p class="adm-card__subtitle">Placed ' + esc(fmtDateTime(order.createdAt)) +
            " · #" + esc(order.id) +
            " · " + ((order.items && order.items.length) || 0) +
            (((order.items && order.items.length) || 0) === 1 ? " item" : " items") + "</p>" +
        "</div>" +
        (order.notes ? '<p class="adm-note">Customer note: ' + esc(order.notes) + "</p>" : "") +
      "</section>" +
      '<div class="adm-detail">' + itemsHtml(order) + customerHtml(order) + statusHtml(order) + "</div>";

    // restore a note the admin was drafting when a transition was rejected
    var noteEl = document.getElementById("status-note");
    if (noteEl && lastNote) noteEl.value = lastNote;
  }

  /* ---------------- transitions ---------------- */

  async function performTransition(toStatus) {
    var noteEl = document.getElementById("status-note");
    var note = noteEl ? noteEl.value.trim() : "";
    lastNote = note;

    var buttons = document.querySelectorAll("[data-transition]");
    Array.prototype.forEach.call(buttons, function (b) { b.disabled = true; });

    var res = await BuyOApi.put(
      "/admin/orders/" + encodeURIComponent(orderId) + "/status",
      { status: toStatus, note: note || undefined }
    );

    if (res.status === 401 || res.status === 403) return;

    if (res.ok) {
      lastNote = "";
      U.toast(res.message || "Order status updated to " + (BuyOShell.STATUS_LABEL[toStatus] || toStatus) + ".", {
        type: "success"
      });
      load();
      return;
    }

    U.toast(res.message || "Could not update the status.", { type: "error" });
    if (res.status === 409) {
      // someone/something else moved this order — show the real current state
      load();
      return;
    }
    Array.prototype.forEach.call(buttons, function (b) { b.disabled = false; });
  }

  /* ---------------- data ---------------- */

  async function load() {
    if (!orderId) {
      els.host.innerHTML = errorState("This link is missing a valid order id.");
      return;
    }
    els.host.innerHTML = skeleton();

    var res = await BuyOApi.get("/admin/orders/" + encodeURIComponent(orderId));
    if (res.status === 401 || res.status === 403) return;
    if (!res.ok) {
      els.host.innerHTML = errorState(res.status === 404 ? "This order does not exist." : res.message);
      return;
    }
    render((res.data && res.data.order) || {});
  }

  /* ---------------- events (bound once; content is re-rendered) ---------------- */

  function bind() {
    els.host.addEventListener("click", function (event) {
      var retry = event.target.closest("[data-retry]");
      if (retry) { load(); return; }

      var btn = event.target.closest("[data-transition]");
      if (!btn || btn.disabled) return;
      var toStatus = btn.getAttribute("data-transition");

      if (toStatus === "cancelled" && btn.getAttribute("data-armed") !== "1") {
        Array.prototype.forEach.call(document.querySelectorAll('[data-armed="1"]'), function (other) {
          other.removeAttribute("data-armed");
          other.textContent = ACTION_LABEL[other.getAttribute("data-transition")] || other.textContent;
        });
        btn.setAttribute("data-armed", "1");
        btn.textContent = "Confirm cancellation?";
        setTimeout(function () {
          if (btn.getAttribute("data-armed") === "1") {
            btn.removeAttribute("data-armed");
            btn.textContent = ACTION_LABEL.cancelled;
          }
        }, 3000);
        return;
      }

      performTransition(toStatus);
    });

    els.host.addEventListener("input", function (event) {
      if (event.target && event.target.id === "status-note") lastNote = event.target.value;
    });
  }

  function start() {
    els.host = document.querySelector("[data-detail]");
    bind();
    load();
  }
})();
