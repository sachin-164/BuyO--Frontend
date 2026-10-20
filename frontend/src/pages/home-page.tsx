import { motion } from "framer-motion";
import {
  ArrowRight,
  Banknote,
  Heart,
  PackageCheck,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { ProductCard } from "@/components/product/product-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategories, useLatestProducts } from "@/features/catalog/queries";
import { fadeUp, staggerChildren } from "@/lib/motion";

const VALUE_PROPS = [
  {
    icon: Banknote,
    title: "Cash on delivery",
    text: "Pay when your order arrives. No card details stored.",
  },
  {
    icon: PackageCheck,
    title: "Tracked orders",
    text: "Follow every status change from placed to delivered.",
  },
  {
    icon: Heart,
    title: "Saved for later",
    text: "Keep a wishlist that stays with your account.",
  },
];

function ProductGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-lg border border-border bg-card">
          <Skeleton className="aspect-square rounded-none" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-5 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function HomePage() {
  const categories = useCategories();
  const products = useLatestProducts(8);

  return (
    <>
      <section className="relative overflow-hidden bg-primary text-primary-foreground">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-32 size-96 rounded-full bg-accent/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-40 left-1/3 size-96 rounded-full bg-white/10 blur-3xl"
        />

        <div className="container-page relative grid gap-12 py-16 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:py-24">
          <motion.div
            variants={staggerChildren}
            initial="hidden"
            animate="visible"
            className="max-w-2xl"
          >
            <motion.p
              variants={fadeUp}
              className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-accent"
            >
              <Sparkles className="size-3.5" aria-hidden="true" />
              Considered goods, everyday prices
            </motion.p>
            <motion.h1
              variants={fadeUp}
              className="mt-5 text-4xl font-semibold leading-[1.05] sm:text-5xl lg:text-6xl"
            >
              Shopping that feels <span className="text-accent">calm</span>, not
              chaotic.
            </motion.h1>
            <motion.p
              variants={fadeUp}
              className="mt-5 max-w-xl text-base leading-relaxed text-primary-foreground/80 sm:text-lg"
            >
              A focused catalog, honest pricing, and a checkout that respects
              your time. Pay on delivery and follow your order to the door.
            </motion.p>
            <motion.div variants={fadeUp} className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" variant="accent">
                <Link to="/shop">
                  Shop the collection
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link to="/categories">Browse categories</Link>
              </Button>
            </motion.div>
          </motion.div>

          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="hidden lg:block"
            aria-hidden="true"
          >
            <div className="relative mx-auto max-w-sm">
              <div className="absolute inset-0 -rotate-3 rounded-[2rem] border border-white/15" />
              <div className="relative rounded-[2rem] border border-white/15 bg-white/5 p-7 backdrop-blur">
                <p className="text-xs uppercase tracking-[0.2em] text-primary-foreground/60">
                  Why BuyO
                </p>
                <ul className="mt-5 space-y-4">
                  {VALUE_PROPS.map((item) => (
                    <li key={item.title} className="flex items-start gap-3">
                      <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                        <item.icon className="size-4" />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold">{item.title}</span>
                        <span className="block text-xs text-primary-foreground/70">
                          {item.text}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section aria-label="Store benefits" className="border-b border-border bg-card">
        <div className="container-page grid gap-6 py-8 sm:grid-cols-3">
          {VALUE_PROPS.map((item) => (
            <div key={item.title} className="flex items-start gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                <item.icon className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-sans text-sm font-semibold">{item.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{item.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="container-page py-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Browse
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">Shop by category</h2>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/categories">
              All categories
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {categories.isLoading
            ? Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-9 w-28 rounded-full" />
              ))
            : categories.data?.categories.slice(0, 10).map((category) => (
                <Link
                  key={category.id}
                  to={`/shop?category=${encodeURIComponent(category.slug)}`}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {category.name}
                  <span className="rounded-full bg-secondary px-1.5 text-xs text-muted-foreground">
                    {category.productCount ?? 0}
                  </span>
                </Link>
              ))}
          {!categories.isLoading && categories.data?.categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No categories are published yet. You can still{" "}
              <Link
                to="/shop"
                className="font-medium text-primary underline underline-offset-2"
              >
                browse all products
              </Link>
              .
            </p>
          ) : null}
        </div>
        {categories.isError ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Categories are unavailable right now.
          </p>
        ) : null}
      </section>

      <section className="container-page pb-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              New in
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">Latest arrivals</h2>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/shop">
              View all products
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>

        <div className="mt-6">
          {products.isLoading ? <ProductGridSkeleton /> : null}

          {products.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Products could not load</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-3">
                <span>
                  {products.error instanceof Error
                    ? products.error.message
                    : "The catalog is temporarily unavailable."}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void products.refetch()}
                >
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {products.isSuccess && products.data.products.length === 0 ? (
            <EmptyState
              title="The catalog is being restocked"
              description="New products will appear here as soon as they are published."
              action={
                <Button asChild variant="outline">
                  <Link to="/categories">Browse categories</Link>
                </Button>
              }
            />
          ) : null}

          {products.isSuccess && products.data.products.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {products.data.products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
