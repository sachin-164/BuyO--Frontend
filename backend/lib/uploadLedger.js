// lib/uploadLedger.js — in-memory single-use upload-authorization ledger
// (Phase 12).
//
// When an admin calls POST /api/uploads/authorize, the server records the
// validated facts of ONE pending upload (object path, admin id, authorized
// mimetype + size, expiry). The product create/update handler only accepts an
// image that carries such an entry: take() is atomic and single-use, so a
// path can never be replayed, reused by another admin, or used after expiry.
//
// LIMITATION (documented, same class as the in-memory rate limiter): state is
// per-process. Works for single-instance deployments and local dev; a
// multi-instance deployment needs a shared store before cutover.
"use strict";

const DEFAULT_MAX_ENTRIES = 500;

class UploadLedger {
  constructor({ maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  get size() {
    return this.entries.size;
  }

  _prune(now) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  // Returns { status: "ok" | "full", expiresAt? }. "full" refuses new
  // authorizations instead of growing without bound.
  put(objectPath, { adminId, mimetype, size, ttlMs, now = Date.now() }) {
    this._prune(now);
    if (!this.entries.has(objectPath) && this.entries.size >= this.maxEntries) {
      return { status: "full" };
    }
    const expiresAt = now + ttlMs;
    this.entries.set(objectPath, { adminId, mimetype, size, expiresAt });
    return { status: "ok", expiresAt };
  }

  // Atomic single-use consumption. The entry is removed on EVERY take, even
  // when rejected (expired / wrong admin) — a failed attempt can never leave a
  // reusable credential behind.
  take(objectPath, adminId, now = Date.now()) {
    const entry = this.entries.get(objectPath);
    if (!entry) return { status: "missing" };
    this.entries.delete(objectPath);
    if (entry.expiresAt <= now) return { status: "expired" };
    if (entry.adminId !== adminId) return { status: "forbidden", entry };
    return { status: "ok", entry };
  }

  clear() {
    this.entries.clear();
  }
}

// Process-wide ledger (see LIMITATION above). Tests may .clear() it directly.
const uploadLedger = new UploadLedger();

module.exports = { UploadLedger, uploadLedger };
