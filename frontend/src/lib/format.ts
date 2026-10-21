const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function formatPrice(value: string | number): string {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? inr.format(amount) : "—";
}

export function discountPercent(mrp: string | number, selling: string | number): number | null {
  const m = Number(mrp);
  const s = Number(selling);
  if (!Number.isFinite(m) || !Number.isFinite(s) || m <= s || m <= 0) return null;
  return Math.round(((m - s) / m) * 100);
}

const dateTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});

const dateOnly = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
});

export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTime.format(date);
}

export function formatDate(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateOnly.format(date);
}
