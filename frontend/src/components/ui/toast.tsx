import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastTone = "success" | "error" | "info";

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds; use 0 to keep the toast until dismissed. */
  duration?: number;
}

interface ToastItem extends Required<Omit<ToastOptions, "description">> {
  id: number;
  description?: string;
}

type ToastFn = (options: ToastOptions) => void;

const ToastContext = createContext<ToastFn>(() => {
  /* no-op outside the provider (isolated component tests) */
});

export function useToast(): ToastFn {
  return useContext(ToastContext);
}

const ICONS = {
  success: CheckCircle2,
  error: CircleAlert,
  info: Info,
} as const;

const TONES = {
  success: "border-success/30 bg-card text-foreground",
  error: "border-destructive/40 bg-card text-foreground",
  info: "border-primary/25 bg-card text-foreground",
} as const;

const ICON_TONES = {
  success: "text-success",
  error: "text-destructive",
  info: "text-primary",
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = useCallback<ToastFn>(
    ({ title, description, tone = "info", duration = 5000 }) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((current) => [
        ...current.slice(-2),
        { id, title, description, tone, duration },
      ]);
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      timers.current.forEach((timer) => clearTimeout(timer));
      timers.current.clear();
    },
    [],
  );

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[70] flex flex-col items-center gap-2 sm:left-auto sm:right-6 sm:w-full sm:max-w-sm sm:items-stretch"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((item) => {
          const Icon = ICONS[item.tone];
          return (
            <div
              key={item.id}
              role={item.tone === "error" ? "alert" : "status"}
              className={cn(
                "toast-enter pointer-events-auto flex w-full items-start gap-3 rounded-lg border p-4 shadow-lg",
                TONES[item.tone],
              )}
            >
              <Icon
                className={cn("mt-0.5 size-5 shrink-0", ICON_TONES[item.tone])}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{item.title}</p>
                {item.description ? (
                  <p className="mt-0.5 text-sm text-muted-foreground">{item.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="-mr-1 -mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Dismiss notification"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
