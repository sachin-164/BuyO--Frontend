// js/profile.js — customer account area (Phase 9)
// Reference: design-references/profile.png (sidebar nav + content cards).
// Real API surface only:
//   GET    /api/auth/me        -> profile card (name, email, verified, role)
//   GET    /api/orders         -> order list (page 1, newest first)
//   GET    /api/orders/:id     -> detail (address + status timeline), lazy
//   GET    /api/addresses      -> address book
//   POST   /api/addresses      -> add     (modal form)
//   PUT    /api/addresses/:id  -> edit
//   PUT    /api/addresses/:id/default -> set default
//   DELETE /api/addresses/:id  -> remove (two-step confirm, no dialog)
// Tabs are real buttons with ARIA tab semantics; ?tab=orders deep-links
// (used by the checkout confirmation).
(function () {
  "use strict";

  var CATALOG = window.BuyOCatalog;
  if (!CATALOG || !window.BuyOApi) return;

  var TAB_TITLES = {
    profile: "Profile Details",
    orders: "My Orders",
    addresses: "Address Book"
  };

  var els = {
    title: document.getElementById("account-title"),
    guest: document.getElementById("profile-guest"),
    body: document.getElementById("profile-body"),
    avatar: document.getElementById("profile-avatar"),
    name: document.getElementById("profile-name"),
    email: document.getElementById("profile-email"),
    meta: document.getElementById("profile-meta"),
    stats: document.getElementById("profile-stats"),
    orders: document.getElementById("orders-list"),
    addresses: document.getElementById("addresses-list"),
    tabs: document.querySelectorAll("[data-tab]"),
    panels: {
      profile: document.getElementById("panel-profile"),
      orders: document.getElementById("panel-orders"),
      addresses: document.getElementById("panel-addresses")
    },
    signout: document.getElementById("signout-btn"),
    addBtn: document.getElementById("add-address-btn"),
    modal: document.getElementById("address-modal"),
    form: document.getElementById("address-form"),
    modalTitle: document.getElementById("address-modal-title"),
    saveBtn: document.getElementById("save-address-btn")
  };

  var state = { tab: "profile", addresses: [], orders: [], ordersTotal: null };

  // Counter tiles — only shown once real counts are known.
  function renderStats() {
    if (!els.stats) return;
    var parts = [];
    if (state.ordersTotal !== null) {
      parts.push(
        '<div class="ui-stat-card"><div class="ui-stat-card__value">' +
        state.ordersTotal + "</div>" +
        '<div class="ui-stat-card__label">' +
        (state.ordersTotal === 1 ? "Order placed" : "Orders placed") +
        "</div></div>"
      );
    }
    if (state.addresses.length || state.ordersTotal !== null) {
      parts.push(
        '<div class="ui-stat-card"><div class="ui-stat-card__value">' +
        state.addresses.length + "</div>" +
        '<div class="ui-stat-card__label">' +
        (state.addresses.length === 1 ? "Saved address" : "Saved addresses") +
        "</div></div>"
      );
    }
    els.stats.innerHTML = parts.join("");
    els.stats.hidden = !parts.length;
  }

  function toast(message, type) {
    if (window.BuyOUi) BuyOUi.toast(message, { type: type || "info" });
  }

  function show(view) {
    els.guest.hidden = view !== "guest";
    els.body.hidden = view !== "body";
  }

  function esc(value) {
    return CATALOG.esc(value);
  }

  // ---------- Tabs ----------
  function setTab(name) {
    if (!TAB_TITLES[name]) name = "profile";
    state.tab = name;
    Object.keys(els.panels).forEach(function (key) {
      var panel = els.panels[key];
      if (panel) panel.hidden = key !== name;
    });
    Array.prototype.forEach.call(els.tabs, function (tab) {
      tab.setAttribute("aria-selected", tab.getAttribute("data-tab") === name ? "true" : "false");
    });
    els.title.textContent = TAB_TITLES[name];
    document.title = TAB_TITLES[name] + " — BuyO";
    try {
      var url = name === "profile" ? location.pathname : location.pathname + "?tab=" + name;
      history.replaceState(null, "", url);
    } catch (e) { /* file:// or denied — visual state still applied */ }
  }

  Array.prototype.forEach.call(els.tabs, function (tab) {
    tab.addEventListener("click", function () {
      setTab(tab.getAttribute("data-tab"));
    });
    // Roving focus across the tablist (left/right arrows).
    tab.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      var list = Array.prototype.slice.call(els.tabs);
      var index = list.indexOf(tab);
      var next = event.key === "ArrowRight" ? index + 1 : index - 1;
      if (next < 0) next = list.length - 1;
      if (next >= list.length) next = 0;
      list[next].focus();
      setTab(list[next].getAttribute("data-tab"));
      event.preventDefault();
    });
  });

  // ---------- Profile card ----------
  function renderUser(user) {
    var initial = String(user.name || "?").trim().charAt(0).toUpperCase() || "?";
    els.avatar.textContent = initial;
    els.name.textContent = user.name || "BuyO shopper";
    els.email.textContent = user.email || "";

    var badges = "";
    if (user.isVerified) {
      badges += '<span class="ui-badge ui-badge--success">Email verified</span>';
    } else {
      badges += '<span class="ui-badge ui-badge--warning">Email not verified</span>';
    }
    var isAdmin = user.isAdmin === true || user.role === "admin";
    badges += isAdmin
      ? '<span class="ui-badge ui-badge--brand">Admin</span>'
      : '<span class="ui-badge ui-badge--neutral">Customer</span>';
    els.meta.innerHTML = badges;
  }

  // ---------- Orders ----------
  function statusBadge(status) {
    var map = {
      placed: "ui-badge--warning",
      confirmed: "ui-badge--neutral",
      shipped: "ui-badge--brand",
      delivered: "ui-badge--success",
      cancelled: "ui-badge--danger"
    };
    var label = { placed: "Placed", confirmed: "Confirmed", shipped: "Shipped",
                  delivered: "Delivered", cancelled: "Cancelled" }[status] || status;
    return '<span class="ui-badge ' + (map[status] || "ui-badge--neutral") + '">' + esc(label) + "</span>";
  }

  function paymentLabel(method) {
    var value = String(method || "").toLowerCase();
    if (value.indexOf("cod") !== -1 || value.indexOf("cash") !== -1) return "Cash on delivery";
    return method ? esc(method) : "—";
  }

  function formatDate(value) {
    if (!value) return "";
    try {
      return new Date(value).toLocaleDateString(undefined, {
        year: "numeric", month: "short", day: "numeric"
      });
    } catch (e) {
      return "";
    }
  }

  function renderOrdersSkeleton() {
    els.orders.innerHTML =
      '<div class="ui-order-card"><div class="ui-skeleton" style="height:16px;width:40%;"></div>' +
      '<div class="ui-skeleton" style="height:14px;width:70%;margin-top:10px;"></div>' +
      '<div class="ui-skeleton" style="height:14px;width:55%;margin-top:8px;"></div></div>' +
      '<div class="ui-order-card"><div class="ui-skeleton" style="height:16px;width:45%;"></div>' +
      '<div class="ui-skeleton" style="height:14px;width:65%;margin-top:10px;"></div></div>';
  }

  function renderOrders() {
    if (!state.orders.length) {
      els.orders.innerHTML = CATALOG.emptyState({
        title: "No orders yet",
        text: "When you place an order it shows up here with live status updates.",
        action: '<a class="ui-btn ui-btn--primary" href="products.html">Browse the catalog</a>'
      });
      return;
    }
    els.orders.innerHTML = state.orders
      .map(function (order) {
        var items = (order.items || [])
          .map(function (item) {
            return (
              "<li><span><strong>" + esc(item.name) + "</strong> × " + item.qty + "</span>" +
              "<span>" + CATALOG.formatPrice(item.lineTotal) + "</span></li>"
            );
          })
          .join("");
        return (
          '<article class="ui-order-card" data-order-id="' + order.id + '">' +
          '<div class="ui-order-card__head">' +
          '<span class="ui-order-card__number">' + esc(order.orderNumber || "Order #" + order.id) + "</span>" +
          '<span class="ui-order-card__date">' + formatDate(order.createdAt) + "</span>" +
          statusBadge(order.status) +
          "</div>" +
          '<dl class="ui-order-card__grid">' +
          "<div><dt>Total</dt><dd>" + CATALOG.formatPrice(order.grandTotal) + "</dd></div>" +
          "<div><dt>Payment</dt><dd>" + paymentLabel(order.paymentMethod) + "</dd></div>" +
          "<div><dt>Items</dt><dd>" + (order.items || []).length + "</dd></div>" +
          "</dl>" +
          '<ul class="ui-order-card__items">' + items + "</ul>" +
          "<details><summary>Delivery address &amp; activity</summary>" +
          '<div class="ui-order-card__detail" data-detail hidden>' +
          '<p class="ui-skeleton" style="height:14px;width:70%;margin-top:10px;"></p>' +
          "</div></details>" +
          "</article>"
        );
      })
      .join("");
  }

  // Lazy-load GET /api/orders/:id the first time the <details> opens — the
  // list payload doesn't carry shippingAddress/statusEvents.
  function loadOrderDetail(cardEl) {
    var detail = cardEl.querySelector("[data-detail]");
    if (!detail || detail.getAttribute("data-loaded") === "1") return;
    detail.setAttribute("data-loaded", "1");
    detail.hidden = false;

    BuyOApi.get("/orders/" + cardEl.getAttribute("data-order-id")).then(function (res) {
      if (!res.ok) {
        detail.removeAttribute("data-loaded");
        detail.innerHTML =
          '<p class="ui-address-card__text">Couldn\'t load the details: ' +
          esc(res.message || "please try again") + "</p>";
        return;
      }
      var order = res.data && res.data.order;
      if (!order) {
        detail.innerHTML = '<p class="ui-address-card__text">No details available.</p>';
        return;
      }

      var addressHtml = "";
      if (order.shippingAddress) {
        var a = order.shippingAddress;
        addressHtml =
          '<p class="ui-address-card__name" style="margin-top: var(--space-3);">' + esc(a.fullName) + "</p>" +
          '<p class="ui-address-card__text">' +
          esc([a.line1, a.line2, a.city + " " + a.pincode, a.state].filter(Boolean).join(", ")) +
          "<br>" + esc(a.phone) + "</p>";
      }

      var timeline = "";
      if (order.statusEvents && order.statusEvents.length) {
        timeline =
          '<ul class="ui-timeline">' +
          order.statusEvents
            .map(function (event) {
              return (
                "<li><span>" + esc(event.toStatus) + (event.note ? " — " + esc(event.note) : "") + "</span>" +
                '<span class="ui-timeline__time">' + formatDate(event.createdAt || "") + "</span></li>"
              );
            })
            .join("") +
          "</ul>";
      }

      detail.innerHTML =
        addressHtml +
        (timeline
          ? '<p class="ui-address-card__name" style="margin-top: var(--space-3);">Activity</p>' + timeline
          : '<p class="ui-address-card__text" style="margin-top: var(--space-3);">No status updates yet.</p>');
    });
  }

  els.orders.addEventListener("toggle", function (event) {
    var details = event.target;
    if (details && details.tagName === "DETAILS" && details.open) {
      var card = details.closest("[data-order-id]");
      if (card) loadOrderDetail(card);
    }
  }, true);

  // ---------- Addresses ----------
  function addressText(a) {
    return esc(
      [a.line1, a.line2, a.city + " " + a.pincode, a.state].filter(Boolean).join(", ")
    ) + "<br>" + esc(a.phone);
  }

  function renderAddresses() {
    if (!state.addresses.length) {
      els.addresses.style.display = "block";
      els.addresses.innerHTML = CATALOG.emptyState({
        title: "No saved addresses",
        text: "Add a delivery address to speed through checkout.",
        action:
          '<button class="ui-btn ui-btn--primary" type="button" id="empty-add-address">Add address</button>'
      });
      var emptyAdd = document.getElementById("empty-add-address");
      if (emptyAdd) emptyAdd.addEventListener("click", openAddModal);
      return;
    }
    els.addresses.style.display = "";
    els.addresses.innerHTML = state.addresses
      .map(function (a) {
        return (
          '<div class="ui-address-card" data-address-id="' + a.id + '" style="cursor: default; flex-direction: column; align-items: stretch;">' +
          '<div>' +
          '<span class="ui-address-card__name">' + esc(a.fullName) + "</span>" +
          (a.label ? ' <span class="ui-badge ui-badge--neutral">' + esc(a.label) + "</span>" : "") +
          '<span class="ui-address-card__text">' + addressText(a) + "</span>" +
          (a.isDefault
            ? '<span class="ui-address-card__badges"><span class="ui-badge ui-badge--neutral">Default</span></span>'
            : "") +
          "</div>" +
          '<div class="ui-address-card__actions">' +
          '<button class="ui-btn ui-btn--ghost ui-btn--sm" type="button" data-edit>Edit</button>' +
          (a.isDefault
            ? ""
            : '<button class="ui-btn ui-btn--ghost ui-btn--sm" type="button" data-default>Set default</button>') +
          '<button class="ui-btn ui-btn--ghost ui-btn--sm" type="button" data-delete aria-label="Delete address of ' +
          esc(a.fullName) + '">Delete</button>' +
          "</div></div>"
        );
      })
      .join("");
  }

  function refreshAddresses() {
    return BuyOApi.get("/addresses").then(function (res) {
      if (res.status === 401) {
        show("guest");
        return;
      }
      if (!res.ok) {
        els.addresses.innerHTML = CATALOG.emptyState({
          title: "Couldn't load your addresses",
          text: res.message || "Please try again.",
          action: '<button class="ui-btn ui-btn--primary" type="button" onclick="location.reload()">Try again</button>'
        });
        return;
      }
      state.addresses = (res.data && res.data.addresses) || [];
      renderAddresses();
      renderStats();
    });
  }

  // ---------- Address modal (add / edit) ----------
  var FIELD_NAMES = ["fullName", "phone", "line1", "city", "state", "pincode"];

  function fieldError(name, message) {
    var el = els.form.querySelector('[data-error-for="' + name + '"]');
    var input = els.form.elements[name];
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
    FIELD_NAMES.forEach(function (name) { fieldError(name, ""); });
  }

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

  function openAddModal() {
    els.form.reset();
    els.form.elements.id.value = "";
    clearFormErrors();
    els.modalTitle.textContent = "Add new address";
    if (window.BuyOUi) BuyOUi.openModal(els.modal);
  }

  function openEditModal(address) {
    els.form.reset();
    els.form.elements.id.value = address.id;
    els.form.elements.fullName.value = address.fullName || "";
    els.form.elements.phone.value = address.phone || "";
    els.form.elements.line1.value = address.line1 || "";
    els.form.elements.line2.value = address.line2 || "";
    els.form.elements.city.value = address.city || "";
    els.form.elements.state.value = address.state || "";
    els.form.elements.pincode.value = address.pincode || "";
    els.form.elements.label.value = address.label || "";
    els.form.elements.isDefault.checked = !!address.isDefault;
    clearFormErrors();
    els.modalTitle.textContent = "Edit address";
    if (window.BuyOUi) BuyOUi.openModal(els.modal);
  }

  if (els.addBtn && els.modal && els.form) {
    els.addBtn.addEventListener("click", openAddModal);

    els.form.addEventListener("submit", async function (event) {
      event.preventDefault();
      clearFormErrors();

      var form = els.form.elements;
      var id = form.id.value;
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
        names.forEach(function (name) { fieldError(name, clientErrors[name]); });
        var first = els.form.elements[names[0]];
        if (first) first.focus();
        return;
      }

      els.saveBtn.setAttribute("aria-busy", "true");
      els.saveBtn.disabled = true;
      var res = id
        ? await BuyOApi.put("/addresses/" + id, payload)
        : await BuyOApi.post("/addresses", payload);
      els.saveBtn.removeAttribute("aria-busy");
      els.saveBtn.disabled = false;

      if (!res.ok) {
        var serverErrors = (res.data && res.data.errors) || [];
        var mapped = false;
        if (Array.isArray(serverErrors)) {
          serverErrors.forEach(function (entry) {
            var text = String(entry);
            for (var i = 0; i < FIELD_NAMES.length; i++) {
              if (text.indexOf(FIELD_NAMES[i]) === 0) {
                fieldError(FIELD_NAMES[i], text);
                mapped = true;
                break;
              }
            }
          });
        }
        if (!mapped) toast(res.message || "Couldn't save the address.", "error");
        return;
      }

      if (window.BuyOUi) BuyOUi.closeModal(els.modal);
      toast((res.data && res.data.message) || "Address saved.", "success");
      await refreshAddresses();
    });

    els.form.addEventListener("input", function (event) {
      var name = event.target && event.target.name;
      if (name) fieldError(name, "");
    });
  } /* end modal guard */

  // ---------- Address card actions ----------
  els.addresses.addEventListener("click", async function (event) {
    var card = event.target.closest("[data-address-id]");
    if (!card) return;
    var id = card.getAttribute("data-address-id");
    var address = state.addresses.find(function (a) { return String(a.id) === id; });
    if (!address) return;

    if (event.target.closest("[data-edit]")) {
      openEditModal(address);
      return;
    }

    if (event.target.closest("[data-default]")) {
      var resDefault = await BuyOApi.put("/addresses/" + id + "/default");
      if (resDefault.ok) {
        toast((resDefault.data && resDefault.data.message) || "Default address updated.", "success");
        await refreshAddresses();
      } else {
        toast(resDefault.message || "Couldn't update the default address.", "error");
      }
      return;
    }

    var deleteBtn = event.target.closest("[data-delete]");
    if (deleteBtn) {
      // Two-step confirm (no native dialogs): first arm, second act.
      if (deleteBtn.getAttribute("data-armed") !== "1") {
        deleteBtn.setAttribute("data-armed", "1");
        deleteBtn.textContent = "Confirm?";
        deleteBtn.classList.add("ui-btn--accent");
        setTimeout(function () {
          deleteBtn.removeAttribute("data-armed");
          deleteBtn.textContent = "Delete";
          deleteBtn.classList.remove("ui-btn--accent");
        }, 3000);
        return;
      }
      var resDelete = await BuyOApi.del("/addresses/" + id);
      if (resDelete.ok) {
        toast((resDelete.data && resDelete.data.message) || "Address deleted.", "success");
        await refreshAddresses();
      } else {
        toast(resDelete.message || "Couldn't delete the address.", "error");
      }
    }
  });

  // ---------- Sign out ----------
  if (els.signout) {
    els.signout.addEventListener("click", function () {
      window.BuyOApi.signOut(); // clears session, fires "buyo:signed-out"
      window.location.href = "index.html";
    });
  }

  document.addEventListener("buyo:signed-out", function () { show("guest"); });
  document.addEventListener("buyo:session-cleared", function () { show("guest"); });

  // ---------- Boot ----------
  async function loadOrders() {
    renderOrdersSkeleton();
    var res = await BuyOApi.get("/orders?limit=20");
    if (res.ok) {
      state.orders = (res.data && res.data.orders) || [];
      // Real order count: the orders list COUNT includes eager-joined item
      // rows (backend finding P10-1), so pagination.total can overstate —
      // count unique orders across pages instead (capped honestly with "+").
      state.ordersTotal = state.orders.length;
      var pagination = res.data && res.data.pagination;
      if (pagination && pagination.hasNext) {
        var seen = {};
        state.orders.forEach(function (order) { seen[order.id] = true; });
        var count = state.orders.length;
        var capped = false;
        for (var page = 2; page <= 10; page++) {
          var more = await BuyOApi.get("/orders?limit=20&page=" + page);
          if (!more.ok) break;
          var rows = (more.data && more.data.orders) || [];
          for (var i = 0; i < rows.length; i++) {
            if (seen[rows[i].id]) continue;
            seen[rows[i].id] = true;
            count++;
          }
          var next = more.data && more.data.pagination;
          if (!rows.length || !next || !next.hasNext) break;
          if (page === 10) capped = true;
        }
        state.ordersTotal = capped ? count + "+" : count;
      }
      renderOrders();
      renderStats();
      return;
    }
    els.orders.innerHTML = CATALOG.emptyState({
      title: "Couldn't load your orders",
      text: res.message || "Please try again.",
      action: '<button class="ui-btn ui-btn--primary" type="button" id="orders-retry">Try again</button>'
    });
    var retry = document.getElementById("orders-retry");
    if (retry) retry.addEventListener("click", loadOrders);
  }

  (async function init() {
    if (!window.BuyOApi.getToken()) {
      show("guest");
      return;
    }

    var wantedTab = "profile";
    try {
      var param = new URLSearchParams(location.search).get("tab");
      if (param && TAB_TITLES[param]) wantedTab = param;
    } catch (e) { /* keep default */ }
    setTab(wantedTab);
    show("body");

    var meRes = await BuyOApi.get("/auth/me", { auth: "required" });
    if (meRes.status === 401) {
      show("guest");
      return;
    }
    if (meRes.ok && meRes.data && meRes.data.user) renderUser(meRes.data.user);
    else if (meRes.ok && meRes.data && meRes.data.name) renderUser(meRes.data);
    else {
      els.name.textContent = "BuyO shopper";
      els.avatar.textContent = "?";
      els.meta.innerHTML = "";
    }

    await Promise.all([loadOrders(), refreshAddresses()]);
  })();
})();
