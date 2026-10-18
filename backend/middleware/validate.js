// middleware/validate.js
// Small dependency-free request validation middleware.
//
// Usage:
//   validateBody({ email: { required: true, type: "email" }, ... })   -> req.body
//   validateQuery({ page: { type: "integer", min: 1 }, ... })         -> req.query
//
// Supported rules per field:
//   required   — value must be present and non-empty
//   type       — "string" | "email" | "password" | "number" | "integer"
//                | "boolean" | "object"
//                ("password" = raw string: never trimmed, byte-length capped;
//                 "email" = trimmed, lowercased, format-checked;
//                 "number" = coerced with Number(), NaN rejected;
//                 "integer" = number/number-string that must be a whole number;
//                 "boolean" = true/false or "true"/"false"/"1"/"0" -> boolean;
//                 "object" = plain JSON object, arrays rejected)
//   minLength / maxLength — for string/email/password
//   min / max             — for number/integer
//   nullable              — keep an explicit JSON null (e.g. clearing a FK)
//   validate              — custom check: (value) => error string | null
//
// On failure: 400 { success: false, message: "Validation failed", errors }.
// On success: the target (req.body or req.query) is REPLACED with only the
// schema-defined, sanitized fields (whitelist) — unknown fields are dropped.
// Sensitive values are never echoed back.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function makeValidator(target, schema) {
  return (req, res, next) => {
    const source = req[target] || {};
    const errors = [];
    const cleaned = {};

    for (const [field, rules] of Object.entries(schema)) {
      let value = source[field];

      const isEmptyString = typeof value === "string" && value.trim() === "";
      if (rules.required && (value === undefined || value === null || isEmptyString)) {
        errors.push(`${field} is required`);
        continue;
      }
      if (value === undefined) continue;
      if (value === null) {
        if (rules.nullable) cleaned[field] = null;
        continue;
      }
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
      } else if (rules.type === "number" || rules.type === "integer") {
        const num = typeof value === "number" ? value : Number(String(value).trim());
        if (!Number.isFinite(num) || (rules.type === "integer" && !Number.isInteger(num))) {
          errors.push(rules.type === "integer" ? `${field} must be an integer` : `${field} must be a number`);
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
      } else if (rules.type === "boolean") {
        if (typeof value === "boolean") {
          // keep as-is
        } else if (typeof value === "string") {
          const normalized = value.trim().toLowerCase();
          if (normalized === "true" || normalized === "1") value = true;
          else if (normalized === "false" || normalized === "0") value = false;
          else {
            errors.push(`${field} must be a boolean`);
            continue;
          }
        } else {
          errors.push(`${field} must be a boolean`);
          continue;
        }
      } else if (rules.type === "object") {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          errors.push(`${field} must be an object`);
          continue;
        }
      }

      if (typeof rules.validate === "function") {
        const customError = rules.validate(value);
        if (customError) {
          errors.push(customError);
          continue;
        }
      }

      cleaned[field] = value;
    }

    if (errors.length) {
      return res.status(400).json({ success: false, message: "Validation failed", errors });
    }

    // Whitelist: only schema-defined, validated fields survive. Unknown fields
    // (e.g. someone POSTing `role: "admin"` to signup) are dropped here.
    if (target === "query") {
      // Express defines req.query as a prototype getter — shadow it with the
      // validated object via an own data property (assignment would be ignored).
      Object.defineProperty(req, "query", {
        value: cleaned,
        writable: true,
        enumerable: true,
        configurable: true
      });
    } else {
      req.body = cleaned;
    }
    next();
  };
}

function validateBody(schema) {
  return makeValidator("body", schema);
}

function validateQuery(schema) {
  return makeValidator("query", schema);
}

module.exports = { validateBody, validateQuery };
