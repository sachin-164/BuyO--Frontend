import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface QuantitySelectorProps {
  value: number;
  onChange: (value: number) => void;
  max: number;
  min?: number;
  disabled?: boolean;
  id?: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function QuantitySelector({
  value,
  onChange,
  max,
  min = 1,
  disabled = false,
  id = "quantity",
}: QuantitySelectorProps) {
  const [text, setText] = useState(String(value));
  const upperBound = Math.max(min, max);

  useEffect(() => {
    setText(String(value));
  }, [value]);

  function commit(nextText: string) {
    const parsed = Number.parseInt(nextText, 10);
    const next = Number.isFinite(parsed) ? clamp(parsed, min, upperBound) : value;
    onChange(next);
    setText(String(next));
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-muted-foreground">
        Quantity
      </label>
      <div className="inline-flex items-center rounded-md border border-input bg-card">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10 rounded-r-none"
          aria-label="Decrease quantity"
          disabled={disabled || value <= min}
          onClick={() => onChange(clamp(value - 1, min, upperBound))}
        >
          <Minus aria-hidden="true" />
        </Button>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          aria-label="Quantity"
          value={text}
          disabled={disabled}
          onChange={(event) => setText(event.target.value.replace(/[^\d]/g, ""))}
          onBlur={() => commit(text)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit(text);
            }
          }}
          className={cn(
            "h-10 w-12 border-x border-input bg-transparent text-center text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          )}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10 rounded-l-none"
          aria-label="Increase quantity"
          disabled={disabled || value >= upperBound}
          onClick={() => onChange(clamp(value + 1, min, upperBound))}
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>
      {max >= 99 ? (
        <p className="mt-1 text-xs text-muted-foreground">Maximum 99 per order.</p>
      ) : null}
    </div>
  );
}
