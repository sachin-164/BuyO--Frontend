import { isRouteErrorResponse, Link, useRouteError } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";

export default function RouteErrorPage() {
  usePageTitle("Something went wrong");
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : null;
  const message =
    isRouteErrorResponse(error) && typeof error.statusText === "string"
      ? error.statusText
      : "The page could not be loaded.";

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {status ?? "Error"}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Something interrupted this page
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">{message}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link to="/">Back to home</Link>
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    </div>
  );
}
