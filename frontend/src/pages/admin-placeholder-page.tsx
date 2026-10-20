import { Construction } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Standalone admin placeholder. Phase 5 replaces this with the real admin
 * shell; server-side authorization already protects every admin endpoint.
 */
export default function AdminPlaceholderPage() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card">
        <div className="container-page flex h-16 items-center justify-between">
          <Link to="/" className="font-display text-xl font-bold tracking-tight">
            BuyO
            <span className="ml-2 font-sans text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Admin
            </span>
          </Link>
          <Button asChild variant="outline" size="sm">
            <Link to="/">Back to store</Link>
          </Button>
        </div>
      </header>

      <main className="container-page py-20">
        <div className="mx-auto max-w-xl text-center">
          <span className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-secondary text-primary">
            <Construction className="size-6" aria-hidden="true" />
          </span>
          <Badge variant="secondary" className="mt-5">
            Phase 5
          </Badge>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Admin panel migration
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
            Dashboard, product editor, categories, and order management move into
            this React application in Phase 5. The current admin panel remains
            live and server-authorized until the cutover.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild>
              <Link to="/">Return to storefront</Link>
            </Button>
            <Button asChild variant="outline">
              <a href="/admin/dashboard.html">Open current admin</a>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
