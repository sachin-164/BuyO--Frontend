// admin/js/orders.js — admin order list (Phase 10)
// Endpoints: GET /api/admin/orders?status=&page=&limit=100 (requireAdmin).
//
// Why client-side pagination: the admin orders query eager-loads items and
// counts JOINED rows in pagination.total (no DISTINCT), so server page maths
// can invent phantom pages (report finding P10-1). We fetch the matching set
// to completion (100/page, de-duplicated, capped at 50 pages with an honest
// "+" note) and paginate the REAL rows here. Row data and status filters are
// entirely server-provided.
(function () {
  "use strict";
  if (!window.BuyOShell || !window.BuyOApi) return;

  var C = window.BuyOCatalog;

  var PAGE_SIZE = 10; // reference table shows ~10 rows per page
  var state = { filter: "", page: 1, all: [], truncated: false };
  var els = {};

  BuyOShell.ready.then(start).catch(function (err) {
    /* "admin gate: …" errors are expected — the shell already rendered the
       gate/denied card. Anything else is a real bug in this page. */
    if (err && String(err.message || err).indexOf("admin gate") === 0) return;
    if (window.BuyOUi) window.BuyOUi.toast("Something went wrong on this page.", { type: "error" });
    if (console && console.error) console.error("[admin/orders]", err);
  });

  function esc(v) { return C.esc(v); }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
      });
    } catch (e) { return ""; }
  }

  function fmtTime(iso) {
    try {
      return new Date(iso).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (e) { return ""; }
  }

  /* ---------------- render ---------------- */

  function skeleton() {
    var rows = "";
    for (var i = 0; i < 6; i++) {
      rows +=
        "<tr>" +
        '<td><div class="ui-skeleton" style="height: 16px; width: 130px;"></div></td>' +
        '<td><div class="ui-skeleton" style="height: 16px; width: 110px;"></div></td>' +
        '<td><div class="ui-skeleton" style="height: 14px; width: 90px;"></div></td>' +
        '<td><div class="ui-skeleton" style="height: 14px; width: 30px;"></div></td>' +
        '<td><div class="ui-skeleton" style="height: 14px; width: 70px;"></div></td>' +
        '<td><div class="ui-skeleton" style="height: 18px; width: 84px;"></div></td>' +
        '<td><div class="ui-skeleton" style="height: 14px; width: 60px;"></div></td>' +
        "</tr>";
    }
    return '<div class="adm-table-wrap"><table class="adm-table">' + head() + "<tbody>" + rows + "</tbody></table></div>";
  }

  function head() {
    return (
      "<thead><tr>" +
      '<th scope="col">Order</th>' +
      '<th scope="col">Customer</th>' +
      '<th scope="col">Date</th>' +
      '<th scope="col">Items</th>' +
      '<th scope="col">Total</th>' +
      '<th scope="col">Status</th>' +
      '<th scope="col">Action</th>' +
      "</tr></thead>"
    );
  }

  function rowHtml(order) {
    var user = order.user || {};
    return (
      "<tr>" +
      '<td class="adm-num"><strong>' + esc(order.orderNumber) + "</strong>" +
        '<span class="adm-cell-sub">#' + esc(order.id) + "</span></td>" +
      "<td>" + esc(user.name || "—") +
        (user.email ? '<span class="adm-cell-sub">' + esc(user.email) + "</span>" : "") +
      "</td>" +
      '<td class="adm-num">' + esc(fmtDate(order.createdAt)) +
        '<span class="adm-cell-sub">' + esc(fmtTime(order.createdAt)) + "</span></td>" +
      '<td class="adm-num">' + ((order.items && order.items.length) || 0) + "</td>" +
      '<td class="adm-num">' + esc(C.formatPrice(order.grandTotal)) + "</td>" +
      "<td>" + BuyOShell.statusBadge(order.status) + "</td>" +
      '<td><div class="adm-actions">' +
        '<a class="adm-link" href="order-detail.html?id=' + encodeURIComponent(order.id) + '">Details</a>' +
      "</div></td>" +
      "</tr>"
    );
  }

  function emptyHtml() {
    if (state.filter) {
      var label = BuyOShell.STATUS_LABEL[state.filter] || state.filter;
      return C.emptyState({
        title: "No " + label.toLowerCase() + " orders",
        text: "No orders currently have this status.",
        action: '<button type="button" class="ui-btn ui-btn--secondary" data-show-all>Show all orders</button>'
      });
    }
    return C.emptyState({
      title: "No orders yet",
      text: "Orders placed by customers will appear here with their full status history."
    });
  }

  function render() {
    var total = state.all.length;
    var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;

    if (!total) {
      els.table.innerHTML = emptyHtml();
      els.pager.innerHTML = "";
      els.count.textContent = state.filter ? "No matching orders" : "No orders yet";
      return;
    }

    var slice = state.all.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
    els.table.innerHTML =
      '<div class="adm-table-wrap"><table class="adm-table">' + head() +
      "<tbody>" + slice.map(rowHtml).join("") + "</tbody></table></div>";

    els.count.textContent =
      total + (total === 1 ? " order" : " orders") +
      (state.filter ? " · " + (BuyOShell.STATUS_LABEL[state.filter] || state.filter) : " · all statuses") +
      (state.truncated ? " · showing the first 5,000" : "");

    BuyOShell.renderPager(els.pager, {
      page: state.page,
      totalPages: totalPages,
      total: total,
      unit: "orders",
      onPage: goPage
    });
  }

  function goPage(page) {
    state.page = page;
    render();
    var card = document.querySelector(".adm-card");
    if (card) {
      var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      card.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
  }

  async function load() {
    els.table.innerHTML = skeleton();
    els.pager.innerHTML = "";
    els.count.textContent = "Loading orders…";

    var result;
    try {
      result = await BuyOShell.fetchAllOrders(state.filter || null);
    } catch (err) {
      if (err && (err.status === 401 || err.status === 403)) return;
      els.table.innerHTML = C.emptyState({
        icon: BuyOShell.icon("alert", 26),
        title: "Couldn’t load orders",
        text: (err && err.message) || "Something went wrong.",
        action: '<button type="button" class="ui-btn ui-btn--primary" data-retry>Try again</button>'
      });
      els.count.textContent = "Orders unavailable";
      return;
    }
    state.all = result.orders;
    state.truncated = result.truncated;
    render();
  }

  /* ---------------- events ---------------- */

  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll(".adm-filter-chip"), function (chip) {
      chip.addEventListener("click", function () {
        if (state.filter === (chip.getAttribute("data-status") || "")) return;
        Array.prototype.forEach.call(document.querySelectorAll(".adm-filter-chip"), function (other) {
          other.setAttribute("aria-pressed", other === chip ? "true" : "false");
        });
        state.filter = chip.getAttribute("data-status") || "";
        state.page = 1;
        load();
      });
    });

    document.getElementById("main").addEventListener("click", function (event) {
      if (event.target.closest("[data-show-all]")) {
        var allChip = document.querySelector('.adm-filter-chip[data-status=""]');
        if (allChip) allChip.click();
        return;
      }
      if (event.target.closest("[data-retry]")) load();
    });
  }

  function start() {
    els.table = document.querySelector("[data-table]");
    els.pager = document.querySelector("[data-pager]");
    els.count = document.querySelector("[data-count]");
    bind();
    load();
  }
})();
