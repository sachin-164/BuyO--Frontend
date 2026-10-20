import { useEffect } from "react";

/** Sets a per-route document title and restores the previous one on unmount. */
export function usePageTitle(title?: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} — BuyO` : "BuyO";
    return () => {
      document.title = previous;
    };
  }, [title]);
}
