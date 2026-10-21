import { Link } from "react-router-dom";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AccessDeniedPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center">
        <span className="mx-auto mb-4 inline-flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ShieldX className="size-6" aria-hidden="true" />
        </span>
        <p className="text-sm font-semibold text-destructive">403 — Access denied</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Administrator access required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account is signed in as a customer. The server remains the source of truth for admin
          permissions; this page is only a client-side guard.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to="/">Back to storefront</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/account">Your account</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
