import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/features/auth/auth-context";
import { useUpdateProfile } from "@/features/auth/mutations";
import { ApiError } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

// Mirrors the server rule (middleware/validate.js + PATCH /api/auth/me):
// string, 1..100 characters, trimmed. Email is not editable here — changing it
// needs a re-verification flow the backend does not expose.
const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(100, "Name must be 100 characters or fewer"),
});

type FormValues = z.infer<typeof schema>;

export function ProfileForm() {
  const { user } = useAuth();
  const mutation = useUpdateProfile();
  const toast = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: user?.name ?? "" },
  });

  useEffect(() => {
    if (user) form.reset({ name: user.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.name]);

  const submit = form.handleSubmit(async (values) => {
    form.clearErrors("root");
    try {
      await mutation.mutateAsync({ name: values.name });
      form.reset({ name: values.name });
      toast({
        title: "Profile updated",
        description: "Your display name was saved.",
        tone: "success",
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        form.setError("root", { message: "Your session expired. Sign in again to save changes." });
        return;
      }
      form.setError("root", { message: getErrorMessage(error) });
    }
  });

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <Field
        id="profile-name"
        label="Display name"
        required
        error={form.formState.errors.name?.message}
        hint="Shown on your account page. Your email address cannot be changed here."
      >
        {({ invalid, described }) => (
          <Input
            id="profile-name"
            autoComplete="name"
            maxLength={100}
            {...form.register("name")}
            aria-invalid={invalid}
            aria-describedby={described}
          />
        )}
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" isLoading={mutation.isPending} disabled={!form.formState.isDirty}>
          Save changes
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => form.reset({ name: user?.name ?? "" })}
          disabled={!form.formState.isDirty || mutation.isPending}
        >
          Discard
        </Button>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Email: {user?.email}
        </p>
      </div>

      {form.formState.errors.root?.message ? (
        <p role="alert" className="text-sm text-destructive">
          {form.formState.errors.root.message}
        </p>
      ) : null}
    </form>
  );
}
