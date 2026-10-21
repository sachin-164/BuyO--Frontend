import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { AuthShell } from "@/components/auth/auth-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

const baseSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(100, "Name must be 100 characters or fewer"),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be 72 bytes or fewer"),
});

const schema = baseSchema
  .extend({
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

type FormValues = z.infer<typeof schema>;

export default function SignupPage() {
  const [searchParams] = useSearchParams();
  const next = searchParams.get("next");
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  const submit = form.handleSubmit(async ({ name, email, password }) => {
    setServerError(null);
    try {
      await api.post("/api/auth/signup", { name, email, password });
      setCreatedEmail(email);
      form.reset();
    } catch (error) {
      setServerError(getErrorMessage(error));
    }
  });

  if (createdEmail) {
    return (
      <AuthShell
        title="Check your email"
        description={`We sent a verification link to ${createdEmail}.`}
      >
        <Alert variant="success" className="mt-6" role="status">
          <CheckCircle2 aria-hidden="true" />
          <AlertTitle>Account created</AlertTitle>
          <AlertDescription>
            Open the verification email to activate the account before signing in.
          </AlertDescription>
        </Alert>
        <Button
          asChild
          className="mt-6 w-full"
        >
          <Link to={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}>
            Go to sign in
          </Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create account"
      description="Signup requires email verification before the account can sign in."
      footer={
        <p>
          Already have an account?{" "}
          <Button asChild variant="link" className="h-auto p-0">
            <Link to={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}>
              Sign in
            </Link>
          </Button>
        </p>
      }
    >
      {serverError ? (
        <Alert variant="destructive" className="mt-4">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Signup failed</AlertTitle>
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}

      <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
        <Field id="signup-name" label="Full name" required error={form.formState.errors.name?.message}>
          {({ invalid, described }) => (
            <Input
              id="signup-name"
              autoComplete="name"
              placeholder="Anita Rao"
              {...form.register("name")}
              aria-invalid={invalid}
              aria-describedby={described}
            />
          )}
        </Field>

        <Field id="signup-email" label="Email" required error={form.formState.errors.email?.message}>
          {({ invalid, described }) => (
            <Input
              id="signup-email"
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
          id="signup-password"
          label="Password"
          required
          hint="At least 8 characters; the server rejects passwords longer than 72 bytes."
          error={form.formState.errors.password?.message}
        >
          {({ invalid, described }) => (
            <Input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              {...form.register("password")}
              aria-invalid={invalid}
              aria-describedby={described}
            />
          )}
        </Field>

        <Field
          id="signup-confirm-password"
          label="Confirm password"
          required
          error={form.formState.errors.confirmPassword?.message}
        >
          {({ invalid, described }) => (
            <Input
              id="signup-confirm-password"
              type="password"
              autoComplete="new-password"
              {...form.register("confirmPassword")}
              aria-invalid={invalid}
              aria-describedby={described}
            />
          )}
        </Field>

        <Button type="submit" className="w-full" isLoading={form.formState.isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
