import { useEffect, useState, type ReactNode } from "react";
import {
  Banknote,
  CheckCircle2,
  CircleAlert,
  Heart,
  Info,
  PackageCheck,
  PackageSearch,
} from "lucide-react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ProductGallery } from "@/components/product/product-gallery";
import { ProductCard } from "@/components/product/product-card";
import { QuantitySelector } from "@/components/product/quantity-selector";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAddToCart,
  useToggleWishlist,
  useWishlistMembership,
} from "@/features/catalog/mutations";
import { useProduct, useProducts } from "@/features/catalog/queries";
import { usePageTitle } from "@/hooks/use-page-title";
import { ApiError, getToken } from "@/lib/api";
import { discountPercent, formatPrice } from "@/lib/format";

type NoticeTone = "success" | "error" | "info";

interface Notice {
  tone: NoticeTone;
  title: string;
  message?: ReactNode;
}

const noticeVariants = {
  success: "success",
  error: "destructive",
  info: "info",
} as const;

function SignInLink({ next }: { next: string }) {
  return (
    <Link
      to={`/login?next=${encodeURIComponent(next)}`}
      className="font-medium text-primary underline underline-offset-2"
    >
      Sign in
    </Link>
  );
}

function ProductDetailSkeleton() {
  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-2 lg:gap-12" aria-busy="true">
      <span className="sr-only" role="status" aria-label="Loading product">
        Loading product
      </span>
      <Skeleton className="aspect-square w-full rounded-lg" />
      <div className="space-y-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-4/5" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="mt-6 h-24 w-full rounded-lg" />
      </div>
    </div>
  );
}

export default function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const identifier = slug?.trim() || undefined;
  const productQuery = useProduct(identifier);
  const product = productQuery.data?.product;

  const token = getToken();
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState<Notice | null>(null);

  const productId = product?.id ?? 0;
  const categoryValue = product?.Category?.slug ?? product?.category ?? "";
  const relatedQuery = useProducts(
    { category: categoryValue || undefined, limit: 5, sort: "newest", page: 1 },
    { enabled: Boolean(product && categoryValue) },
  );

  const wishlistMembership = useWishlistMembership(productId, Boolean(token && productId));
  const addToCart = useAddToCart();
  const toggleWishlist = useToggleWishlist(productId);

  usePageTitle(product?.name ?? (productQuery.isError ? "Product not found" : "Product"));

  useEffect(() => {
    setQuantity(1);
    setNotice(null);
  }, [productId]);

  const currentPath = `${location.pathname}${location.search}`;
  const loginNext = currentPath;
  const categoryHref = categoryValue
    ? `/shop?category=${encodeURIComponent(categoryValue)}`
    : "/shop";

  const notFound =
    !identifier ||
    (productQuery.isError &&
      productQuery.error instanceof ApiError &&
      productQuery.error.status === 404);

  const stock = Math.max(0, Number(product?.stock ?? 0) || 0);
  const maxQuantity = Math.min(99, stock);
  const outOfStock = stock <= 0;
  const lowStock = stock > 0 && stock <= 5;
  const discount = product
    ? discountPercent(product.mrpPrice, product.sellingPrice)
    : null;
  const saved = wishlistMembership.data?.inWishlist ?? false;

  const related =
    relatedQuery.data?.products.filter((item) => item.id !== productId).slice(0, 4) ?? [];

  function errorMessage(error: unknown): ReactNode {
    if (error instanceof ApiError) {
      if (error.status === 401) {
        return (
          <>
            Your session has expired. <SignInLink next={loginNext} /> to continue.
          </>
        );
      }
      if (error.status === 403) {
        return (
          <>
            {error.message || "Your account cannot perform this action yet."} Check your
            account, then try again.
          </>
        );
      }
      return error.message;
    }
    return "Something went wrong. Please try again.";
  }

  function handleAddToCart() {
    if (!product) return;
    if (!token) {
      setNotice({
        tone: "info",
        title: "Sign in to add this item to your cart",
        message: (
          <>
            <SignInLink next={loginNext} /> or create an account to continue.
          </>
        ),
      });
      return;
    }
    if (outOfStock) return;

    addToCart.mutate(
      { productId: product.id, qty: quantity },
      {
        onSuccess: () => {
          setNotice({
            tone: "success",
            title: `Added ${quantity} × ${product.name} to your cart`,
            message: (
              <>
                Stock and totals are confirmed at checkout.{" "}
                <Link to="/cart" className="font-medium text-primary underline underline-offset-2">
                  View cart
                </Link>
              </>
            ),
          });
        },
        onError: (error) => {
          setNotice({
            tone: "error",
            title: "Could not add this item to your cart",
            message: errorMessage(error),
          });
        },
      },
    );
  }

  function handleWishlist() {
    if (!product) return;
    if (!token) {
      setNotice({
        tone: "info",
        title: "Sign in to save this product",
        message: (
          <>
            <SignInLink next={loginNext} /> to keep a wishlist that stays with your account.
          </>
        ),
      });
      return;
    }

    toggleWishlist.mutate(undefined, {
      onSuccess: (data) => {
        setNotice({
          tone: "success",
          title: data.inWishlist ? "Saved to your wishlist" : "Removed from your wishlist",
          message: data.inWishlist ? (
            <>
              You can find it any time in{" "}
              <Link to="/wishlist" className="font-medium text-primary underline underline-offset-2">
                your wishlist
              </Link>
              .
            </>
          ) : undefined,
        });
      },
      onError: (error) => {
        setNotice({
          tone: "error",
          title: "Wishlist could not be updated",
          message: errorMessage(error),
        });
      },
    });
  }

  return (
    <div className="container-page py-8 sm:py-10">
      <Breadcrumbs
        items={
          product
            ? [
                { label: "Home", to: "/" },
                { label: "Shop", to: "/shop" },
                {
                  label: product.Category?.name ?? product.category,
                  to: categoryHref,
                },
                { label: product.name },
              ]
            : [{ label: "Home", to: "/" }, { label: "Shop", to: "/shop" }, { label: "Product" }]
        }
      />

      {productQuery.isLoading || (!identifier && !notFound) ? (
        <ProductDetailSkeleton />
      ) : null}

      {notFound ? (
        <div className="mt-8">
          <EmptyState
            icon={PackageSearch}
            title="Product not found"
            description="This product may have been removed, renamed, or the link may be incomplete. The rest of the catalog is still available."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild>
                  <Link to="/shop">Browse all products</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/categories">Browse categories</Link>
                </Button>
              </div>
            }
          />
        </div>
      ) : null}

      {!notFound && productQuery.isError ? (
        <div className="mt-8">
          <Alert variant="destructive">
            <AlertTitle>This product could not load</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>
                {productQuery.error instanceof Error
                  ? productQuery.error.message
                  : "The product is temporarily unavailable."}
              </span>
              <Button variant="outline" size="sm" onClick={() => void productQuery.refetch()}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {product && !notFound ? (
        <>
          <div className="mt-6 grid gap-8 lg:grid-cols-2 lg:gap-12">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <ProductGallery
                images={
                  product.image
                    ? [{ src: product.image, alt: product.imageMeta?.alt || product.name }]
                    : []
                }
                productName={product.name}
              />
            </div>

            <div>
              <Link
                to={categoryHref}
                className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-primary"
              >
                {product.Category?.name ?? product.category}
              </Link>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                {product.name}
              </h1>

              <div className="mt-4 flex flex-wrap items-baseline gap-3">
                <span className="text-3xl font-semibold">
                  {formatPrice(product.sellingPrice)}
                </span>
                {discount !== null ? (
                  <>
                    <s className="text-sm text-muted-foreground">
                      {formatPrice(product.mrpPrice)}
                    </s>
                    <Badge variant="accent">{discount}% off</Badge>
                  </>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Price in INR.</p>

              <div className="mt-4">
                {outOfStock ? (
                  <Badge variant="destructive">Out of stock</Badge>
                ) : lowStock ? (
                  <Badge variant="accent">Only {stock} left</Badge>
                ) : (
                  <Badge variant="success">In stock</Badge>
                )}
              </div>

              <div className="mt-6 rounded-lg border border-border bg-card p-5">
                {!outOfStock ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <QuantitySelector
                      value={quantity}
                      onChange={setQuantity}
                      max={maxQuantity}
                      disabled={addToCart.isPending}
                    />
                    <Button
                      size="lg"
                      className="h-10 min-w-40 flex-1 sm:flex-none"
                      onClick={handleAddToCart}
                      isLoading={addToCart.isPending}
                    >
                      Add to cart
                    </Button>
                  </div>
                ) : (
                  <Button size="lg" className="h-10 w-full" disabled>
                    Out of stock
                  </Button>
                )}

                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 w-full"
                  onClick={handleWishlist}
                  aria-pressed={saved}
                  isLoading={toggleWishlist.isPending}
                >
                  <Heart
                    className={saved ? "fill-current" : undefined}
                    aria-hidden="true"
                  />
                  {saved ? "Saved to wishlist" : "Save to wishlist"}
                </Button>

                {notice ? (
                  <div className="mt-4">
                    <Alert
                      variant={noticeVariants[notice.tone]}
                      role={notice.tone === "error" ? "alert" : "status"}
                    >
                      {notice.tone === "success" ? (
                        <CheckCircle2 aria-hidden="true" />
                      ) : notice.tone === "error" ? (
                        <CircleAlert aria-hidden="true" />
                      ) : (
                        <Info aria-hidden="true" />
                      )}
                      <AlertTitle>{notice.title}</AlertTitle>
                      {notice.message ? (
                        <AlertDescription>{notice.message}</AlertDescription>
                      ) : null}
                    </Alert>
                  </div>
                ) : null}

                {!token ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    <SignInLink next={loginNext} /> to use your cart and wishlist.
                  </p>
                ) : null}
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="flex items-start gap-2.5 rounded-md border border-border bg-card px-4 py-3">
                  <Banknote className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-medium">Cash on delivery</p>
                    <p className="text-xs text-muted-foreground">
                      Available as a payment option at checkout.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5 rounded-md border border-border bg-card px-4 py-3">
                  <PackageCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-medium">Tracked orders</p>
                    <p className="text-xs text-muted-foreground">
                      Follow each status change from placed to delivered.
                    </p>
                  </div>
                </div>
              </div>

              <section aria-labelledby="product-description-heading" className="mt-8">
                <h2
                  id="product-description-heading"
                  className="text-lg font-semibold tracking-tight"
                >
                  Description
                </h2>
                {product.description ? (
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                    {product.description}
                  </p>
                ) : (
                  <p className="mt-2 text-sm italic text-muted-foreground">
                    No description has been published for this product yet.
                  </p>
                )}
              </section>
            </div>
          </div>

          {related.length > 0 ? (
            <section aria-labelledby="related-heading" className="mt-14">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    More from {product.Category?.name ?? product.category}
                  </p>
                  <h2 id="related-heading" className="mt-2 text-2xl font-semibold tracking-tight">
                    You may also like
                  </h2>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link to={categoryHref}>View category</Link>
                </Button>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {related.map((item) => (
                  <ProductCard key={item.id} product={item} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
