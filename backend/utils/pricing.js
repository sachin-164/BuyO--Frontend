// utils/pricing.js
// Money + tax helpers shared by the cart and (later) checkout.
//
// RULES
// - Prices always come from the Products table (server-authoritative) — never
//   from client input or the stored name/price snapshots on cart rows.
// - Tax rates come from Categories.taxRate (configurable per category, e.g.
//   GST) and are applied per category group on the line totals.
// - All tax figures are PREVIEWS: totals are labelled as preview-only in API
//   responses; checkout will recompute totals server-side against live
//   prices/stock at order time.

// Rounds to 2 decimals (money), with a float-error guard.
function toMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

// lines: [{ unitPrice, qty, categoryId, categoryName, taxRate }]
// Returns { subtotal, tax: { total, byCategory, preview: true }, grandTotal }.
function buildTotals(lines) {
  let subtotal = 0;
  const groups = new Map();

  for (const line of lines) {
    const lineTotal = toMoney(toMoney(line.unitPrice) * line.qty);
    subtotal += lineTotal;

    const key = line.categoryId === null || line.categoryId === undefined ? "none" : String(line.categoryId);
    let group = groups.get(key);
    if (!group) {
      group = {
        categoryId: line.categoryId ?? null,
        categoryName: line.categoryName ?? null,
        taxRate: Number(line.taxRate) || 0,
        taxableAmount: 0
      };
      groups.set(key, group);
    }
    group.taxableAmount += lineTotal;
  }

  const byCategory = [...groups.values()].map((group) => ({
    categoryId: group.categoryId,
    categoryName: group.categoryName,
    taxRate: group.taxRate,
    taxableAmount: toMoney(group.taxableAmount),
    taxAmount: toMoney((toMoney(group.taxableAmount) * group.taxRate) / 100)
  }));

  subtotal = toMoney(subtotal);
  const taxTotal = toMoney(byCategory.reduce((sum, group) => sum + group.taxAmount, 0));

  return {
    subtotal,
    tax: { total: taxTotal, byCategory, preview: true },
    grandTotal: toMoney(subtotal + taxTotal)
  };
}

module.exports = { toMoney, buildTotals };
