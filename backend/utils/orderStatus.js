// utils/orderStatus.js
// Order lifecycle shared by models, controllers and validation.
// Linear Phase 6 lifecycle; delivered/cancelled are terminal. The history
// table intentionally has NO uniqueness on (orderId, toStatus) — duplicate
// protection (e.g. double-cancel/restock) comes from the locked order row +
// these validated transitions + a single transaction — so the schema stays
// able to represent future legitimate repeated statuses (returns flows etc.).

const STATUS_VALUES = ["placed", "confirmed", "shipped", "delivered", "cancelled"];
const TERMINAL_STATUSES = ["delivered", "cancelled"];

const ALLOWED_TRANSITIONS = {
  placed: ["confirmed", "cancelled"],
  confirmed: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: []
};

module.exports = { STATUS_VALUES, TERMINAL_STATUSES, ALLOWED_TRANSITIONS };
