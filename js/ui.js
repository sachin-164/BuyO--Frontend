// js/ui.js — BuyO UI helpers (Phase 7)
// Toast notifications + modal/drawer dialogs. Pure DOM helpers — no framework,
// no dependencies. Works alongside css/components.css classes.
(function (global) {
  "use strict";

  var TOAST_DEFAULT_MS = 4500;

  function ensureToastRegion() {
    var region = document.getElementById("buyo-toast-region");
    if (!region) {
      region = document.createElement("div");
      region.id = "buyo-toast-region";
      region.className = "ui-toast-region";
      // Polite live region: screen readers announce new toasts without
      // interrupting the current utterance.
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", "polite");
      document.body.appendChild(region);
    }
    return region;
  }

  // BuyOUi.toast(message, { type: "info" | "success" | "error", duration: ms })
  function toast(message, options) {
    options = options || {};
    var type = options.type || "info";
    var duration =
      typeof options.duration === "number" ? options.duration : TOAST_DEFAULT_MS;

    var region = ensureToastRegion();
    var el = document.createElement("div");
    el.className = "ui-toast" + (type !== "info" ? " ui-toast--" + type : "");

    var text = document.createElement("span");
    text.textContent = message; // textContent — never innerHTML
    el.appendChild(text);

    var close = document.createElement("button");
    close.type = "button";
    close.className = "ui-toast__close";
    close.setAttribute("aria-label", "Dismiss notification");
    close.textContent = "✕";
    el.appendChild(close);

    var timer = null;
    function dismiss() {
      if (timer) clearTimeout(timer);
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    close.addEventListener("click", dismiss);
    if (duration > 0) timer = setTimeout(dismiss, duration);

    region.appendChild(el);
    return { dismiss: dismiss };
  }

  // ---------- Modal / drawer ----------
  // Markup contract (see docs/design-system.md):
  //   <div class="ui-modal" data-ui-modal hidden>
  //     <div class="ui-modal__overlay" data-ui-modal-close></div>
  //     <div class="ui-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="...">
  //       ... <button data-ui-modal-close aria-label="Close">✕</button>
  //     </div>
  //   </div>
  var openStack = [];

  function focusableIn(root) {
    var selector = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])'
    ].join(",");
    return Array.prototype.filter.call(root.querySelectorAll(selector), function (
      node
    ) {
      return node.offsetWidth > 0 || node.offsetHeight > 0;
    });
  }

  function openModal(modal) {
    if (!modal || openStack.indexOf(modal) !== -1) return;
    var entry = {
      modal: modal,
      opener: document.activeElement,
      onKeydown: function (event) {
        if (event.key === "Escape") {
          event.stopPropagation();
          closeModal(modal);
          return;
        }
        if (event.key !== "Tab") return;
        // Simple focus trap: keep Tab inside the dialog while open.
        var focusable = focusableIn(modal.querySelector(".ui-modal__dialog"));
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
      }
    };
    openStack.push(entry);
    modal.hidden = false;
    document.addEventListener("keydown", entry.onKeydown, true);

    // Bind close controls once per element (repeated opens would otherwise
    // stack duplicate listeners).
    Array.prototype.forEach.call(
      modal.querySelectorAll("[data-ui-modal-close]"),
      function (node) {
        if (node.getAttribute("data-ui-close-bound") === "true") return;
        node.setAttribute("data-ui-close-bound", "true");
        node.addEventListener("click", function (event) {
          var host = event.currentTarget.closest("[data-ui-modal]");
          if (host) closeModal(host);
        });
      }
    );

    var dialog = modal.querySelector(".ui-modal__dialog");
    var focusable = dialog ? focusableIn(dialog) : [];
    (focusable[0] || dialog).focus();
  }

  // Binding helper so each open registers its own close listener correctly.
  // (Close controls are bound lazily in openModal — see above.)

  function closeModal(modal) {
    var index = -1;
    for (var i = 0; i < openStack.length; i++) {
      if (openStack[i].modal === modal) index = i;
    }
    if (index === -1) return;
    var entry = openStack.splice(index, 1)[0];
    document.removeEventListener("keydown", entry.onKeydown, true);
    modal.hidden = true;
    if (entry.opener && typeof entry.opener.focus === "function") {
      entry.opener.focus();
    }
  }

  function isModalOpen(modal) {
    return openStack.some(function (entry) {
      return entry.modal === modal;
    });
  }

  global.BuyOUi = { toast: toast, openModal: openModal, closeModal: closeModal, isModalOpen: isModalOpen };
})(window);
