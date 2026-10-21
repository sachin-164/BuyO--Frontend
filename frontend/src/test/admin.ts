import { vi } from "vitest";
import { jsonResponse } from "@/test/render";
import type { Category, Pagination, Product } from "@/types/catalog";
import type {
  AdminAnalyticsSummary,
  AdminCustomerDetail,
  AdminCustomerOrderRef,
  AdminCustomerSummary,
  AdminOrder,
  AdminOrderSummary,
} from "@/types/admin";
import type { User } from "@/types/account";

export const ADMIN_USER: User = {
  id: 2,
  name: "Asha Admin",
  email: "asha@buyo.test",
  isVerified: true,
  role: "admin",
  isAdmin: true,
};

export const CUSTOMER_USER: User = {
  id: 1,
  name: "Anita Rao",
  email: "anita@example.com",
  isVerified: true,
  role: "customer",
  isAdmin: false,
};

export const CATEGORY: Category = {
  id: 1,
  name: "Steel",
  slug: "steel",
  description: "Steel drinkware",
  taxRate: 5,
  productCount: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
};

export const CATEGORY_SECOND: Category = {
  id: 2,
  name: "Lighting",
  slug: "lighting",
  description: "Lamps and fixtures",
  taxRate: 12,
  productCount: 1,
};

export const PRODUCT: Product = {
  id: 3,
  name: "Steel Bottle",
  slug: "steel-bottle",
  category: "Steel",
  categoryId: 1,
  mrpPrice: "1200.00",
  sellingPrice: "999.00",
  stock: 4,
  image: "/uploads/bottle.png",
  imageMeta: { alt: "A steel bottle" },
  description: "A durable bottle.",
  Category: CATEGORY,
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-03T00:00:00.000Z",
};

export const PRODUCT_SECOND: Product = {
  id: 4,
  name: "Desk Lamp",
  slug: "desk-lamp",
  category: "Lighting",
  categoryId: 2,
  mrpPrice: "2500.00",
  sellingPrice: "2200.00",
  stock: 0,
  image: null,
  imageMeta: null,
  description: "A warm desk lamp.",
  Category: CATEGORY_SECOND,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

const CUSTOMER = { id: 1, name: "Anita Rao", email: "anita@example.com" };

export const ORDER_SUMMARY: AdminOrderSummary = {
  id: 23,
  orderNumber: "BO-260101-ABC123",
  status: "confirmed",
  paymentMethod: "cod",
  subtotal: 999,
  taxTotal: 50,
  grandTotal: 1049,
  createdAt: "2026-01-05T10:30:00.000Z",
  userId: CUSTOMER.id,
  user: CUSTOMER,
  items: [
    {
      id: 1,
      productId: 3,
      name: "Steel Bottle",
      image: "/uploads/bottle.png",
      unitPrice: 999,
      qty: 1,
      lineTotal: 999,
      taxRate: 5,
      taxAmount: 50,
    },
  ],
};

export const ORDER_DETAIL: AdminOrder = {
  ...ORDER_SUMMARY,
  taxBreakdown: [
    {
      categoryId: 1,
      categoryName: "Steel",
      taxRate: 5,
      taxableAmount: 999,
      taxAmount: 50,
    },
  ],
  shippingAddress: {
    label: "Home",
    fullName: "Anita Rao",
    phone: "9876543210",
    line1: "12 MG Road",
    line2: "Flat 4",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560001",
  },
  addressId: 7,
  notes: "Leave with the security desk.",
  statusEvents: [
    {
      id: 1,
      fromStatus: null,
      toStatus: "placed",
      note: null,
      createdAt: "2026-01-05T10:30:00.000Z",
    },
    {
      id: 2,
      fromStatus: "placed",
      toStatus: "confirmed",
      note: "Payment/stock checked by admin.",
      createdAt: "2026-01-05T11:00:00.000Z",
    },
  ],
};

export interface MockRequest {
  url: URL;
  method: string;
  body: string | null;
  formData: FormData | null;
  rawBody: BodyInit | null;
  init?: RequestInit;
}

export type MockHandler = (request: MockRequest) => Response | undefined | Promise<Response | undefined>;

export interface InstalledAdminFetch {
  requests: MockRequest[];
  fetchMock: ReturnType<typeof vi.fn>;
}

/**
 * Install a fetch mock that always answers `/api/auth/me` with an admin session
 * and lets each test handle the admin endpoints it exercises. Requests are
 * recorded so tests can assert exact paths and JSON bodies.
 */
export function installAdminFetch(
  handler: MockHandler,
  options: { user?: User } = {},
): InstalledAdminFetch {
  const requests: MockRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const rawBody = (init?.body ?? null) as BodyInit | null;
    const body = typeof rawBody === "string" ? rawBody : null;
    const formData =
      typeof FormData !== "undefined" && rawBody instanceof FormData ? rawBody : null;
    requests.push({ url, method, body, formData, rawBody, init });

    if (url.pathname === "/api/auth/me") {
      return jsonResponse({ success: true, user: options.user ?? ADMIN_USER });
    }

    const handled = await handler({ url, method, body, formData, rawBody, init });
    if (handled) return handled;
    return jsonResponse({ success: false, message: "Not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { requests, fetchMock };
}

export function paginationFor(total: number, page = 1, limit = 10): Pagination {
  const totalPages = total === 0 ? 1 : Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

export function productListResponse(
  products: Product[] = [PRODUCT],
  pagination: Pagination = paginationFor(products.length),
) {
  return jsonResponse({ success: true, count: products.length, products, pagination });
}

export function productDetailResponse(product: Product = PRODUCT) {
  return jsonResponse({ success: true, product });
}

export function categoriesResponse(categories: Category[] = [CATEGORY, CATEGORY_SECOND]) {
  return jsonResponse({ success: true, count: categories.length, categories });
}

export function orderListResponse(
  orders: AdminOrderSummary[] = [ORDER_SUMMARY],
  pagination: Pagination = paginationFor(orders.length, 1, 20),
) {
  return jsonResponse({ success: true, count: orders.length, orders, pagination });
}

export function orderDetailResponse(order: AdminOrder = ORDER_DETAIL) {
  return jsonResponse({ success: true, order });
}

export const CUSTOMER_SUMMARY: AdminCustomerSummary = {
  id: 1,
  name: "Anita Rao",
  email: "anita@example.com",
  isVerified: true,
  role: "customer",
  createdAt: "2026-01-01T00:00:00.000Z",
  orderCount: 2,
  cancelledCount: 1,
  totalSpend: 1049,
  lastOrderAt: "2026-01-05T10:30:00.000Z",
};

export const CUSTOMER_SUMMARY_SECOND: AdminCustomerSummary = {
  id: 5,
  name: "Bilal Khan",
  email: "bilal@example.com",
  isVerified: true,
  role: "customer",
  createdAt: "2026-01-03T00:00:00.000Z",
  orderCount: 0,
  cancelledCount: 0,
  totalSpend: 0,
  lastOrderAt: null,
};

export const ANALYTICS_SUMMARY: AdminAnalyticsSummary = {
  success: true,
  generatedAt: "2026-01-10T00:00:00.000Z",
  range: { days: 30, from: "2025-12-12T00:00:00.000Z" },
  products: {
    total: 2,
    outOfStock: 1,
    lowStockCount: 1,
    lowStockThreshold: 5,
    lowStock: [
      {
        id: PRODUCT.id,
        name: PRODUCT.name,
        stock: PRODUCT.stock,
        image: PRODUCT.image,
        category: CATEGORY.name,
      },
    ],
  },
  categories: { total: 2 },
  customers: { total: 2, newInRange: 2 },
  orders: {
    total: 2,
    byStatus: { placed: 0, confirmed: 1, shipped: 0, delivered: 0, cancelled: 1 },
    nonCancelledCount: 1,
    grossOrderValue: 1049,
    averageOrderValue: 1049,
  },
  revenueSeries: [
    { day: "2026-01-05", revenue: 1049, orders: 1 },
    { day: "2026-01-06", revenue: 500, orders: 1 },
  ],
  topProducts: [{ productId: PRODUCT.id, name: PRODUCT.name, revenue: 1049, units: 2 }],
  recentOrders: [
    {
      id: ORDER_SUMMARY.id,
      orderNumber: ORDER_SUMMARY.orderNumber,
      status: ORDER_SUMMARY.status,
      grandTotal: ORDER_SUMMARY.grandTotal,
      createdAt: ORDER_SUMMARY.createdAt,
      itemCount: 1,
      user: ORDER_SUMMARY.user,
    },
  ],
};

export function analyticsResponse(summary: AdminAnalyticsSummary = ANALYTICS_SUMMARY) {
  return jsonResponse(summary);
}

export function customerListResponse(
  customers: AdminCustomerSummary[] = [CUSTOMER_SUMMARY, CUSTOMER_SUMMARY_SECOND],
  pagination: Pagination = paginationFor(customers.length, 1, 20),
) {
  return jsonResponse({ success: true, count: customers.length, customers, pagination });
}

export function customerDetailResponse(
  customer: AdminCustomerDetail = {
    ...CUSTOMER_SUMMARY,
    addresses: [
      {
        id: 7,
        fullName: "Anita Rao",
        phone: "9876543210",
        line1: "12 MG Road",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
        isDefault: true,
        label: "Home",
      },
    ],
  },
  orders: AdminCustomerOrderRef[] = [
    {
      id: ORDER_SUMMARY.id,
      orderNumber: ORDER_SUMMARY.orderNumber,
      status: ORDER_SUMMARY.status,
      grandTotal: ORDER_SUMMARY.grandTotal,
      createdAt: ORDER_SUMMARY.createdAt,
      itemCount: 1,
    },
  ],
) {
  return jsonResponse({ success: true, customer, orders });
}
