import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MailCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useResendVerification } from "@/features/auth/mutations";
import { getErrorMessage } from "@/lib/errors";

const schema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
});

type FormValues = z.infer<typeof schema>;

const COOLDOWN_SECONDS = 60;

interface ResendVerificationFormProps {
  /** Pre-fills the address the user just tried to sign in with. */
  defaultEmail?: string;
  description?: string;
}

/**
 * Requests a fresh verification link.
 *
 * The server answers identically for unknown, already-verified and unverified
 * addresses, and this component repeats that answer verbatim rather than
 * implying the account exists. The 60-second cooldown is a client courtesy on
 * top of the server-side rate limiter — it is not the security control.
 */
export function ResendVerificationForm({
  defaultEmail = "",
  description = "Enter the address you signed up with and we'll send a new verification link.",
}: ResendVerificationFormProps) {
  const mutation = useResendVerification();
  const [outcome, setOutcome] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: defaultEmail },
  });

  useEffect(() => {
    if (defaultEmail) form.setValue("email", defaultEmail, { shouldValidate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultEmail]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const submit = form.handleSubmit(async (values) => {
    setOutcome(null);
    try {
      const response = await mutation.mutateAsync(values);
      setOutcome(response.message);
      setCooldown(COOLDOWN_SECONDS);
    } catch (error) {
      setOutcome(null);
      form.setError("root", { message: getErrorMessage(error) });
    }
  });

  const pending = mutation.isPending;
  const disabled = pending || cooldown > 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{description}</p>

      {outcome ? (
        <Alert variant="success" role="status">
          <MailCheck aria-hidden="true" />
          <AlertTitle>Request received</AlertTitle>
          <AlertDescription>
            {outcome} Check your spam folder if it does not arrive within a few minutes.
          </AlertDescription>
        </Alert>
      ) : null}

      {form.formState.errors.root?.message ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Could not request a new link</AlertTitle>
          <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
        </Alert>
      ) : null}

      <form className="flex flex-wrap items-end gap-3" onSubmit={submit} noValidate>
        <Field
          id="resend-email"
          label="Email"
          required
          className="min-w-0 flex-1"
          error={form.formState.errors.email?.message}
        >
          {({ invalid, described }) => (
            <Input
              id="resend-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              {...form.register("email")}
              aria-invalid={invalid}
              aria-describedby={described}
            />
          )}
        </Field>
        <Button type="submit" variant="outline" isLoading={pending} disabled={disabled}>
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend verification email"}
        </Button>
      </form>
    </div>
  );
}
