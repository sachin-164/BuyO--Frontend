import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CircleAlert, MessageSquare, Star } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/features/auth/auth-context";
import { useCreateReview } from "@/features/reviews/mutations";
import { useMyProductReview, useProductReviews } from "@/features/reviews/queries";
import { loginHref } from "@/lib/auth-return";
import { getApiErrorDetails, getErrorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import type { ReviewStatus } from "@/types/reviews";

interface ProductReviewsProps {
  identifier: string;
  productId: number;
  loginNext: string;
}

const PAGE_SIZE = 5;

function Stars({ rating, label = true }: { rating: number; label?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-0.5"
      aria-label={label ? `${rating} out of 5 stars` : undefined}
    >
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          className={
            value <= Math.round(rating)
              ? "size-4 fill-amber-400 text-amber-400"
              : "size-4 text-muted-foreground"
          }
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

function statusCopy(status: ReviewStatus): { title: string; description: string; tone: "info" | "success" | "destructive" } {
  if (status === "approved") {
    return {
      title: "Your review is published",
      description: "Thank you — your review is visible to other shoppers.",
      tone: "success",
    };
  }
  if (status === "rejected") {
    return {
      title: "Your review was not published",
      description:
        "A moderator rejected this review. You can contact support if you think this was a mistake.",
      tone: "destructive",
    };
  }
  return {
    title: "Your review is pending approval",
    description:
      "Only you can see it here. It appears publicly after a moderator approves it.",
    tone: "info",
  };
}

export function ProductReviews({ identifier, productId, loginNext }: ProductReviewsProps) {
  const { hasToken } = useAuth();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const reviewsQuery = useProductReviews(identifier, page, PAGE_SIZE);
  const ownQuery = useMyProductReview(productId, Boolean(hasToken));
  const createReview = useCreateReview(identifier, productId);

  useEffect(() => {
    setPage(1);
    setRating(0);
    setTitle("");
    setBody("");
    setFormError(null);
  }, [identifier]);

  const summary = reviewsQuery.data?.summary;
  const ownReview = ownQuery.data?.reviews[0] ?? null;
  const canWrite = Boolean(hasToken) && !ownQuery.isPending && !ownReview;

  function fieldErrors(error: unknown): string {
    const details = getApiErrorDetails<{ errors?: unknown }>(error);
    if (details && Array.isArray(details.errors)) {
      return details.errors.filter((entry): entry is string => typeof entry === "string").join(" ");
    }
    return getErrorMessage(error);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (rating < 1) {
      setFormError("Choose a rating from 1 to 5 stars.");
      return;
    }
    createReview.mutate(
      { rating, body: body.trim(), ...(title.trim() ? { title: title.trim() } : {}) },
      {
        onSuccess: () => {
          setRating(0);
          setTitle("");
          setBody("");
          toast({
            tone: "success",
            title: "Review submitted",
            description: "It is pending moderator approval.",
          });
        },
        onError: (error) => setFormError(fieldErrors(error)),
      },
    );
  }

  return (
    <section aria-labelledby="reviews-heading" className="mt-14">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Customer feedback
          </p>
          <h2 id="reviews-heading" className="mt-2 text-2xl font-semibold tracking-tight">
            Reviews
          </h2>
        </div>
        {summary ? (
          <p className="text-sm text-muted-foreground">
            {summary.count === 0
              ? "No approved reviews yet"
              : `${summary.count} approved review${summary.count === 1 ? "" : "s"}`}
          </p>
        ) : null}
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Rating summary</CardTitle>
            </CardHeader>
            <CardContent>
              {reviewsQuery.isLoading ? (
                <div className="space-y-2" aria-busy="true">
                  <Skeleton className="h-8 w-24" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : reviewsQuery.isError ? (
                <p className="text-sm text-muted-foreground">
                  The rating summary could not be loaded.
                </p>
              ) : summary && summary.count > 0 && summary.average !== null ? (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-semibold tabular-nums">
                      {summary.average.toFixed(1)}
                    </span>
                    <span className="text-sm text-muted-foreground">out of 5</span>
                  </div>
                  <div className="mt-2">
                    <Stars rating={summary.average} />
                  </div>
                  <ul className="mt-4 space-y-1.5" aria-label="Rating distribution">
                    {[5, 4, 3, 2, 1].map((value) => {
                      const count = summary.distribution[value as 1 | 2 | 3 | 4 | 5] ?? 0;
                      const percent = summary.count ? Math.round((count / summary.count) * 100) : 0;
                      return (
                        <li key={value} className="flex items-center gap-2 text-xs">
                          <span className="w-6 tabular-nums text-muted-foreground">{value}★</span>
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                            <span
                              className="block h-full rounded-full bg-amber-400"
                              style={{ width: `${percent}%` }}
                            />
                          </span>
                          <span className="w-6 text-right tabular-nums text-muted-foreground">
                            {count}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No approved reviews yet. Be the first to share your experience.
                </p>
              )}
            </CardContent>
          </Card>

          {!hasToken ? (
            <Alert variant="info">
              <MessageSquare aria-hidden="true" />
              <AlertTitle>Sign in to write a review</AlertTitle>
              <AlertDescription>
                <Link
                  to={loginHref(loginNext)}
                  className="font-medium text-primary underline underline-offset-2"
                >
                  Sign in
                </Link>{" "}
                to share your experience. Every review is moderated before it appears publicly.
              </AlertDescription>
            </Alert>
          ) : ownQuery.isPending ? (
            <Card aria-busy="true">
              <CardContent className="space-y-2 p-4">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ) : ownReview ? (
            (() => {
              const copy = statusCopy(ownReview.status);
              return (
                <Alert variant={copy.tone}>
                  <MessageSquare aria-hidden="true" />
                  <AlertTitle>{copy.title}</AlertTitle>
                  <AlertDescription>
                    <span className="block">{copy.description}</span>
                    <span className="mt-2 block text-xs">
                      Submitted {formatDateTime(ownReview.createdAt)} · {ownReview.rating}★
                    </span>
                  </AlertDescription>
                </Alert>
              );
            })()
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Write a review</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} noValidate className="space-y-4">
                  <fieldset>
                    <legend className="text-sm font-medium">Rating</legend>
                    <div className="mt-2 flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <button
                          key={value}
                          type="button"
                          aria-label={`Rate ${value} out of 5 stars`}
                          aria-pressed={rating === value}
                          onClick={() => setRating(value)}
                          className="rounded-md p-1 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Star
                            className={
                              value <= rating
                                ? "size-6 fill-amber-400 text-amber-400"
                                : "size-6 text-muted-foreground"
                            }
                            aria-hidden="true"
                          />
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <Field id="review-title" label="Title" optional error={undefined}>
                    {() => (
                      <Input
                        id="review-title"
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        maxLength={120}
                        autoComplete="off"
                        placeholder="Summarise your experience"
                      />
                    )}
                  </Field>

                  <Field
                    id="review-body"
                    label="Review"
                    required
                    hint="10–2,000 characters. Be specific and respectful."
                  >
                    {({ invalid, described }) => (
                      <Textarea
                        id="review-body"
                        value={body}
                        onChange={(event) => setBody(event.target.value)}
                        aria-invalid={invalid}
                        aria-describedby={described}
                        minLength={10}
                        maxLength={2000}
                        rows={5}
                        placeholder="What did you like or dislike?"
                      />
                    )}
                  </Field>

                  {formError ? (
                    <Alert variant="destructive" role="alert">
                      <CircleAlert aria-hidden="true" />
                      <AlertTitle>Review not submitted</AlertTitle>
                      <AlertDescription>{formError}</AlertDescription>
                    </Alert>
                  ) : null}

                  <Button
                    type="submit"
                    disabled={createReview.isPending || !canWrite}
                    isLoading={createReview.isPending}
                    className="w-full"
                  >
                    Submit for approval
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Reviews are public only after moderator approval. Your name is shown, never
                    your email.
                  </p>
                </form>
              </CardContent>
            </Card>
          )}
        </div>

        <div>
          {reviewsQuery.isLoading ? (
            <div className="space-y-3" aria-busy="true">
              <span className="sr-only" role="status">
                Loading reviews
              </span>
              {[0, 1].map((index) => (
                <Card key={index} className="p-4">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="mt-3 h-4 w-full" />
                  <Skeleton className="mt-2 h-4 w-4/5" />
                </Card>
              ))}
            </div>
          ) : reviewsQuery.isError ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>Reviews could not be loaded</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-3">
                <span>{getErrorMessage(reviewsQuery.error)}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void reviewsQuery.refetch()}
                >
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          ) : reviewsQuery.data && reviewsQuery.data.reviews.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                <MessageSquare className="size-8 text-muted-foreground" aria-hidden="true" />
                <p className="font-medium">No reviews yet</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  This product has no approved reviews. Nothing is fabricated here — only real,
                  moderated feedback appears.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {reviewsQuery.data?.reviews.map((review) => (
                <Card key={review.id}>
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Stars rating={review.rating} />
                        {review.title ? (
                          <h3 className="text-sm font-semibold">{review.title}</h3>
                        ) : null}
                      </div>
                      <Badge variant="outline">Approved</Badge>
                    </div>
                    <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
                      {review.body}
                    </p>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {review.author.name} · {formatDateTime(review.createdAt)}
                    </p>
                  </CardContent>
                </Card>
              ))}

              {reviewsQuery.data?.pagination.hasNext ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => setPage((current) => current + 1)}
                  isLoading={reviewsQuery.isFetching}
                >
                  Load more reviews
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
