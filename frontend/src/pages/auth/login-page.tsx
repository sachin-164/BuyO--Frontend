import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { safeNextPath } from "@/lib/auth-return";
import { getErrorMessage } from "@/lib/errors";
import { AuthShell } from "@/components/auth/auth-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/auth/auth-context";
import { usePageTitle } from "@/hooks/use-page-title";
import type { LoginResponse } from "@/types/account";

const schema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type FormValues = z.infer<typeof schema>;

const STATUS_MESSAGES: Record<
  string,
  { title: string; description?: string; tone: "success" | "info" }
> = {
  success: {
    title: "Email verified",
    description: "Your email address is confirmed. You can now sign in.",
    tone: "success",
  },
  already_verified: {
    title: "Email already verified",
    description: "This email address was already confirmed. You can sign in.",
    tone: "info",
  },
};

export default function LoginPage() {
  usePageTitle("Sign in");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedNext = safeNextPath(searchParams.get("next"));
  const next = requestedNext;
  const verificationStatus = searchParams.get("status") ?? "";
  const { status: authStatus, signIn } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    if (authStatus === "authenticated") {
      navigate(next ?? "/", { replace: true });
    }
  }, [authStatus, navigate, next]);

  const statusMessage = STATUS_MESSAGES[verificationStatus];

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const response = await api.post<LoginResponse>("/api/auth/login", values);
      signIn(response);
      // Replace history so conscious Back does not return to a form that is no
      // longer relevant after authentication.
      navigate(next ?? "/", { replace: true });
    } catch (error) {
      setServerError(getErrorMessage(error));
    }
  });

  return (
    <AuthShell
      title="Sign in"
      description={next ? "Sign in to return to where you left off." : "Access your BuyO account."}
      footer={
        <>
          <p>
            New to BuyO?{" "}
            <Button asChild variant="link" className="h-auto p-0">
              <Link to={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}>
                Create an account
              </Link>
            </Button>
          </p>
          <p className="mt-2">
            <Button asChild variant="link" className="h-auto p-0">
              <Link to="/forgot-password">Forgot your password?</Link>
            </Button>
          </p>
        </>
      }
    >
      {statusMessage ? (
        <Alert variant={statusMessage.tone} className="mt-4" role="status">
          <AlertTitle>{statusMessage.title}</AlertTitle>
          {statusMessage.description ? (
            <AlertDescription>{statusMessage.description}</AlertDescription>
          ) : null}
        </Alert>
      ) : null}

      {serverError ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Sign in failed</AlertTitle>
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}

      <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
        <Field
          id="login-email"
          label="Email"
          required
          error={form.formState.errors.email?.message}
        >
          {({ invalid, described }) => (
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              {...form.register("email")}
              aria-invalid={invalid}
              aria-describedby={described}
            />
          )}
        </Field>

        <Field
          id="login-password"
          label="Password"
          required
          error={form.formState.errors.password?.message}
        >
          {({ invalid, described }) => (
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              {...form.register("password")}
              aria-invalid={invalid}
              aria-describedby={described}
            />
          )}
        </Field>

        <Button type="submit" className="w-full" isLoading={form.formState.isSubmitting}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
