import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { RouterProvider } from "react-router-dom";
import { ErrorBoundary } from "@/components/feedback/error-boundary";
import { Spinner } from "@/components/ui/spinner";
import { queryClient } from "@/lib/query";
import { router } from "@/routes";

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <MotionConfig reducedMotion="user">
          <RouterProvider
            router={router}
            fallbackElement={
              <div className="flex min-h-dvh items-center justify-center">
                <Spinner label="Loading BuyO" />
              </div>
            }
          />
        </MotionConfig>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
