export interface Category {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  /** GST percentage configured per category (DECIMAL(5,2) on the server). */
  taxRate?: number;
  productCount?: number;
  /** NULL/absent = top-level category. */
  parentId?: number | null;
  /** 1-based position in the tree (server-computed; root = 1). */
  depth?: number;
  /** This category plus every descendant (server rollup). */
  totalProductCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** One node of the server-built category tree. */
export interface CategoryNode extends Category {
  children: CategoryNode[];
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

/** One sellable size/colour combination (server table `ProductVariants`). */
export interface ProductVariant {
  id: number;
  /** Present on admin responses; public product payloads omit it. */
  productId?: number;
  sku: string;
  size?: string | null;
  color?: string | null;
  priceAdjustment: number;
  /** Base selling price + priceAdjustment, resolved by the server. */
  unitPrice: number;
  stock: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
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
  /** Active variants only. Always [] for legacy single-option products. */
  variants?: ProductVariant[];
  /** True when the buyer must choose a variant before adding to the cart. */
  hasVariants?: boolean;
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
  /** Maximum supported nesting depth (root = 1). */
  maxDepth?: number;
  categories: Category[];
  /** Derived from `categories`; absent only on pre-hierarchy servers. */
  tree?: CategoryNode[];
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
