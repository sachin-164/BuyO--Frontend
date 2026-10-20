export interface Category {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  productCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export type ProductSort =
  | "newest"
  | "oldest"
  | "price_asc"
  | "price_desc"
  | "name_asc"
  | "name_desc";

export interface ProductImageMeta {
  alt?: string | null;
  width?: number;
  height?: number;
}

export interface Product {
  id: number;
  name: string;
  slug: string;
  category: string;
  categoryId?: number | null;
  mrpPrice: string | number;
  sellingPrice: string | number;
  stock: number;
  image?: string | null;
  imageMeta?: ProductImageMeta | null;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
  Category?: Category | null;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext?: boolean;
  hasPrev?: boolean;
}

export interface ProductListResponse {
  success: boolean;
  count: number;
  products: Product[];
  pagination: Pagination;
}

export interface ProductDetailResponse {
  success: boolean;
  product: Product;
}

export interface CategoryListResponse {
  success: boolean;
  count: number;
  categories: Category[];
}

export interface ProductQuery {
  q?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  sort?: ProductSort;
  page?: number;
  limit?: number;
}

export interface WishlistCheckResponse {
  success: boolean;
  productId: number;
  inWishlist: boolean;
}

export interface WishlistToggleResponse {
  success: boolean;
  inWishlist: boolean;
  count?: number;
}

export interface CartMutationResponse {
  success: boolean;
  message?: string;
}
