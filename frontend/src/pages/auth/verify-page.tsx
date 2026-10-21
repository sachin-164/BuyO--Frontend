import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Info, MailCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants, Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth/auth-shell";
import { usePageTitle } from "@/hooks/use-page-title";
import { cn } from "@/lib/utils";

const STATUS_MESSAGES: Record<string, { title: string; description: string; tone: "success" | "info" }> = {
  success: {
    title: "Email verified",
    description: "Your email address has been confirmed. You can sign in now.",
    tone: "success",
  },
  already_verified: {
    title: "Email already verified",
    description: "This account was already active. You can sign in now.",
    tone: "info",
  },
};

export default function VerifyPage() {
  usePageTitle("Email verification");
  const [searchParams] = useSearchParams();
  const status = searchParams.get("status");
  const token = searchParams.get("token");
  const message = useMemo(
    () => (status ? STATUS_MESSAGES[status] ?? null : null),
    [status],
  );

  if (message) {
    return (
      <AuthShell title="Email verification" description="Verification status from the server.">
        <Alert variant={message.tone} className="mt-6" role="status">
          {message.tone === "success" ? <CheckCircle2 aria-hidden="true" /> : <Info aria-hidden="true" />}
          <AlertTitle>{message.title}</AlertTitle>
          <AlertDescription>{message.description}</AlertDescription>
        </Alert>
        <Button asChild className="mt-6 w-full">
          <Link to="/login">Go to sign in</Link>
        </Button>
      </AuthShell>
    );
  }

  if (token) {
    return (
      <AuthShell
        title="Verify email"
        description="Use the server verification endpoint for the one-time token in this link."
      >
        <Alert variant="info" className="mt-6">
          <MailCheck aria-hidden="true" />
          <AlertTitle>Token ready to redeem</AlertTitle>
          <AlertDescription>
            Continue to the API verification link. The server will confirm the token and send you
            back to sign-in.
          </AlertDescription>
        </Alert>
        <a
          href={`/api/auth/verify?token=${encodeURIComponent(token)}`}
          className={cn(buttonVariants(), "mt-6 w-full")}
        >
          Verify this email address
        </a>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Verification link required">
      <Alert variant="warning" className="mt-6">
        <Info aria-hidden="true" />
        <AlertTitle>No verification token found</AlertTitle>
        <AlertDescription>
          Open the verification email first. If the link expired, create the account again or request
          a password reset email to confirm ownership.
        </AlertDescription>
      </Alert>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button asChild variant="outline" className="flex-1">
          <Link to="/signup">Create account</Link>
        </Button>
        <Button asChild variant="outline" className="flex-1">
          <Link to="/forgot-password">Forgot password</Link>
        </Button>
      </div>
    </AuthShell>
  );
}
