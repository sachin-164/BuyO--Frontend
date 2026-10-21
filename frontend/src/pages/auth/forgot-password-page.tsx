import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "react-router-dom";
import { Info } from "lucide-react";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { AuthShell } from "@/components/auth/auth-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

const schema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
});

type FormValues = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [requestAttempted, setRequestAttempted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      // The endpoint is deliberately neutral (it does not reveal whether the
      // address exists), so the UI only reports that the request was made.
      await api.post("/api/auth/forgot-password", values);
      setRequestAttempted(true);
      form.reset();
    } catch (error) {
      setServerError(getErrorMessage(error));
    }
  });

  return (
    <AuthShell
      title="Forgot password"
      description="We can email a one-time reset link when the account matches the address you enter."
      footer={
        <p>
          <Button asChild variant="link" className="h-auto p-0">
            <Link to="/login">Back to sign in</Link>
          </Button>
        </p>
      }
    >
      {requestAttempted ? (
        <Alert variant="info" className="mt-4" role="status">
          <Info aria-hidden="true" />
          <AlertTitle>Reset request received</AlertTitle>
          <AlertDescription>
            If that address belongs to a BuyO account, a reset email is on its way. Check your inbox
            and your spam folder.
          </AlertDescription>
        </Alert>
      ) : null}

      {serverError ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Request failed</AlertTitle>
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}

      <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
        <Field id="forgot-email" label="Email" required error={form.formState.errors.email?.message}>
          {({ invalid, described }) => (
            <Input
              id="forgot-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              {...form.register("email")}
              aria-invalid={invalid}
              aria-describedby={described}
            />
          )}
        </Field>
        <Button type="submit" className="w-full" isLoading={form.formState.isSubmitting}>
          Email reset link
        </Button>
      </form>
    </AuthShell>
  );
}
