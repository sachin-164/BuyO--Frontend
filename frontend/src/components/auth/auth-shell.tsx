import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

interface AuthShellProps {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function AuthShell({
  title,
  description,
  children,
  footer,
  className,
}: AuthShellProps) {
  return (
    <div className="mx-auto w-full max-w-md py-4 sm:py-8">
      <div
        className={cn(
          "rounded-lg border border-border bg-card p-6 shadow-sm sm:p-8",
          className,
        )}
      >
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description ? (
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        ) : null}
        {children}
        {footer ? (
          <div className="mt-6 border-t border-border pt-5 text-sm text-muted-foreground">
            {footer}
          </div>
        ) : null}
      </div>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        <Link
          to="/"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Back to BuyO
        </Link>
      </p>
    </div>
  );
}
