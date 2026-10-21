import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProductThumbProps {
  src?: string | null;
  name: string;
  className?: string;
  imageClassName?: string;
}

/** Small admin thumbnail with a deterministic letter fallback. */
export function ProductThumb({ src, name, className, imageClassName }: ProductThumbProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const letter = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <span
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-secondary text-sm font-semibold text-primary",
        className,
      )}
      aria-hidden="true"
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          className={cn("size-full object-cover", imageClassName)}
          onError={() => setFailed(true)}
        />
      ) : failed ? (
        <ImageOff className="size-4 text-muted-foreground" />
      ) : (
        letter
      )}
    </span>
  );
}
