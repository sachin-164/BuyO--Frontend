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

// ---------- Order totals (Phase 6) ----------
// Same rules as buildTotals (tax-exclusive, per-category, round-half-up to
// 2dp), plus per-line tax amounts with penny allocation: the last line of
// each category group absorbs the ±0.01 rounding difference so that
// SUM(OrderItems.taxAmount) always equals the order's taxTotal exactly.
function buildOrderTotals(lines) {
  const totals = buildTotals(lines);
  const groupTaxByCategory = new Map(
    totals.tax.byCategory.map((group) => [group.categoryId === null ? "none" : String(group.categoryId), group.taxAmount])
  );

  const provisional = lines.map((line) => {
    const lineTotal = toMoney(toMoney(line.unitPrice) * line.qty);
    const taxRate = Number(line.taxRate) || 0;
    return { ...line, lineTotal, taxRate, lineTax: toMoney((lineTotal * taxRate) / 100) };
  });

  const groups = new Map();
  for (const row of provisional) {
    const key = row.categoryId === null || row.categoryId === undefined ? "none" : String(row.categoryId);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const [key, rows] of groups) {
    const target = groupTaxByCategory.get(key) || 0;
    const sum = toMoney(rows.reduce((acc, row) => acc + row.lineTax, 0));
    const diff = toMoney(target - sum);
    if (diff !== 0) {
      const last = rows[rows.length - 1];
      last.lineTax = toMoney(last.lineTax + diff);
    }
  }

  return {
    subtotal: totals.subtotal,
    taxTotal: totals.tax.total,
    grandTotal: totals.grandTotal,
    taxBreakdown: totals.tax.byCategory,
    lines: provisional.map((row) => ({
      unitPrice: toMoney(row.unitPrice),
      qty: row.qty,
      lineTotal: row.lineTotal,
      taxRate: row.taxRate,
      taxAmount: row.lineTax,
      categoryId: row.categoryId ?? null,
      categoryName: row.categoryName ?? null
    }))
  };
}

module.exports = { toMoney, buildTotals, buildOrderTotals };
