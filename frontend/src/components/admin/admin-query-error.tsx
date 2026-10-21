import { CircleAlert, RefreshCw, ShieldX } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@/features/auth/auth-context";
import { ApiError } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

interface AdminQueryErrorProps {
  error: unknown;
  title: string;
  onRetry: () => void;
}

/**
 * Shared failure state for admin queries. A 403 is surfaced as a permission
 * problem (never disguised as an empty result); the server remains the source
 * of truth, so the only remedy offered is re-checking the session.
 */
export function AdminQueryError({ error, title, onRetry }: AdminQueryErrorProps) {
  const { refresh, signOut } = useAuth();
  const forbidden = error instanceof ApiError && error.status === 403;

  if (forbidden) {
    return (
      <Alert variant="destructive" className="p-5">
        <ShieldX aria-hidden="true" />
        <AlertTitle>Admin access required</AlertTitle>
        <AlertDescription>
          The server rejected this request for your account. Nothing was changed. If your role was
          changed recently, re-check the session.
        </AlertDescription>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={refresh}>
            <RefreshCw aria-hidden="true" />
            Re-check session
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </Alert>
    );
  }

  return (
    <EmptyState
      icon={CircleAlert}
      title={title}
      description={getErrorMessage(error)}
      action={
        <Button type="button" variant="outline" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          Try again
        </Button>
      }
    />
  );
}
