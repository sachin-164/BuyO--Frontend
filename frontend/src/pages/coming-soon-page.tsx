import { Construction } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";

interface ComingSoonPageProps {
  title: string;
  description: string;
  phase: string;
}

/**
 * Honest placeholder for routes whose feature lands in a later migration phase.
 * It is never linked as if it were finished functionality.
 */
export default function ComingSoonPage({ title, description, phase }: ComingSoonPageProps) {
  usePageTitle(title);
  return (
    <div className="container-page py-20">
      <div className="mx-auto max-w-xl text-center">
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-secondary text-primary">
          <Construction className="size-6" aria-hidden="true" />
        </span>
        <Badge variant="secondary" className="mt-5">
          {phase}
        </Badge>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
          {description}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link to="/">Back to home</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/shop">Browse shop</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
