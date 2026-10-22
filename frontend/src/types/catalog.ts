export interface Category {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  /** GST percentage configured per category (DECIMAL(5,2) on the server). */
  taxRate?: number;
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

/** One ordered gallery image (server table `ProductImages`). */
export interface ProductImage {
  id: number;
  productId: number;
  url: string;
  alt?: string | null;
  position: number;
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
  /** Ordered gallery; absent on list responses. */
  images?: ProductImage[];
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

/** One row of the bounded typeahead endpoint. */
export interface SearchSuggestion {
  id: number;
  slug: string;
  name: string;
  price: number;
  image: string;
}

export interface SearchSuggestionsResponse {
  success: boolean;
  query: string;
  count: number;
  suggestions: SearchSuggestion[];
}

export interface RelatedProductsResponse {
  success: boolean;
  productId: number;
  count: number;
  products: Product[];
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
