// routes/addressRoutes.js — per-user address book (Phase 6)
// All routes require auth (JWT); addresses are always scoped to req.user.id.
const express = require("express");
const router = express.Router();
const {
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress
} = require("../controllers/addressController");
const { requireAuth } = require("../middleware/auth");
const { validateBody } = require("../middleware/validate");

// India-first formats (documented): PIN code 6 digits (first digit 1-9),
// phone 10-15 digits (optional leading +, spaces/hyphens tolerated + normalized).
function validatePincode(value) {
  return /^[1-9][0-9]{5}$/.test(value) ? null : "pincode must be a 6-digit Indian PIN code";
}
function validatePhone(value) {
  return /^\+?\d{10,15}$/.test(String(value).replace(/[\s-]/g, ""))
    ? null
    : "phone must be 10-15 digits (spaces, hyphens and a leading + are allowed)";
}

const fullNameRule = { type: "string", minLength: 2, maxLength: 100 };
const phoneRule = { type: "string", minLength: 10, maxLength: 20, validate: validatePhone };
const line1Rule = { type: "string", minLength: 3, maxLength: 255 };
const line2Rule = { type: "string", maxLength: 255 };
const cityRule = { type: "string", minLength: 2, maxLength: 100 };
const stateRule = { type: "string", minLength: 2, maxLength: 100 };
const pincodeRule = { type: "string", validate: validatePincode };
const labelRule = { type: "string", maxLength: 50 };
const isDefaultRule = { type: "boolean" };

const createAddressSchema = {
  fullName: { required: true, ...fullNameRule },
  phone: { required: true, ...phoneRule },
  line1: { required: true, ...line1Rule },
  line2: line2Rule,
  city: { required: true, ...cityRule },
  state: { required: true, ...stateRule },
  pincode: { required: true, ...pincodeRule },
  label: labelRule,
  isDefault: isDefaultRule
};

// Update: everything optional (rule objects copied — shared refs would strip `required`)
const updateAddressSchema = Object.fromEntries(
  Object.entries(createAddressSchema).map(([field, rules]) => [field, { ...rules }])
);
for (const field of ["fullName", "phone", "line1", "city", "state", "pincode"]) {
  delete updateAddressSchema[field].required;
}

router.use(requireAuth);

router.get("/", getAddresses);
router.post("/", validateBody(createAddressSchema), createAddress);
router.put("/:id/default", setDefaultAddress);
router.put("/:id", validateBody(updateAddressSchema), updateAddress);
router.delete("/:id", deleteAddress);

module.exports = router;
