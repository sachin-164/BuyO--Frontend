import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FieldChildren =
  | ReactNode
  | ((props: { invalid: boolean; described: string | undefined }) => ReactNode);

interface FieldProps {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  optional?: boolean;
  className?: string;
  children: FieldChildren;
}

export function Field({
  id,
  label,
  error,
  hint,
  required = false,
  optional = false,
  className,
  children,
}: FieldProps) {
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const described = errorId || hintId;
  const invalid = Boolean(error);

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
          {required ? (
            <>
              {" "}
              <span aria-hidden="true" className="text-destructive">
                *
              </span>
              <span className="sr-only"> (required)</span>
            </>
          ) : null}
        </Label>
        {optional ? (
          <span className="text-xs text-muted-foreground">Optional</span>
        ) : null}
      </div>
      {typeof children === "function" ? children({ invalid, described }) : children}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
