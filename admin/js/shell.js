// admin/js/shell.js — BuyO admin chrome + database-backed authorization gate (Phase 10)
// Reference: design-references/admin_page.webp (sidebar nav, top bar, identity).
//
// Load order per page: config.js -> api.js -> ui.js -> catalog.js -> shell.js -> page.js.
//
// Authorization model (defence in depth):
//   1. EVERY admin API call is enforced server-side (requireAuth + requireAdmin:
//      fresh DB user reload, isVerified required, Users.role === "admin").
//   2. This shell re-checks on every page load via GET /api/auth/me and only
//      renders the chrome when the DATABASE says { isVerified: true, isAdmin: true }.
//      Nothing about admin status is read from localStorage or URL state.
//   3. Page scripts await BuyOShell.ready — no data fetch happens for a
//      non-admin, so manipulating state or URLs yields only the gate/denied card.
//
// Nav intentionally omits Customers / Analytics / Notifications / Settings and
// the reference's bell icon: the backend has no endpoints for them, and fake
// controls are forbidden (see Phase 10 report).
(function (global) {
  "use strict";

  if (!global.BuyOApi) return;

  /* ---------------- tiny helpers ---------------- */

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Inline SVG set (stroke icons matching the BuyO line-icon family).
  var PATHS = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    box: '<path d="M3 8l9-5 9 5v8l-9 5-9-5V8z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
    chevronRight: '<path d="M9 6l6 6-6 6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5L16.5 16.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    filter: '<path d="M4 5h16l-6 7v6l-4 2v-8L4 5z"/>',
    trash: '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    logout: '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="M15 8l4 4-4 4"/><path d="M19 12H9"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"/>',
    alert: '<path d="M12 4l9 16H3l9-16z"/><path d="M12 10v4M12 17.5v.5"/>'
  };

  function icon(name, size) {
    var px = size || 18;
    return (
      '<svg width="' + px + '" height="' + px + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' + (PATHS[name] || "") + "</svg>"
    );
  }

  /* ---------------- shared building blocks (used by page scripts) ---------------- */

  // Order status -> shared badge variant (same map the storefront profile uses).
  var STATUS_BADGE = {
    placed: "ui-badge--warning",
    confirmed: "ui-badge--neutral",
    shipped: "ui-badge--brand",
    delivered: "ui-badge--success",
    cancelled: "ui-badge--danger"
  };

  var STATUS_LABEL = {
    placed: "Placed",
    confirmed: "Confirmed",
    shipped: "Shipped",
    delivered: "Delivered",
    cancelled: "Cancelled"
  };

  function statusBadge(status) {
    var cls = STATUS_BADGE[status];
    if (!cls) return '<span class="ui-badge ui-badge--neutral">' + esc(status || "Unknown") + "</span>";
    return (
      '<span class="ui-badge ' + cls + '">' +
      esc(STATUS_LABEL[status] || status) +
      "</span>"
    );
  }

  // Server-authoritative status transitions (mirror of backend utils/orderStatus.js
  // ALLOWED_TRANSITIONS — DISPLAY ONLY; the server re-validates every change and
  // answers 409 for anything not allowed).
  var ALLOWED_TRANSITIONS = {
    placed: ["confirmed", "cancelled"],
    confirmed: ["shipped", "cancelled"],
    shipped: ["delivered"],
    delivered: [],
    cancelled: []
  };

  // Map a 400 validation payload ({ errors: ["field is required", ...] }) onto
  // the inline .ui-error element beside each input id. Returns the number of
  // messages that could not be matched (caller toasts those via res.message).
  function mapErrors(res, fieldIds) {
    var errors = res && res.data && res.data.errors;
    var unmatched = 0;
    (fieldIds || []).forEach(function (id) {
      var errEl = document.getElementById(id + "-error");
      if (errEl) errEl.textContent = "";
      var input = document.getElementById(id);
      if (input) input.removeAttribute("aria-invalid");
    });
    if (!Array.isArray(errors) || !errors.length) return 0;
    errors.forEach(function (msg) {
      var text = String(msg);
      var lower = text.toLowerCase();
      for (var i = 0; i < fieldIds.length; i++) {
        var id = fieldIds[i];
        // "name is required", "slug must be lowercase", "mrpPrice must be a number"
        if (lower.indexOf(id.toLowerCase()) === 0) {
          var errEl = document.getElementById(id + "-error");
          var input = document.getElementById(id);
          if (errEl) errEl.textContent = text;
          if (input) input.setAttribute("aria-invalid", "true");
          return;
        }
      }
      unmatched++;
    });
    return unmatched;
  }

  function clearErrors(fieldIds) {
    mapErrors(null, fieldIds);
  }

  // Fetch EVERY admin order for the active filter. The backend's
  // `pagination.total` counts joined rows (orders x items, no DISTINCT) — see
  // Phase 10 report finding P10-1 — so totals here are ALWAYS derived from the
  // de-duplicated rows we actually received, never from pagination fields.
  async function fetchAllOrders(status) {
    var all = [];
    var seen = {};
    var truncated = false;
    for (var page = 1; page <= 50; page++) {
      var path = "/admin/orders?limit=100&page=" + page + (status ? "&status=" + encodeURIComponent(status) : "");
      var res = await BuyOApi.get(path);
      if (!res.ok) {
        var err = new Error(res.message || "Could not load orders.");
        err.status = res.status;
        throw err;
      }
      var rows = (res.data && res.data.orders) || [];
      for (var i = 0; i < rows.length; i++) {
        var id = rows[i].id;
        if (seen[id]) continue; // defence against overlap between pages
        seen[id] = true;
        all.push(rows[i]);
      }
      var pagination = (res.data && res.data.pagination) || {};
      if (rows.length === 0 || !pagination.hasNext) break;
      if (page === 50) truncated = true;
    }
    return { orders: all, truncated: truncated };
  }

  // Shared pagination footer (reference: Previous / windowed pages / Next).
  // pageList() renders "1 2 3 … 8 9 10" style windows for large totals.
  function pageList(current, total) {
    var out = [];
    function push(n) { out.push(n); }
    if (total <= 7) {
      for (var i = 1; i <= total; i++) push(i);
      return out;
    }
    push(1);
    if (current > 3) out.push("…");
    var start = Math.max(2, current - 1);
    var end = Math.min(total - 1, current + 1);
    for (var j = start; j <= end; j++) push(j);
    if (current < total - 2) out.push("…");
    push(total);
    return out;
  }

  // opts: { page, totalPages, total, unit: "products"|"orders", onPage(page) }
  function renderPager(container, opts) {
    if (!container) return;
    var totalPages = Math.max(1, opts.totalPages || 1);
    var page = Math.min(Math.max(1, opts.page || 1), totalPages);
    var items = typeof opts.total === "number" ? opts.total : null;
    var unit = opts.unit || "items";

    var html = "";
    html += '<button type="button" class="ui-btn ui-btn--secondary ui-btn--sm" data-pager-prev' +
      (page <= 1 ? " disabled" : "") + ">" + icon("chevronLeft", 14) + " Previous</button>";
    html += '<div class="adm-pager__pages">';
    pageList(page, totalPages).forEach(function (entry) {
      if (entry === "…") {
        html += '<span class="adm-pager__ellipsis" aria-hidden="true">…</span>';
      } else {
        html += '<button type="button" class="adm-pager__page" data-pager-page="' + entry + '"' +
          (entry === page ? ' aria-current="page"' : "") +
          ' aria-label="Page ' + entry + '">' + entry + "</button>";
      }
    });
    html += "</div>";
    html += '<button type="button" class="ui-btn ui-btn--secondary ui-btn--sm" data-pager-next' +
      (page >= totalPages ? " disabled" : "") + ">Next " + icon("chevronRight", 14) + "</button>";
    container.className = "adm-pager";
    container.innerHTML = html;

    var info = document.createElement("span");
    info.className = "adm-pager__info";
    info.textContent = "Page " + page + " of " + totalPages +
      (items !== null ? " · " + items + " " + unit : "");
    container.querySelector(".adm-pager__pages").appendChild(info);

    var prev = container.querySelector("[data-pager-prev]");
    var next = container.querySelector("[data-pager-next]");
    if (prev) prev.addEventListener("click", function () { if (page > 1) opts.onPage(page - 1); });
    if (next) next.addEventListener("click", function () { if (page < totalPages) opts.onPage(page + 1); });
    Array.prototype.forEach.call(container.querySelectorAll("[data-pager-page]"), function (btn) {
      btn.addEventListener("click", function () {
        var target = parseInt(btn.getAttribute("data-pager-page"), 10);
        if (target !== page) opts.onPage(target);
      });
    });
  }

  /* ---------------- shell ---------------- */

  var app = document.querySelector("[data-adm-shell]");
  var sideSlot = app && app.querySelector("[data-adm-side]");
  var topSlot = app && app.querySelector("[data-adm-top]");
  var page = (app && app.getAttribute("data-page")) || "dashboard";
  var title = (app && app.getAttribute("data-title")) || "Dashboard";
  var wantsSearch = !!(app && app.getAttribute("data-search") === "true");
  var searchPlaceholder = (app && app.getAttribute("data-search-placeholder")) || "Search…";

  var els = {}; // hamburger, side, overlay, identity, menu

  document.title = title + " · BuyO Admin";

  function currentPageFile() {
    var file = (global.location.pathname.split("/").pop() || "dashboard.html");
    return /[A-Za-z0-9_-]+\.html$/.test(file) ? file : "dashboard.html";
  }

  function renderGate(kind) {
    if (!app) return;
    var cfg = {
      signin: {
        iconName: "user", denied: false,
        title: "Administrator sign-in required",
        text: "This area is restricted. Sign in with an administrator account to continue.",
        actions: '<a class="ui-btn ui-btn--primary" href="../login.html?next=admin/' + currentPageFile() + '">Sign in</a>' +
          '<a class="ui-btn ui-btn--secondary" href="../index.html">Back to storefront</a>'
      },
      expired: {
        iconName: "lock", denied: false,
        title: "Session expired",
        text: "Your sign-in is no longer valid. Sign in again with an administrator account.",
        actions: '<a class="ui-btn ui-btn--primary" href="../login.html?next=admin/' + currentPageFile() + '">Sign in again</a>' +
          '<a class="ui-btn ui-btn--secondary" href="../index.html">Back to storefront</a>'
      },
      error: {
        iconName: "alert", denied: false,
        title: "Couldn’t verify access",
        text: "We couldn’t reach the server to confirm your account. Please try again shortly.",
        actions: '<button type="button" class="ui-btn ui-btn--primary" data-gate-retry>Try again</button>' +
          '<a class="ui-btn ui-btn--secondary" href="../index.html">Back to storefront</a>'
      }
    }[kind] || {};

    app.innerHTML =
      '<div class="adm-gate" tabindex="-1" data-gate>' +
        '<div class="adm-gate__card">' +
          '<span class="adm-gate__icon' + (cfg.denied ? " adm-gate__icon--denied" : "") + '">' + icon(cfg.iconName || "user", 26) + "</span>" +
          '<h1 class="adm-gate__title">' + esc(cfg.title) + "</h1>" +
          '<p class="adm-gate__text">' + esc(cfg.text) + "</p>" +
          '<div class="adm-gate__actions">' + cfg.actions + "</div>" +
        "</div>" +
      "</div>";

    var retry = app.querySelector("[data-gate-retry]");
    if (retry) retry.addEventListener("click", function () { global.location.reload(); });
    var gate = app.querySelector("[data-gate]");
    if (gate) gate.focus();
  }

  function renderDenied(user) {
    if (!app) return;
    var unverified = user && user.isVerified !== true;
    app.innerHTML =
      '<div class="adm-gate" tabindex="-1" data-gate>' +
        '<div class="adm-gate__card">' +
          '<span class="adm-gate__icon adm-gate__icon--denied">' + icon(unverified ? "alert" : "lock", 26) + "</span>" +
          '<h1 class="adm-gate__title">' + (unverified ? "Email not verified" : "Admin privileges required") + "</h1>" +
          '<p class="adm-gate__text">' +
            (unverified
              ? "Your account must be verified before it can be used here. Check your inbox for the verification link."
              : "You’re signed in as a customer account, so the admin area stays locked. Admin access is granted server-side only.") +
          "</p>" +
          '<div class="adm-gate__actions">' +
            '<a class="ui-btn ui-btn--primary" href="../index.html">Back to storefront</a>' +
            '<button type="button" class="ui-btn ui-btn--secondary" data-gate-signout>Sign out</button>' +
          "</div>" +
        "</div>" +
      "</div>";
    var out = app.querySelector("[data-gate-signout]");
    if (out) out.addEventListener("click", doSignOut);
    var gate = app.querySelector("[data-gate]");
    if (gate) gate.focus();
  }

  function doSignOut() {
    BuyOApi.signOut();
    global.location.href = "../index.html";
  }

  function navLink(id, href, iconName, label) {
    var active = page === id;
    return (
      '<a class="adm-nav__item" href="' + href + '"' + (active ? ' aria-current="page"' : "") + ">" +
      icon(iconName, 18) + "<span>" + esc(label) + "</span></a>"
    );
  }

  function buildChrome(user) {
    if (!sideSlot || !topSlot) return;

    /* ----- sidebar (reference: logo, nav with expandable Products, logout) ----- */
    var productsActive = page === "products" || page === "categories";
    var groupExpanded = productsActive ? "true" : "true"; // reference shows it expanded

    sideSlot.outerHTML =
      '<aside class="adm-side" id="adm-side" aria-label="Admin navigation">' +
        '<a class="adm-brand" href="dashboard.html">' +
          '<span class="adm-brand__mark" aria-hidden="true">B</span>' +
          "<span>buyo<span class=\"adm-brand__dot\">!</span></span>" +
        "</a>" +
        '<nav class="adm-nav">' +
          navLink("dashboard", "dashboard.html", "dashboard", "Dashboard") +
          '<div class="adm-nav__group' + (productsActive ? " adm-nav__group--active" : "") + '">' +
            '<button type="button" class="adm-nav__item" data-group-toggle aria-expanded="' + groupExpanded + '" aria-controls="adm-nav-products">' +
              icon("box", 18) + "<span>Products</span>" +
              '<span class="adm-nav__chevron"' + (productsActive ? "" : "") + ">" + icon("chevron", 16) + "</span>" +
            "</button>" +
            '<div class="adm-nav__sub" id="adm-nav-products"' + (groupExpanded === "true" ? "" : " hidden") + ">" +
              navLink("products", "products.html", "box", "Product List") +
              navLink("categories", "categories.html", "box", "Categories") +
            "</div>" +
          "</div>" +
          navLink("orders", "orders.html", "receipt", "Orders") +
        "</nav>" +
        '<div class="adm-side__foot">' +
          '<button type="button" class="adm-nav__item adm-nav__item--danger" data-signout>' +
            icon("logout", 18) + "<span>Log out</span>" +
          "</button>" +
        "</div>" +
      "</aside>";

    els.side = document.getElementById("adm-side");

    /* ----- top bar (reference: title left; search + identity right) ----- */
    var initial = String((user && user.name) || "?").trim().charAt(0) || "?";
    topSlot.outerHTML =
      '<header class="adm-top">' +
        '<button type="button" class="adm-icon-btn adm-hamburger" data-hamburger aria-controls="adm-side" aria-expanded="false" aria-label="Open navigation menu">' +
          icon("menu", 20) +
        "</button>" +
        '<h1 class="adm-top__title" data-adm-title>' + esc(title) + "</h1>" +
        '<div class="adm-top__actions">' +
          (wantsSearch
            ? '<form class="adm-search" role="search" id="adm-search-form" data-adm-search>' +
                '<span class="adm-search__icon">' + icon("search", 16) + "</span>" +
                '<input class="adm-search__input" type="search" id="adm-search-input" placeholder="' + esc(searchPlaceholder) +
                '" aria-label="' + esc(searchPlaceholder.replace(/…$/, "")) + '" autocomplete="off">' +
              "</form>"
            : "") +
          '<div class="adm-identity" data-identity>' +
            '<button type="button" class="adm-identity__btn" data-identity-btn aria-haspopup="menu" aria-expanded="false">' +
              '<span class="adm-identity__avatar" aria-hidden="true">' + esc(initial) + "</span>" +
              '<span class="adm-identity__name">' + esc(String((user && user.name) || "").split(" ")[0] || "Admin") + "</span>" +
              icon("chevron", 14) +
            "</button>" +
            '<div class="adm-identity__menu" data-identity-menu role="menu" hidden>' +
              '<p class="adm-identity__menu-meta">' + esc((user && user.email) || "") + "</p>" +
              '<a class="adm-identity__menu-item" role="menuitem" href="../index.html">View storefront</a>' +
              '<button type="button" class="adm-identity__menu-item adm-identity__menu-item--danger" role="menuitem" data-signout>Sign out</button>' +
            "</div>" +
          "</div>" +
        "</div>" +
      "</header>";

    // overlay for the off-canvas sidebar (<=1024px)
    var overlay = document.createElement("button");
    overlay.type = "button";
    overlay.className = "adm-overlay";
    overlay.setAttribute("aria-label", "Close navigation menu");
    overlay.hidden = true;
    app.appendChild(overlay);
    els.overlay = overlay;

    wireChrome();
  }

  function closeSidebar(returnFocus) {
    if (!els.side) return;
    els.side.classList.remove("is-open");
    if (els.overlay) els.overlay.hidden = true;
    if (els.hamburger) {
      els.hamburger.setAttribute("aria-expanded", "false");
      if (returnFocus) els.hamburger.focus();
    }
  }

  function wireChrome() {
    /* hamburger / off-canvas */
    els.hamburger = document.querySelector("[data-hamburger]");
    if (els.hamburger) {
      els.hamburger.addEventListener("click", function () {
        var open = els.side.classList.toggle("is-open");
        els.hamburger.setAttribute("aria-expanded", open ? "true" : "false");
        if (els.overlay) els.overlay.hidden = !open;
        if (open) {
          var first = els.side.querySelector("a, button");
          if (first) first.focus();
        }
      });
    }
    if (els.overlay) {
      els.overlay.addEventListener("click", function () { closeSidebar(true); });
    }
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && els.side && els.side.classList.contains("is-open")) {
        closeSidebar(true);
      }
    });

    /* Products group expand/collapse */
    var groupToggle = document.querySelector("[data-group-toggle]");
    var groupSub = document.getElementById("adm-nav-products");
    if (groupToggle && groupSub) {
      groupToggle.addEventListener("click", function () {
        var expanded = groupToggle.getAttribute("aria-expanded") === "true";
        groupToggle.setAttribute("aria-expanded", expanded ? "false" : "true");
        groupSub.hidden = expanded;
      });
    }

    /* identity dropdown */
    var idBtn = document.querySelector("[data-identity-btn]");
    var idMenu = document.querySelector("[data-identity-menu]");
    if (idBtn && idMenu) {
      var idWrap = document.querySelector("[data-identity]");
      function closeMenu(focusBack) {
        idMenu.hidden = true;
        idBtn.setAttribute("aria-expanded", "false");
        if (focusBack) idBtn.focus();
      }
      idBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        var open = idMenu.hidden;
        idMenu.hidden = !open;
        idBtn.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) {
          var firstItem = idMenu.querySelector("a, button");
          if (firstItem) firstItem.focus();
        }
      });
      document.addEventListener("click", function (event) {
        if (!idMenu.hidden && idWrap && !idWrap.contains(event.target)) closeMenu(false);
      });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && !idMenu.hidden) closeMenu(true);
      });
    }

    /* sign-out buttons */
    Array.prototype.forEach.call(document.querySelectorAll("[data-signout]"), function (btn) {
      btn.addEventListener("click", doSignOut);
    });

    /* any 401 with a token anywhere on the page flips the shell to the gate */
    document.addEventListener("buyo:session-cleared", function () {
      renderGate("expired");
    });
  }

  /* ---------------- the gate ---------------- */

  var ready = (async function authorize() {
    if (!app) throw new Error("admin shell markup missing");

    if (!BuyOApi.getToken()) {
      renderGate("signin");
      throw new Error("admin gate: not signed in");
    }

    var res = await BuyOApi.get("/auth/me");
    if (res.status === 401) {
      renderGate("expired"); // api.js already cleared the bad session
      throw new Error("admin gate: session invalid");
    }
    if (!res.ok || !res.data) {
      renderGate("error");
      throw new Error("admin gate: could not verify access");
    }

    var user = res.data.user || res.data;
    if (user.isVerified !== true) {
      renderDenied(user);
      throw new Error("admin gate: account not verified");
    }
    if (user.isAdmin !== true) {
      renderDenied(user);
      throw new Error("admin gate: not an admin");
    }

    buildChrome(user);
    return user;
  })();

  // Page scripts do BuyOShell.ready.then(start) — keep rejection handled here.
  ready.catch(function () { /* gate/denied already rendered */ });

  global.BuyOShell = {
    ready: ready,
    icon: icon,
    esc: esc,
    statusBadge: statusBadge,
    STATUS_LABEL: STATUS_LABEL,
    ALLOWED_TRANSITIONS: ALLOWED_TRANSITIONS,
    mapErrors: mapErrors,
    clearErrors: clearErrors,
    fetchAllOrders: fetchAllOrders,
    renderPager: renderPager,
    setTitle: function (text) {
      title = text;
      document.title = text + " · BuyO Admin";
      var el = document.querySelector("[data-adm-title]");
      if (el) el.textContent = text;
    }
  };
})(window);
