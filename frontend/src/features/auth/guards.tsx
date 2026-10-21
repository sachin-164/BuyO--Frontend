import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { CircleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import AccessDeniedPage from "@/pages/access-denied-page";
import { loginHref } from "@/lib/auth-return";
import { useAuth } from "@/features/auth/auth-context";

function SessionLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner label="Checking your session" />
    </div>
  );
}

function SessionError({ retry, signOut }: { retry: () => void; signOut: () => void }) {
  return (
    <div className="container-page py-12">
      <Alert variant="destructive" className="mx-auto max-w-xl">
        <CircleAlert aria-hidden="true" />
        <AlertTitle>We could not check your session</AlertTitle>
        <AlertDescription>
          Your saved sign-in is still on this device, but the server could not be reached. Retry,
          or sign out and sign in again.
        </AlertDescription>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={retry}>
            Try again
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </Alert>
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, refresh, signOut } = useAuth();
  const location = useLocation();

  if (status === "loading") return <SessionLoading />;
  if (status === "error") return <SessionError retry={refresh} signOut={signOut} />;
  if (status === "anonymous") {
    return (
      <Navigate
        to={loginHref(`${location.pathname}${location.search}`)}
        replace
      />
    );
  }
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, status, refresh, signOut } = useAuth();
  const location = useLocation();

  if (status === "loading") return <SessionLoading />;
  if (status === "error") return <SessionError retry={refresh} signOut={signOut} />;
  if (status === "anonymous") {
    return <Navigate to={loginHref(`${location.pathname}${location.search}`)} replace />;
  }
  if (!user?.isAdmin) return <AccessDeniedPage />;
  return <>{children}</>;
}
