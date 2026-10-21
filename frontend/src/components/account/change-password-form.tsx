import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useChangePassword } from "@/features/auth/mutations";
import { ApiError } from "@/lib/api";
import { getApiErrorDetails, getErrorMessage } from "@/lib/errors";

// Server policy: password type, 8..72 characters (middleware/validate.js).
// The confirm field is client-only; the server never receives it.
const schema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z
      .string()
      .min(8, "Use at least 8 characters")
      .max(72, "Use 72 characters or fewer"),
    confirmPassword: z.string().min(1, "Repeat the new password"),
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password different from your current one",
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

type FormValues = z.infer<typeof schema>;

const EMPTY: FormValues = { currentPassword: "", newPassword: "", confirmPassword: "" };

export function ChangePasswordForm() {
  const mutation = useChangePassword();
  const toast = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
  });

  const submit = form.handleSubmit(async (values) => {
    form.clearErrors();
    try {
      await mutation.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      form.reset(EMPTY);
      toast({
        title: "Password updated",
        description: "Other devices have been signed out. This session stays active.",
        tone: "success",
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        const details = getApiErrorDetails<{ code?: string; errors?: string[] }>(error);
        if (details?.code === "INVALID_CURRENT_PASSWORD") {
          form.setError("currentPassword", { message: "Current password is incorrect" });
          return;
        }
        if (details?.errors?.length) {
          form.setError("newPassword", { message: details.errors[0] });
          return;
        }
      }
      if (error instanceof ApiError && error.status === 401) {
        form.setError("root", {
          message: "Your session expired. Sign in again to change your password.",
        });
        return;
      }
      if (error instanceof ApiError && error.status === 409) {
        form.setError("root", {
          message: "Your password changed elsewhere. Reload the page and sign in again.",
        });
        return;
      }
      form.setError("root", { message: getErrorMessage(error) });
    }
  });

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <Field
        id="current-password"
        label="Current password"
        required
        error={form.formState.errors.currentPassword?.message}
      >
        {({ invalid, described }) => (
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            {...form.register("currentPassword")}
            aria-invalid={invalid}
            aria-describedby={described}
          />
        )}
      </Field>

      <Field
        id="new-password"
        label="New password"
        required
        hint="At least 8 characters."
        error={form.formState.errors.newPassword?.message}
      >
        {({ invalid, described }) => (
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            {...form.register("newPassword")}
            aria-invalid={invalid}
            aria-describedby={described}
          />
        )}
      </Field>

      <Field
        id="confirm-password"
        label="Confirm new password"
        required
        error={form.formState.errors.confirmPassword?.message}
      >
        {({ invalid, described }) => (
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            {...form.register("confirmPassword")}
            aria-invalid={invalid}
            aria-describedby={described}
          />
        )}
      </Field>

      {form.formState.errors.root?.message ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Password could not be changed</AlertTitle>
          <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" isLoading={mutation.isPending}>
        Update password
      </Button>
    </form>
  );
}
