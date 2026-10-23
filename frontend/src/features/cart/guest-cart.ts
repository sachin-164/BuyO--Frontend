import type { CartItem, CartResponse, CartTaxGroup, CartTotals } from "@/types/commerce";
import type { Product, ProductVariant } from "@/types/catalog";

/**
 * Guest cart — the browser is the store until the shopper signs in.
 *
 * The shape deliberately mirrors the server's CartItem/CartTotals so the cart
 * page, header badge and product actions do not need a second rendering path.
 * Nothing here is authoritative: totals are a preview computed from the
 * product/variant snapshot, and the server recomputes everything at
 * merge/checkout.
 *
 * Identity is (productId, variantId), exactly like the server. Legacy lines
 * saved before variants existed have no variantId and are normalised to NULL,
 * so an existing browser cart keeps working.
 */

export const GUEST_CART_KEY = "buyo.guestCart.v1";
const MAX_LINE_QTY = 99;
const MAX_LINES = 50;

export interface GuestCartLine {
  productId: number;
  variantId: number | null;
  variantSku: string | null;
  variantSize: string | null;
  variantColor: string | null;
  qty: number;
  name: string;
  unitPrice: number;
  image: string | null;
  stock: number;
  categoryId: number | null;
  categoryName: string | null;
  taxRate: number;
}

function toMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function lineKey(productId: number, variantId: number | null) {
  return `${productId}:${variantId ?? 0}`;
}

function isGuestLine(value: unknown): value is GuestCartLine {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const line = value as Partial<GuestCartLine>;
  return (
    Number.isInteger(line.productId) &&
    (line.productId ?? 0) > 0 &&
    (line.variantId === undefined ||
      line.variantId === null ||
      (Number.isInteger(line.variantId) && line.variantId > 0)) &&
    Number.isInteger(line.qty) &&
    (line.qty ?? 0) > 0 &&
    typeof line.name === "string" &&
    typeof line.unitPrice === "number" &&
    Number.isFinite(line.unitPrice) &&
    typeof line.stock === "number" &&
    Number.isFinite(line.stock)
  );
}

/** Adds defaults for lines written before variants existed. */
function normalizeLine(line: GuestCartLine): GuestCartLine {
  return {
    ...line,
    variantId: line.variantId ?? null,
    variantSku: line.variantSku ?? null,
    variantSize: line.variantSize ?? null,
    variantColor: line.variantColor ?? null,
  };
}

function fromStorage(): GuestCartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(GUEST_CART_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isGuestLine).map(normalizeLine).slice(0, MAX_LINES);
  } catch {
    // Corrupt or unavailable storage must never break the storefront.
    return [];
  }
}

let cache: GuestCartLine[] | null = null;
const listeners = new Set<() => void>();
let storageBound = false;

function notify() {
  for (const listener of listeners) listener();
}

export function readGuestCart(): GuestCartLine[] {
  if (cache === null) cache = fromStorage();
  return cache;
}

function commit(lines: GuestCartLine[]) {
  cache = lines.slice(0, MAX_LINES);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(GUEST_CART_KEY, JSON.stringify(cache));
    } catch {
      // Private mode / quota: keep the in-memory cart for this session.
    }
  }
  notify();
}

/**
 * Cross-tab consistency: another tab writing the guest cart re-reads it here.
 * Registered once, lazily, so tests without a window never touch it.
 */
export function subscribeGuestCart(listener: () => void) {
  listeners.add(listener);
  if (!storageBound && typeof window !== "undefined") {
    storageBound = true;
    window.addEventListener("storage", (event) => {
      if (event.key !== GUEST_CART_KEY && event.key !== null) return;
      cache = fromStorage();
      notify();
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

function lineFromProduct(
  product: Product,
  variant: ProductVariant | null,
): GuestCartLine {
  return {
    productId: product.id,
    variantId: variant ? variant.id : null,
    variantSku: variant ? variant.sku : null,
    variantSize: variant ? variant.size ?? null : null,
    variantColor: variant ? variant.color ?? null : null,
    qty: 0,
    name: product.name,
    unitPrice: toMoney(
      variant ? Number(variant.unitPrice) : Number(product.sellingPrice),
    ),
    image: product.image ?? null,
    stock: Number(variant ? variant.stock : product.stock) || 0,
    categoryId: product.categoryId ?? null,
    categoryName: product.Category?.name ?? product.category ?? null,
    taxRate: Number(product.Category?.taxRate ?? 0) || 0,
  };
}

/**
 * Add (or increment) a line. Stock and the per-line cap are enforced here
 * exactly as the server enforces them, so a guest sees the same limits before
 * signing in instead of losing items at merge time.
 *
 * Pass the selected variant for variant-managed products; omitting it is only
 * valid for legacy products without active variants (the server rejects the
 * merge otherwise).
 */
export function addGuestLine(
  product: Product,
  qty = 1,
  variant: ProductVariant | null = null,
): GuestCartLine[] {
  if (!Number.isInteger(qty) || qty < 1) {
    throw new Error("Quantity must be a whole number of at least 1.");
  }

  // Match the server rule locally: a variant-managed product is never sold as
  // an anonymous base line, even if Products.stock still has a cached value.
  if (product.hasVariants && !variant) {
    throw new Error("Choose a size or colour for this product.");
  }
  if (variant && !variant.isActive) {
    throw new Error("The selected size/colour is no longer available.");
  }

  const stock = Number(variant ? variant.stock : product.stock) || 0;
  if (stock <= 0) {
    throw new Error(
      variant
        ? "The selected size/colour is out of stock."
        : "This product is out of stock.",
    );
  }

  const lines = readGuestCart();
  const key = lineKey(product.id, variant ? variant.id : null);
  const existing = lines.find((line) => lineKey(line.productId, line.variantId) === key);
  const existingQty = existing?.qty ?? 0;

  if (existingQty + qty > stock) {
    throw new Error(
      `Only ${stock} unit(s) of this ${variant ? "variant" : "product"} are in stock` +
        (existingQty ? ` — you already have ${existingQty} in your cart` : ""),
    );
  }
  if (existingQty + qty > MAX_LINE_QTY) {
    throw new Error(`You can have at most ${MAX_LINE_QTY} units of one item.`);
  }

  const snapshot = lineFromProduct(product, variant);
  const next = existing
    ? lines.map((line) =>
        lineKey(line.productId, line.variantId) === key
          ? { ...line, ...snapshot, qty: existingQty + qty }
          : line,
      )
    : [...lines, { ...snapshot, qty }];

  commit(next);
  return next;
}

export function setGuestQty(
  productId: number,
  qty: number,
  variantId: number | null = null,
): GuestCartLine[] {
  const lines = readGuestCart();
  const key = lineKey(productId, variantId);
  const line = lines.find((entry) => lineKey(entry.productId, entry.variantId) === key);
  if (!line) throw new Error("Cart item not found");

  if (!Number.isInteger(qty) || qty < 1) {
    throw new Error("Quantity must be a whole number of at least 1.");
  }
  if (qty > line.stock) {
    throw new Error(
      `Only ${line.stock} unit(s) of this ${line.variantId ? "variant" : "product"} are in stock`,
    );
  }

  commit(
    lines.map((entry) =>
      lineKey(entry.productId, entry.variantId) === key ? { ...entry, qty } : entry,
    ),
  );
  return readGuestCart();
}

export function removeGuestLine(
  productId: number,
  variantId: number | null = null,
): GuestCartLine[] {
  const key = lineKey(productId, variantId);
  commit(
    readGuestCart().filter(
      (line) => lineKey(line.productId, line.variantId) !== key,
    ),
  );
  return readGuestCart();
}

export function clearGuestCart() {
  if (!readGuestCart().length) return;
  commit([]);
}

export function guestCartLineCount(): number {
  return readGuestCart().length;
}

/**
 * Synthetic cart-item id for a guest line. Base lines keep the historical
 * product id; variant lines get a stable composite number so two variants of
 * the same product never collide in React keys or update handlers.
 */
function guestItemId(productId: number, variantId: number | null) {
  return variantId === null ? productId : productId * 1_000_000 + variantId;
}

/** Server-shaped cart built from the local lines (preview only). */
export function buildGuestCart(lines: GuestCartLine[] = readGuestCart()): CartResponse {
  const items: CartItem[] = lines.map((line) => ({
    id: guestItemId(line.productId, line.variantId),
    productId: line.productId,
    variantId: line.variantId,
    variant: line.variantId
      ? {
          id: line.variantId,
          sku: line.variantSku ?? "",
          size: line.variantSize,
          color: line.variantColor,
        }
      : null,
    qty: line.qty,
    name: line.name,
    price: line.unitPrice,
    image: line.image,
    lineTotal: toMoney(line.unitPrice * line.qty),
    stock: line.stock,
    stockExceeded: line.qty > line.stock,
    unavailable: false,
  }));

  const groups = new Map<string, CartTaxGroup>();
  let subtotal = 0;
  for (const line of lines) {
    const lineTotal = toMoney(line.unitPrice * line.qty);
    subtotal += lineTotal;
    const key = line.categoryId === null ? "none" : String(line.categoryId);
    const group = groups.get(key) ?? {
      categoryId: line.categoryId,
      categoryName: line.categoryName,
      taxRate: line.taxRate,
      taxableAmount: 0,
      taxAmount: 0,
    };
    group.taxableAmount += lineTotal;
    groups.set(key, group);
  }

  const byCategory = [...groups.values()].map((group) => ({
    ...group,
    taxableAmount: toMoney(group.taxableAmount),
    taxAmount: toMoney((toMoney(group.taxableAmount) * group.taxRate) / 100),
  }));
  const taxTotal = toMoney(byCategory.reduce((sum, group) => sum + group.taxAmount, 0));
  const totals: CartTotals = {
    subtotal: toMoney(subtotal),
    tax: { total: taxTotal, byCategory, preview: true },
    grandTotal: toMoney(toMoney(subtotal) + taxTotal),
  };

  return {
    success: true,
    count: items.length,
    items,
    totals,
    totalsNotice:
      "Preview only — sign in to merge this cart, then final totals (including applicable GST) are calculated server-side at checkout.",
  };
}
