export type ReviewStatus = "pending" | "approved" | "rejected";

export interface PublicReview {
  id: number;
  rating: number;
  title: string | null;
  body: string;
  createdAt: string;
  updatedAt?: string;
  author: {
    name: string;
  };
}

export interface ReviewSummary {
  count: number;
  average: number | null;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

export interface ProductReviewsResponse {
  success: true;
  productId: number;
  count: number;
  reviews: PublicReview[];
  summary: ReviewSummary;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface ReviewProductRef {
  id: number;
  name: string;
  slug: string;
  image: string | null;
}

export interface ReviewCustomerRef {
  id: number;
  name: string;
  email: string;
}

export interface OwnReview {
  id: number;
  rating: number;
  title: string | null;
  body: string;
  status: ReviewStatus;
  moderatedBy: number | null;
  moderatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  product: ReviewProductRef | null;
  customer: ReviewCustomerRef | null;
  moderator: { id: number; name: string } | null;
}

export interface MyReviewsResponse {
  success: true;
  count: number;
  reviews: OwnReview[];
}

export interface CreatedReviewResponse {
  success: true;
  message: string;
  review: {
    id: number;
    productId: number;
    rating: number;
    title: string | null;
    body: string;
    status: ReviewStatus;
    createdAt: string;
  };
}

export interface AdminReview {
  id: number;
  rating: number;
  title: string | null;
  body: string;
  status: ReviewStatus;
  moderatedBy: number | null;
  moderatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  product: ReviewProductRef | null;
  customer: ReviewCustomerRef | null;
}

export interface AdminReviewsResponse {
  success: true;
  count: number;
  reviews: AdminReview[];
  statusCounts: Record<ReviewStatus, number>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface ModerationResponse {
  success: true;
  unchanged: boolean;
  message: string;
  review: {
    id: number;
    productId: number;
    status: ReviewStatus;
    moderatedBy: number | null;
    moderatedAt: string | null;
    updatedAt: string;
  };
}

export interface CreateReviewInput {
  rating: number;
  title?: string;
  body: string;
}
