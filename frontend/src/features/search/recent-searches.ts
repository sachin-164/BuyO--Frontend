import { useEffect, useState } from "react";

const STORAGE_KEY = "buyo:recent-searches";
const CHANGE_EVENT = "buyo:recent-searches-changed";
const MAX_ITEMS = 6;

function readSearches(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string" && item.trim() !== "")
      .slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

function writeSearches(items: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    /* storage unavailable: recent searches become session-only */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function addRecentSearch(term: string): void {
  const value = term.trim().slice(0, 100);
  if (!value) return;
  const existing = readSearches().filter(
    (item) => item.toLowerCase() !== value.toLowerCase(),
  );
  writeSearches([value, ...existing]);
}

export function clearRecentSearches(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useRecentSearches() {
  const [searches, setSearches] = useState<string[]>(readSearches);

  useEffect(() => {
    const sync = () => setSearches(readSearches());
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) sync();
    };
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return { searches, add: addRecentSearch, clear: clearRecentSearches };
}
