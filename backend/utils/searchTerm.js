// utils/searchTerm.js — shared free-text search normalisation.
//
// LIKE metacharacters are REMOVED rather than escaped: a literal `%`, `_` or
// `\` is never meaningful inside a product name, order number or email address,
// and removing them keeps the generated SQL identical on MySQL and PostgreSQL
// (Sequelize v6 has no portable LIKE-escape option).
//
// The returned term is only ever used as a bound/escaped value — never
// concatenated into raw SQL.

const MAX_TERM_LENGTH = 100;

function normalizeSearchTerm(raw) {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[\\%_]/g, "").trim().slice(0, MAX_TERM_LENGTH);
  return cleaned.length ? cleaned : null;
}

module.exports = { normalizeSearchTerm, MAX_TERM_LENGTH };
