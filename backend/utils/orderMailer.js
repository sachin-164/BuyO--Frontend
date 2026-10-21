// utils/orderMailer.js — order lifecycle notifications.
//
// RULES
//  - Nothing here invents policy: no delivery promise, no tracking number, no
//    return window, no refund timeline. Only facts stored on the order.
//  - Sending happens AFTER the database transaction commits, and failures are
//    logged and swallowed. A broken SMTP server must never roll back an order
//    or turn a successful status change into a 500.
//  - Only the subject line and the two bodies are composed here; delivery and
//    capture-mode behaviour live in utils/mailer.js.
const { sendMail } = require("./mailer");

const STATUS_LABELS = {
  placed: "Placed",
  confirmed: "Confirmed",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled"
};

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inr(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `₹${amount.toFixed(2)}` : "—";
}

/** Absolute link to the order in the SPA, or null when FRONTEND_URL is unset. */
function orderLink(orderId) {
  const base = process.env.FRONTEND_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/orders/${orderId}`;
}

function addressLines(address) {
  if (!address) return [];
  const cityLine = [address.city, address.state, address.pincode].filter(Boolean).join(", ");
  return [address.fullName, address.line1, address.line2, cityLine, address.phone].filter(Boolean);
}

function itemsTableHtml(order) {
  const rows = (order.items || [])
    .map(
      (item) => `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${escapeHtml(item.name)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${item.qty}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${inr(item.lineTotal)}</td>
      </tr>`
    )
    .join("");
  return `<table style="width:100%;border-collapse:collapse;font-size:14px">
    <thead>
      <tr>
        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #d1d5db">Item</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #d1d5db">Qty</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #d1d5db">Line total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function itemsText(order) {
  return (order.items || [])
    .map((item) => `- ${item.name} x${item.qty} — INR ${Number(item.lineTotal).toFixed(2)}`)
    .join("\n");
}

function totalsText(order) {
  return [
    `Subtotal: INR ${Number(order.subtotal).toFixed(2)}`,
    `Tax: INR ${Number(order.taxTotal).toFixed(2)}`,
    `Total: INR ${Number(order.grandTotal).toFixed(2)}`,
    "Payment method: Cash on Delivery"
  ].join("\n");
}

function totalsHtml(order) {
  return `<p style="margin:12px 0 0">
    Subtotal: ${inr(order.subtotal)}<br />
    Tax: ${inr(order.taxTotal)}<br />
    <strong>Total: ${inr(order.grandTotal)}</strong><br />
    Payment method: Cash on Delivery
  </p>`;
}

function footnoteHtml(order) {
  const link = orderLink(order.id);
  return link
    ? `<p style="margin-top:16px"><a href="${escapeHtml(link)}">View order ${escapeHtml(order.orderNumber)}</a></p>`
    : "";
}

function footnotetext(order) {
  const link = orderLink(order.id);
  return link ? `\nView order: ${link}\n` : "";
}

function buildPlacedMessage(order, user) {
  const lines = addressLines(order.shippingAddress);
  const subject = `Order ${order.orderNumber} received`;
  const text = [
    `Hi ${user.name},`,
    "",
    `We received your order ${order.orderNumber} on ${new Date(order.createdAt).toUTCString()}.`,
    "",
    itemsText(order),
    "",
    totalsText(order),
    "",
    "Shipping address:",
    ...lines,
    "",
    "You will receive another email whenever the order status changes.",
    footnotetext(order)
  ].join("\n");

  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:14px;color:#111827">
    <p>Hi ${escapeHtml(user.name)},</p>
    <p>We received your order <strong>${escapeHtml(order.orderNumber)}</strong> on ${escapeHtml(
      new Date(order.createdAt).toUTCString()
    )}.</p>
    ${itemsTableHtml(order)}
    ${totalsHtml(order)}
    <p style="margin-top:16px"><strong>Shipping address</strong><br />${lines
      .map(escapeHtml)
      .join("<br />")}</p>
    <p>You will receive another email whenever the order status changes.</p>
    ${footnoteHtml(order)}
  </div>`;

  return { subject, text, html };
}

const STATUS_SENTENCE = {
  confirmed: "Your order has been confirmed.",
  shipped: "Your order has been marked as shipped.",
  delivered: "Your order has been marked as delivered.",
  cancelled:
    "Your order has been cancelled and the items were returned to stock. This order was Cash on Delivery, so no payment was collected."
};

function buildStatusMessage(order, user, previousStatus, nextStatus) {
  const label = STATUS_LABELS[nextStatus] || nextStatus;
  const sentence =
    STATUS_SENTENCE[nextStatus] ||
    `Your order status changed from ${STATUS_LABELS[previousStatus] || previousStatus} to ${label}.`;
  const subject = `Order ${order.orderNumber} is now ${label.toLowerCase()}`;

  const text = [
    `Hi ${user.name},`,
    "",
    sentence,
    "",
    `Order: ${order.orderNumber}`,
    `Previous status: ${STATUS_LABELS[previousStatus] || previousStatus}`,
    `New status: ${label}`,
    footnotetext(order)
  ].join("\n");

  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:14px;color:#111827">
    <p>Hi ${escapeHtml(user.name)},</p>
    <p>${escapeHtml(sentence)}</p>
    <p>
      Order: <strong>${escapeHtml(order.orderNumber)}</strong><br />
      Previous status: ${escapeHtml(STATUS_LABELS[previousStatus] || previousStatus)}<br />
      New status: <strong>${escapeHtml(label)}</strong>
    </p>
    ${footnoteHtml(order)}
  </div>`;

  return { subject, text, html };
}

async function deliver(message, to, context) {
  try {
    if (!to) return false;
    await sendMail({ from: process.env.EMAIL_USER, to, ...message });
    return true;
  } catch (err) {
    // Never propagate: notification failure must not change the order outcome.
    console.error(`[order-mail] ${context} failed:`, err && err.message ? err.message : err);
    return false;
  }
}

/** Sent once, only for a newly created order (never for an idempotent replay). */
function notifyOrderPlaced(order, user) {
  return deliver(buildPlacedMessage(order, user), user && user.email, `placed ${order.orderNumber}`);
}

/** Sent after each committed status change (admin update or customer cancel). */
function notifyOrderStatus(order, user, previousStatus, nextStatus) {
  return deliver(
    buildStatusMessage(order, user, previousStatus, nextStatus),
    user && user.email,
    `status ${order.orderNumber} ${previousStatus}->${nextStatus}`
  );
}

module.exports = { notifyOrderPlaced, notifyOrderStatus, buildPlacedMessage, buildStatusMessage };
