import { useEffect, useId, useRef, useState } from "react";
import { Clock3, Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { useProducts } from "@/features/catalog/queries";
import { useRecentSearches } from "@/features/search/recent-searches";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/catalog";

type Suggestion =
  | { kind: "recent"; value: string }
  | { kind: "product"; product: Product }
  | { kind: "search"; value: string };

interface SearchComboboxProps {
  autoFocus?: boolean;
  size?: "default" | "large";
  className?: string;
  onNavigate?: () => void;
}

/**
 * Accessible search combobox. Suggestions are real catalog results (the API has
 * no dedicated suggestion endpoint); recent searches are stored locally.
 */
export function SearchCombobox({
  autoFocus = false,
  size = "default",
  className,
  onNavigate,
}: SearchComboboxProps) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const debounced = useDebouncedValue(value.trim(), 250);
  const suggestionsQuery = useProducts(
    { q: debounced, limit: 5, sort: "newest", page: 1 },
    { enabled: debounced.length >= 2 },
  );
  const { searches, add } = useRecentSearches();

  const isTyping = value.trim().length > 0;
  const items: Suggestion[] = isTyping
    ? [
        ...(suggestionsQuery.data?.products ?? []).map(
          (product): Suggestion => ({ kind: "product", product }),
        ),
        ...(value.trim()
          ? [{ kind: "search", value: value.trim() } satisfies Suggestion]
          : []),
      ]
    : searches.map((term): Suggestion => ({ kind: "recent", value: term }));

  const showPanel =
    open &&
    (isTyping || items.length > 0) &&
    (isTyping || searches.length > 0);

  useEffect(() => {
    setActiveIndex(-1);
  }, [value]);

  useEffect(() => {
    if (activeIndex >= items.length) setActiveIndex(items.length - 1);
  }, [activeIndex, items.length]);

  function closePanel() {
    setOpen(false);
    setActiveIndex(-1);
  }

  function submitSearch(term: string) {
    const query = term.trim();
    if (!query) return;
    add(query);
    navigate(`/search?q=${encodeURIComponent(query)}`);
    setValue("");
    closePanel();
    onNavigate?.();
  }

  function selectSuggestion(item: Suggestion) {
    if (item.kind === "product") {
      navigate(`/product/${encodeURIComponent(item.product.slug)}`);
      setValue("");
      closePanel();
      onNavigate?.();
      return;
    }
    submitSearch(item.value);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      if (items.length === 0) return;
      setActiveIndex((current) => (current + 1) % items.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) setOpen(true);
      if (items.length === 0) return;
      setActiveIndex((current) => (current <= 0 ? items.length - 1 : current - 1));
      return;
    }
    if (event.key === "Escape") {
      if (showPanel) {
        event.preventDefault();
        closePanel();
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (open && activeIndex >= 0 && items[activeIndex]) {
        selectSuggestion(items[activeIndex]);
      } else {
        submitSearch(value);
      }
    }
  }

  const activeOptionId =
    activeIndex >= 0 && items[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined;

  return (
    <div
      ref={containerRef}
      className={cn("relative w-full", className)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          closePanel();
        }
      }}
    >
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submitSearch(value);
        }}
      >
        <Search
          className={cn(
            "pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground",
            size === "large" && "size-5",
          )}
          aria-hidden="true"
        />
        <Input
          type="search"
          role="combobox"
          aria-label="Search products"
          aria-autocomplete="list"
          aria-expanded={showPanel}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          placeholder="Search products, categories…"
          value={value}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(
            "pr-9 pl-9",
            size === "large" && "h-12 pl-11 text-base",
          )}
        />
        {value ? (
          <button
            type="button"
            aria-label="Clear search"
            className="absolute right-2 top-1/2 z-10 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            onClick={() => {
              setValue("");
              setOpen(true);
            }}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </form>

      {showPanel ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-50 overflow-hidden rounded-lg border border-border bg-card shadow-lg animate-fade-in">
          <ul
            id={listboxId}
            role="listbox"
            aria-label={isTyping ? "Product suggestions" : "Recent searches"}
            className="max-h-[min(24rem,60vh)] overflow-y-auto p-1.5"
          >
            {!isTyping ? (
              <li
                className="flex items-center justify-between px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                aria-hidden="true"
              >
                <span>Recent searches</span>
                <Clock3 className="size-3.5" />
              </li>
            ) : null}

            {items.map((item, index) => {
              const selected = index === activeIndex;
              const sharedProps = {
                id: `${listboxId}-option-${index}`,
                role: "option" as const,
                "aria-selected": selected,
                onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
                onMouseEnter: () => setActiveIndex(index),
                onClick: () => selectSuggestion(item),
                className: cn(
                  "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm outline-none",
                  selected ? "bg-secondary text-foreground" : "text-foreground/90",
                ),
              };

              if (item.kind === "recent") {
                return (
                  <li key={`recent-${item.value}`} {...sharedProps}>
                    <Clock3 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate">{item.value}</span>
                  </li>
                );
              }

              if (item.kind === "search") {
                return (
                  <li key="search-action" {...sharedProps}>
                    <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate">
                      Search for <strong className="font-semibold">“{item.value}”</strong>
                    </span>
                  </li>
                );
              }

              return (
                <li key={`product-${item.product.id}`} {...sharedProps}>
                  <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded bg-secondary">
                    {item.product.image ? (
                      <img
                        src={item.product.image}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="size-full object-cover"
                      />
                    ) : (
                      <Search className="size-4 text-muted-foreground" aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.product.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.product.category}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold">
                    {formatPrice(item.product.sellingPrice)}
                  </span>
                </li>
              );
            })}
          </ul>

          {isTyping ? (
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground" role="status">
              {suggestionsQuery.isFetching
                ? "Searching…"
                : suggestionsQuery.isError
                  ? "Suggestions are unavailable — press Enter to search."
                  : suggestionsQuery.isSuccess && suggestionsQuery.data.products.length === 0
                    ? "No matching products yet — press Enter to search."
                    : "Use ↑ ↓ to choose, Enter to open."}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
