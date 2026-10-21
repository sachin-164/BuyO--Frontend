import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { AuthShell } from "@/components/auth/auth-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { usePageTitle } from "@/hooks/use-page-title";

const baseSchema = z.object({
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be 72 bytes or fewer"),
});

const schema = baseSchema
  .extend({ confirmPassword: z.string().min(1, "Confirm your new password") })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

type FormValues = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  usePageTitle("Reset password");
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [resetComplete, setResetComplete] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await api.post("/api/auth/reset-password", { token, password: values.password });
      setResetComplete(true);
      form.reset();
    } catch (error) {
      setServerError(getErrorMessage(error));
    }
  });

  if (!token) {
    return (
      <AuthShell
        title="Reset link required"
        description="Open the password reset email first; this page protects its one-time token."
        footer={
          <p>
            <Button asChild variant="link" className="h-auto p-0">
              <Link to="/forgot-password">Request a new reset link</Link>
            </Button>
          </p>
        }
      >
        <Alert variant="warning" className="mt-6">
          <AlertTitle>No reset token found</AlertTitle>
          <AlertDescription>
            The link in the email is required to prove your identity. Request a new email if this tab
            was opened directly.
          </AlertDescription>
        </Alert>
      </AuthShell>
    );
  }

  if (resetComplete) {
    return (
      <AuthShell title="Password updated" description="Your password has been changed successfully.">
        <Alert variant="success" className="mt-6" role="status">
          <CheckCircle2 aria-hidden="true" />
          <AlertTitle>You can sign in again</AlertTitle>
          <AlertDescription>Use the new password with your existing email address.</AlertDescription>
        </Alert>
        <Button asChild className="mt-6 w-full">
          <Link to="/login">Go to sign in</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset password"
      description="Choose a new password for your BuyO account."
      footer={
        <p>
          <Button asChild variant="link" className="h-auto p-0">
            <Link to="/forgot-password">Request a different reset link</Link>
          </Button>
        </p>
      }
    >
      {serverError ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Reset link could not be used</AlertTitle>
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}

      <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
        <Field
          id="reset-password"
          label="New password"
          required
          hint="At least 8 characters; the server rejects passwords longer than 72 bytes."
          error={form.formState.errors.password?.message}
        >
          {({ invalid, described }) => (
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              {...form.register("password")}
              aria-invalid={invalid}
              aria-describedby={described}
            />
          )}
        </Field>

        <Field
          id="reset-confirm-password"
          label="Confirm new password"
          required
          error={form.formState.errors.confirmPassword?.message}
        >
          {({ invalid, described }) => (
            <Input
              id="reset-confirm-password"
              type="password"
              autoComplete="new-password"
              {...form.register("confirmPassword")}
              aria-invalid={invalid}
              aria-describedby={described}
            />
          )}
        </Field>

        <Button type="submit" className="w-full" isLoading={form.formState.isSubmitting}>
          Update password
        </Button>
      </form>
    </AuthShell>
  );
}
