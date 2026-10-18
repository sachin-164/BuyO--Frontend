// utils/uniqueErrors.js
// Maps Sequelize unique-constraint errors to safe, client-facing 409 messages.
// Works whether the unique index was created by a migration
// (uq_products_slug, uq_categories_name) or by Sequelize sync (slug, name).
function uniqueConflictMessage(error, entityLabel) {
  if (!error || error.name !== "SequelizeUniqueConstraintError") return null;
  const fields = Object.keys(error.fields || {});
  if (fields.some((field) => /slug/i.test(field))) {
    return `A ${entityLabel} with that slug already exists`;
  }
  if (fields.some((field) => /name/i.test(field))) {
    return `A ${entityLabel} with that name already exists`;
  }
  return `A ${entityLabel} with those unique values already exists`;
}

module.exports = { uniqueConflictMessage };
