import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  Info,
  LogOut,
  MapPin,
  PackageOpen,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/features/auth/auth-context";
import { usePageTitle } from "@/hooks/use-page-title";

const ACCOUNT_LINKS = [
  {
    to: "/orders",
    title: "Order history",
    description: "Every COD order, totals, items, and the real status timeline.",
    icon: PackageOpen,
  },
  {
    to: "/account/addresses",
    title: "Addresses",
    description: "Saved delivery addresses used by checkout.",
    icon: MapPin,
  },
  {
    to: "/wishlist",
    title: "Wishlist",
    description: "Saved products tied to this account.",
    icon: BadgeCheck,
  },
  {
    to: "/cart",
    title: "Cart",
    description: "Quantities, stock warnings, and authoritative totals.",
    icon: ArrowRight,
  },
] as const;

export default function AccountPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  usePageTitle("Your account");

  if (!user) return null;

  function handleSignOut() {
    signOut();
    toast({ tone: "success", title: "Signed out", description: "Your local session was cleared." });
    navigate("/", { replace: true });
  }

  return (
    <div className="container-page py-8 sm:py-10">
      <div className="grid gap-8 lg:grid-cols-[2fr,1fr]">
        <section aria-labelledby="account-overview-heading">
          <header>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Account
            </p>
            <h1 id="account-overview-heading" className="mt-2 text-3xl font-semibold tracking-tight">
              {user.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant={user.isVerified ? "success" : "accent"}>
                {user.isVerified ? "Email verified" : "Email not verified"}
              </Badge>
              <Badge variant="secondary" className="inline-flex items-center gap-1">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                {user.isAdmin ? "Admin account" : "Customer account"}
              </Badge>
            </div>
          </header>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {ACCOUNT_LINKS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="flex h-full flex-col rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <item.icon className="size-5 text-primary" aria-hidden="true" />
                <h2 className="mt-3 text-base font-semibold">{item.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
              </Link>
            ))}
          </div>

          <Card className="mt-8">
            <CardHeader>
              <CardTitle>Password management</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                Password recovery by email is available. There is no change-password endpoint in the
                current backend, so no in-app password editor is shown.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link to="/forgot-password">Request a password email</Link>
              </Button>
            </CardContent>
          </Card>
        </section>

        <aside className="space-y-4">
          <Alert variant="info">
            <Info aria-hidden="true" />
            <AlertTitle>Profile editing is not available yet</AlertTitle>
            <AlertDescription>
              The backend only exposes <code>GET /api/auth/me</code>; it has no update endpoint. This
              page intentionally does not pretend to edit your profile.
            </AlertDescription>
          </Alert>

          <Card
            aria-live="polite"
          >
            <CardHeader>
              <CardTitle>Session</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                Signed in as user #{user.id}. Your token stays in this browser only; the server
                re-checks it on every protected request.
              </p>
              <Button type="button" variant="outline" onClick={handleSignOut} className="w-full">
                <LogOut aria-hidden="true" />
                Sign out
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
