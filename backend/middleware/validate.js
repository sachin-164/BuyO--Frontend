// middleware/validate.js
// Small dependency-free request-body validation middleware.
//
// Usage: validateBody({ email: { required: true, type: "email" }, ... })
//
// Supported rules per field:
//   required   — value must be present and non-empty
//   type       — "string" | "email" | "password" | "number"
//                ("password" = raw string: never trimmed, byte-length capped;
//                 "email" = trimmed, lowercased, format-checked;
//                 "number" = coerced with Number(), NaN rejected)
//   minLength / maxLength — for string/email/password
//   min / max             — for number
//
// On failure: 400 { success: false, message: "Validation failed", errors }.
// On success: field values are sanitized (trim/lowercase/coerce) and req.body
// is REPLACED with only the schema-defined fields (whitelist) — unknown fields
// are dropped. Sensitive values are never echoed back.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateBody(schema) {
  return (req, res, next) => {
    const body = req.body || {};
    const errors = [];
    const cleaned = {};

    for (const [field, rules] of Object.entries(schema)) {
      let value = body[field];

      const isEmptyString = typeof value === "string" && value.trim() === "";
      if (rules.required && (value === undefined || value === null || isEmptyString)) {
        errors.push(`${field} is required`);
        continue;
      }
      if (value === undefined || value === null) continue;
      if (value === "") {
        // Optional string fields keep "" (preserves existing API behavior);
        // any other type treats "" as absent.
        if (rules.type === "string" || rules.type === "email") cleaned[field] = "";
        continue;
      }

      if (rules.type === "string" || rules.type === "email") {
        if (typeof value !== "string") {
          errors.push(`${field} must be a string`);
          continue;
        }
        value = value.trim();
        if (rules.minLength && value.length < rules.minLength) {
          errors.push(`${field} must be at least ${rules.minLength} characters`);
          continue;
        }
        if (rules.maxLength && value.length > rules.maxLength) {
          errors.push(`${field} must be at most ${rules.maxLength} characters`);
          continue;
        }
        if (rules.type === "email") {
          value = value.toLowerCase();
          if (value.length > 254 || !EMAIL_RE.test(value)) {
            errors.push(`${field} must be a valid email address`);
            continue;
          }
        }
      } else if (rules.type === "password") {
        if (typeof value !== "string") {
          errors.push(`${field} must be a string`);
          continue;
        }
        if (rules.minLength && value.length < rules.minLength) {
          errors.push(`${field} must be at least ${rules.minLength} characters`);
          continue;
        }
        if (rules.maxLength && value.length > rules.maxLength) {
          errors.push(`${field} must be at most ${rules.maxLength} characters`);
          continue;
        }
        if (Buffer.byteLength(value, "utf8") > 72) {
          errors.push(`${field} is too long (max 72 bytes)`);
          continue;
        }
      } else if (rules.type === "number") {
        const num = typeof value === "number" ? value : Number(String(value).trim());
        if (!Number.isFinite(num)) {
          errors.push(`${field} must be a number`);
          continue;
        }
        if (rules.min !== undefined && num < rules.min) {
          errors.push(`${field} must be at least ${rules.min}`);
          continue;
        }
        if (rules.max !== undefined && num > rules.max) {
          errors.push(`${field} must be at most ${rules.max}`);
          continue;
        }
        value = num;
      }

      cleaned[field] = value;
    }

    if (errors.length) {
      return res.status(400).json({ success: false, message: "Validation failed", errors });
    }

    // Whitelist: only schema-defined, validated fields survive. Unknown fields
    // (e.g. someone POSTing `role: "admin"` to signup) are dropped here.
    req.body = cleaned;
    next();
  };
}

module.exports = { validateBody };
