import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { adminKeys, adminOrdersSearch, type AdminOrderListParams } from "@/features/admin/keys";
import { catalogKeys } from "@/features/catalog/queries";
import type { Category, Pagination, Product, ProductListResponse } from "@/types/catalog";
import type {
  AdminOrder,
  AdminOrderDetailResponse,
  AdminOrderListResponse,
  AdminOrderSummary,
} from "@/types/admin";
import { ORDER_STATUS_VALUES } from "@/types/admin";
import type { OrderStatus } from "@/types/commerce";

const DASHBOARD_PAGE_LIMIT = 100;
const DASHBOARD_MAX_PRODUCT_PAGES = 25; // up to 2,500 products
const DASHBOARD_MAX_ORDER_PAGES = 50; // up to 5,000 orders

interface Page<T> {
  items: T[];
  pagination: Pagination;
}

interface Collected<T> {
  items: T[];
  total: number;
  truncated: boolean;
}

/**
 * Walk a paginated endpoint. The cap keeps the dashboard bounded on very large
 * catalogs; callers surface `truncated` so no figure is presented as complete
 * when it is not.
 */
async function collectPages<T extends { id: number }>(
  fetchPage: (page: number) => Promise<Page<T>>,
  maxPages: number,
): Promise<Collected<T>> {
  const seen = new Set<number>();
  const items: T[] = [];
  let total = 0;
  let truncated = false;

  for (let page = 1; page <= maxPages; page += 1) {
    const data = await fetchPage(page);
    if (page === 1) total = data.pagination.total;

    for (const item of data.items) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
    }

    const hasNext =
      data.pagination.hasNext ??
      (Number.isFinite(data.pagination.totalPages)
        ? page < data.pagination.totalPages
        : false);

    if (!hasNext) break;
    if (page === maxPages) {
      truncated = true;
      break;
    }
    if (data.items.length === 0) break;
  }

  return { items, total, truncated };
}

export interface AdminDashboardData {
  products: Product[];
  productTotal: number;
  productsTruncated: boolean;
  categories: Category[];
  orders: AdminOrderSummary[];
  orderTotal: number;
  ordersTruncated: boolean;
  statusCounts: Record<OrderStatus, number>;
  /** Gross value of non-cancelled orders that were fetched. */
  orderValue: number;
  recentOrders: AdminOrderSummary[];
  lowStock: Product[];
  outOfStock: number;
}

async function fetchDashboard(signal: AbortSignal): Promise<AdminDashboardData> {
  const productPages = collectPages<Product>(
    async (page) => {
      const data = await api.get<ProductListResponse>(
        `/api/products?limit=${DASHBOARD_PAGE_LIMIT}&sort=newest&page=${page}`,
        signal,
      );
      return { items: data.products, pagination: data.pagination };
    },
    DASHBOARD_MAX_PRODUCT_PAGES,
  );

  const orderPages = collectPages<AdminOrderSummary>(
    async (page) => {
      const data = await api.get<AdminOrderListResponse>(
        `/api/admin/orders?limit=${DASHBOARD_PAGE_LIMIT}&page=${page}`,
        signal,
      );
      return { items: data.orders, pagination: data.pagination };
    },
    DASHBOARD_MAX_ORDER_PAGES,
  );

  const categoriesPromise = api.get<{ success: boolean; count: number; categories: Category[] }>(
    "/api/categories",
    signal,
  );

  const [products, orders, categoryResponse] = await Promise.all([
    productPages,
    orderPages,
    categoriesPromise,
  ]);

  const statusCounts = ORDER_STATUS_VALUES.reduce(
    (acc, status) => {
      acc[status] = 0;
      return acc;
    },
    {} as Record<OrderStatus, number>,
  );

  let orderValue = 0;
  for (const order of orders.items) {
    statusCounts[order.status] += 1;
    if (order.status !== "cancelled") orderValue += order.grandTotal;
  }

  const sortedOrders = [...orders.items].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const lowStock = products.items
    .filter((product) => product.stock > 0 && product.stock <= 5)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 6);

  return {
    products: products.items,
    productTotal: products.total,
    productsTruncated: products.truncated,
    categories: categoryResponse.categories ?? [],
    orders: orders.items,
    orderTotal: orders.total,
    ordersTruncated: orders.truncated,
    statusCounts,
    orderValue,
    recentOrders: sortedOrders.slice(0, 5),
    lowStock,
    outOfStock: products.items.filter((product) => product.stock <= 0).length,
  };
}

export function useAdminDashboard() {
  return useQuery<AdminDashboardData>({
    queryKey: adminKeys.dashboard(),
    queryFn: ({ signal }) => fetchDashboard(signal),
  });
}

export function useAdminOrders(params: AdminOrderListParams) {
  const search = adminOrdersSearch(params);
  return useQuery<AdminOrderListResponse>({
    queryKey: adminKeys.orders(search),
    queryFn: ({ signal }) =>
      api.get<AdminOrderListResponse>(`/api/admin/orders?${search}`, signal),
  });
}

export function useAdminOrder(id: number | null) {
  return useQuery<AdminOrderDetailResponse>({
    queryKey: adminKeys.order(id),
    queryFn: ({ signal }) => api.get<AdminOrderDetailResponse>(`/api/admin/orders/${id}`, signal),
    enabled: id !== null && id > 0,
    retry: false,
  });
}

export type { AdminOrder, AdminOrderSummary };
export { catalogKeys };
