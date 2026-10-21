import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface AdminStatProps {
  label: string;
  value: string;
  note?: string;
  icon: LucideIcon;
  to?: string;
  className?: string;
}

export function AdminStat({ label, value, note, icon: Icon, to, className }: AdminStatProps) {
  const body = (
    <Card
      className={cn(
        "flex h-full items-start gap-4 p-5 transition-shadow",
        to && "hover:shadow-md focus-within:shadow-md",
        className,
      )}
    >
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="mt-1 block text-2xl font-semibold tabular-nums tracking-tight">
          {value}
        </span>
        {note ? <span className="mt-1 block text-xs text-muted-foreground">{note}</span> : null}
      </span>
    </Card>
  );

  if (!to) return body;
  return (
    <Link
      to={to}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {body}
    </Link>
  );
}
