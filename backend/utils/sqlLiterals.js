// utils/sqlLiterals.js — dialect-aware raw SQL fragments for guarded stock math.
//
// Stock decrements/restocks keep the form "column = column ± qty" because the
// caller needs the AFFECTED-ROW count of a guarded UPDATE
// (WHERE stock >= qty => 0 rows lost the race => full rollback). Sequelize's
// model.increment() does not expose affected rows, so the arithmetic stays a
// sequelize.literal — quoted per dialect here:
//   mysql     -> `stock` - 2   (backticks)
//   postgres  -> "stock" - 2   (double quotes; backticks are a syntax error)
//
// `qty` is always a caller-validated positive integer (the controllers check
// Number.isInteger before calling) and is re-validated here as defense in
// depth, so no user-controlled string ever reaches the literal.
const { resolveDialect } = require("../config/dbConnectionOptions");

const OPERATORS = new Set(["+", "-"]);

function stockDelta(operator, qty, env = process.env) {
  if (!OPERATORS.has(operator)) {
    throw new Error(`Unsupported stock operator: ${operator}`);
  }
  const value = Number(qty);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Non-integer stock quantity: ${qty}`);
  }
  const column = resolveDialect(env) === "postgres" ? '"stock"' : "`stock`";
  return `${column} ${operator} ${value}`;
}

module.exports = { stockDelta };
