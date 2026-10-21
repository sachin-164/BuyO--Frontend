import { Compass } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";

export default function NotFoundPage() {
  usePageTitle("Page not found");
  return (
    <div className="container-page flex min-h-[60vh] items-center justify-center py-16">
      <div className="max-w-md text-center">
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-secondary text-primary">
          <Compass className="size-6" aria-hidden="true" />
        </span>
        <p className="mt-5 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          404
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The link may be old, or the page may have moved. The shop and your
          account are still one click away.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link to="/">Back to home</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/shop">Go to shop</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
