// js/layout.js — BuyO shared header/footer shell (Phase 7)
// Pages adopt the shell by adding placeholders and loading the scripts in this
// order: config.js -> api.js -> ui.js -> layout.js.
//
//   <a class="skip-link" href="#main">Skip to content</a>
//   <div data-buyo-header></div>
//   ... <main id="main"> ...
//   <div data-buyo-footer></div>
//
// Honesty rules baked in:
//   - Search submits to products.html?q=... which queries the REAL catalog API.
//   - The account control reflects the REAL auth state (token + GET /api/auth/me).
//   - No cart/wishlist count badges (cart isn't server-wired until Phase 9).
//   - Footer/nav only link to pages that exist and have content.
(function () {
  "use strict";

  // ---------- Inline SVG icons (no icon-font dependency) ----------
  var ICONS = {
    search:
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    cart:
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="20" r="1.6"/><circle cx="17" cy="20" r="1.6"/><path d="M3 4h2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h7.6a1.5 1.5 0 0 0 1.5-1.2L20 8H6"/></svg>',
    heart:
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.5-9.2-9C1.3 8 2.6 4.9 5.7 4.3c2-.4 3.9.6 4.8 2.1l.5.9.5-.9c.9-1.5 2.8-2.5 4.8-2.1 3.1.6 4.4 3.7 2.9 6.7C19 15.5 12 20 12 20Z"/></svg>',
    user:
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>',
    menu:
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    close:
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
    box:
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 7 9-4 9 4-9 4-9-4Z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/></svg>'
  };

  // Pages with real content that are safe to link from the shell. Stub pages
  // (about/services/contact/profile content) are deliberately excluded until
  // they have content — no links to empty experiences.
  var NAV_LINKS = [
    { href: "index.html", label: "Home" },
    { href: "products.html", label: "Products" },
    { href: "categories.html", label: "Categories" }
  ];

  var authState = { status: "guest", name: "" }; // guest | checking | authed

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[ch];
    });
  }

  function currentFile() {
    var path = window.location.pathname.split("/").pop();
    return path || "index.html";
  }

  function firstNameOf(fullName) {
    var first = String(fullName || "").trim().split(/\s+/)[0];
    return first || "there";
  }

  // ---------- Markup ----------
  function headerMarkup() {
    var file = currentFile();
    var navHtml = NAV_LINKS.map(function (link) {
      var current = link.href === file ? ' aria-current="page"' : "";
      return (
        '<a class="buyo-nav__link" href="' +
        link.href +
        '"' +
        current +
        ">" +
        link.label +
        "</a>"
      );
    }).join("");

    return (
      '<header class="buyo-header">' +
      '<div class="buyo-container buyo-header__bar">' +
      '<a class="buyo-logo" href="index.html">buyo<span class="buyo-logo__dot">!</span></a>' +
      '<form class="buyo-search" role="search" data-buyo-search>' +
      '<label class="visually-hidden" for="buyo-search-input">Search products</label>' +
      '<input class="buyo-search__input" id="buyo-search-input" type="search" name="q" placeholder="Search products&hellip;" autocomplete="off">' +
      '<button class="buyo-search__btn" type="submit" aria-label="Search">' +
      ICONS.search +
      "</button>" +
      "</form>" +
      '<nav class="buyo-nav" aria-label="Main">' +
      navHtml +
      "</nav>" +
      '<div class="buyo-header__actions">' +
      '<a class="buyo-icon-btn" href="cart.html" aria-label="Shopping cart">' +
      ICONS.cart +
      "</a>" +
      '<a class="buyo-icon-btn" href="wishlist.html" aria-label="Wishlist">' +
      ICONS.heart +
      "</a>" +
      '<div class="buyo-account" data-buyo-account>' +
      '<button class="buyo-account__toggle" type="button" aria-expanded="false" aria-haspopup="true" data-account-toggle>' +
      ICONS.user +
      '<span class="buyo-account__name" data-account-label>Login</span>' +
      "</button>" +
      '<div class="buyo-account__menu" hidden data-account-menu></div>' +
      "</div>" +
      '<button class="buyo-icon-btn buyo-icon-btn--menu" type="button" aria-label="Open menu" aria-expanded="false" data-drawer-open>' +
      ICONS.menu +
      "</button>" +
      "</div>" +
      "</div>" +
      "</header>" +
      // Mobile navigation drawer (hidden until the menu button is pressed).
      '<div class="buyo-nav-drawer" hidden data-buyo-drawer role="dialog" aria-modal="true" aria-label="Menu">' +
      '<div class="buyo-nav-drawer__overlay" data-drawer-close></div>' +
      '<div class="buyo-nav-drawer__panel">' +
      '<div class="buyo-nav-drawer__head">' +
      '<span class="buyo-nav-drawer__title">Menu</span>' +
      '<button class="buyo-icon-btn" type="button" aria-label="Close menu" data-drawer-close>' +
      ICONS.close +
      "</button>" +
      "</div>" +
      navHtml +
      '<div class="buyo-nav-drawer__divider"></div>' +
      '<div data-drawer-account></div>' +
      "</div>" +
      "</div>"
    );
  }

  function footerMarkup() {
    return (
      '<footer class="buyo-footer">' +
      '<div class="buyo-container buyo-footer__inner">' +
      "<div>" +
      '<div class="buyo-footer__brand">buyo<span class="buyo-logo__dot">!</span></div>' +
      '<p class="buyo-footer__blurb">Everyday essentials, delivered simply. Browse the catalog, keep a wishlist, and check out with cash on delivery.</p>' +
      "</div>" +
      "<div>" +
      '<h2 class="buyo-footer__heading">Shop</h2>' +
      '<ul class="buyo-footer__links">' +
      '<li><a class="buyo-footer__link" href="index.html">Home</a></li>' +
      '<li><a class="buyo-footer__link" href="products.html">Products</a></li>' +
      '<li><a class="buyo-footer__link" href="categories.html">Categories</a></li>' +
      "</ul>" +
      "</div>" +
      "<div>" +
      '<h2 class="buyo-footer__heading">Your account</h2>' +
      '<ul class="buyo-footer__links">' +
      '<li><a class="buyo-footer__link" href="cart.html">Cart</a></li>' +
      '<li><a class="buyo-footer__link" href="wishlist.html">Wishlist</a></li>' +
      '<li><a class="buyo-footer__link" href="login.html">Sign in</a></li>' +
      '<li><a class="buyo-footer__link" href="signup.html">Create account</a></li>' +
      "</ul>" +
      "</div>" +
      "</div>" +
      '<div class="buyo-container buyo-footer__bottom">' +
      "&copy; 2026 BuyO. Built locally, deployed when you say so." +
      "</div>" +
      "</footer>"
    );
  }

  // ---------- Account state ----------
  function accountMenuItems() {
    if (authState.status === "authed") {
      return (
        '<a class="buyo-account__menu-item" href="profile.html">My profile</a>' +
        '<div class="buyo-account__divider"></div>' +
        '<button class="buyo-account__menu-item" type="button" data-sign-out>Sign out</button>'
      );
    }
    return (
      '<a class="buyo-account__menu-item buyo-account__menu-item--brand" href="login.html">Login</a>' +
      '<a class="buyo-account__menu-item" href="signup.html">Create account</a>'
    );
  }

  function renderAccount() {
    var label = document.querySelector("[data-account-label]");
    var menu = document.querySelector("[data-account-menu]");
    var drawerAccount = document.querySelector("[data-drawer-account]");
    if (label) {
      label.textContent =
        authState.status === "authed" ? "Hi, " + firstNameOf(authState.name) : "Login";
    }
    if (menu) menu.innerHTML = accountMenuItems();
    if (drawerAccount) {
      drawerAccount.innerHTML =
        '<a class="buyo-nav-drawer__link" href="cart.html">Cart</a>' +
        '<a class="buyo-nav-drawer__link" href="wishlist.html">Wishlist</a>' +
        '<div class="buyo-nav-drawer__divider"></div>' +
        accountMenuItems().replace(/buyo-account__menu-item/g, "buyo-nav-drawer__link");
    }
  }

  // Validate the stored token against the REAL backend. If it is rejected the
  // api client clears the session and fires "buyo:session-cleared"; we simply
  // re-render (no redirect — redirects are the caller's explicit choice).
  function syncAuthState() {
    if (!window.BuyOApi || !BuyOApi.getToken()) {
      authState = { status: "guest", name: "" };
      renderAccount();
      return;
    }
    BuyOApi.get("/auth/me")
      .then(function (res) {
        if (res.ok && res.data && res.data.user) {
          authState = { status: "authed", name: res.data.user.name || "" };
        } else if (!res.ok && res.status === 401) {
          // Session already cleared by the api client.
          authState = { status: "guest", name: "" };
        } else {
          // Server/network problem: keep optimistic authed state so we don't
          // flash a logged-out UI at a legitimately logged-in user.
          authState = { status: "authed", name: authState.name || "" };
        }
        renderAccount();
      })
      .catch(function () {
        renderAccount();
      });
  }

  // ---------- Behaviour wiring ----------
  function wireSearch(root) {
    var form = root.querySelector("[data-buyo-search]");
    if (!form) return;
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var input = form.querySelector('input[name="q"]');
      var q = (input && input.value ? input.value : "").trim();
      // Real search: products.html reads ?q= and queries GET /api/products?q=
      window.location.href = q
        ? "products.html?q=" + encodeURIComponent(q)
        : "products.html";
    });
  }

  function wireAccount(root) {
    var toggle = root.querySelector("[data-account-toggle]");
    var menu = root.querySelector("[data-account-menu]");
    if (!toggle || !menu) return;

    function closeMenu() {
      menu.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    }

    toggle.addEventListener("click", function () {
      var willOpen = menu.hidden;
      menu.hidden = !willOpen;
      toggle.setAttribute("aria-expanded", String(willOpen));
      if (willOpen) {
        var first = menu.querySelector("a, button");
        if (first) first.focus();
      }
    });

    document.addEventListener("click", function (event) {
      if (!menu.hidden && !menu.contains(event.target) && !toggle.contains(event.target)) {
        closeMenu();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !menu.hidden) {
        closeMenu();
        toggle.focus();
      }
    });

    menu.addEventListener("click", function (event) {
      var target = event.target.closest("[data-sign-out]");
      if (!target) return;
      window.BuyOApi.signOut(); // clears session, fires "buyo:signed-out"
    });
  }

  function wireDrawer(root) {
    var drawer = root.querySelector("[data-buyo-drawer]");
    var openBtn = root.querySelector("[data-drawer-open]");
    if (!drawer || !openBtn) return;
    var closeBtns = drawer.querySelectorAll("[data-drawer-close]");

    function openDrawer() {
      drawer.hidden = false;
      openBtn.setAttribute("aria-expanded", "true");
      var firstLink = drawer.querySelector(".buyo-nav-drawer__panel a, .buyo-nav-drawer__panel button");
      if (firstLink) firstLink.focus();
    }

    function closeDrawer() {
      if (drawer.hidden) return;
      drawer.hidden = true;
      openBtn.setAttribute("aria-expanded", "false");
      openBtn.focus();
    }

    openBtn.addEventListener("click", openDrawer);
    Array.prototype.forEach.call(closeBtns, function (btn) {
      btn.addEventListener("click", closeDrawer);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeDrawer();
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth >= 1024) closeDrawer(); // desktop nav takes over
    });
    // Keep Tab inside the drawer while it is open (aria-modal contract).
    drawer.addEventListener("keydown", function (event) {
      if (event.key !== "Tab" || drawer.hidden) return;
      var focusable = drawer.querySelectorAll('a[href], button:not([disabled])');
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  // ---------- Boot ----------
  function mount() {
    var headerHost = document.querySelector("[data-buyo-header]");
    if (headerHost) {
      headerHost.innerHTML = headerMarkup();
      wireSearch(headerHost);
      wireAccount(headerHost);
      wireDrawer(headerHost);
      syncAuthState();
    }

    var footerHost = document.querySelector("[data-buyo-footer]");
    if (footerHost) footerHost.innerHTML = footerMarkup();

    // React to session lifecycle events from the api client.
    document.addEventListener("buyo:session-cleared", function () {
      authState = { status: "guest", name: "" };
      renderAccount();
      if (window.BuyOUi) {
        BuyOUi.toast("Your session has expired. Please sign in again.", {
          type: "error"
        });
      }
    });

    document.addEventListener("buyo:signed-out", function () {
      authState = { status: "guest", name: "" };
      renderAccount();
      var menu = document.querySelector("[data-account-menu]");
      var toggle = document.querySelector("[data-account-toggle]");
      if (menu) menu.hidden = true;
      if (toggle) toggle.setAttribute("aria-expanded", "false");
      if (window.BuyOUi) BuyOUi.toast("Signed out.", { type: "success" });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
