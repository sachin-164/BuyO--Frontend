import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { RouterProvider } from "react-router-dom";
import { AuthProvider } from "@/features/auth/auth-context";
import { ErrorBoundary } from "@/components/feedback/error-boundary";
import { Spinner } from "@/components/ui/spinner";
import { ToastProvider } from "@/components/ui/toast";
import { queryClient } from "@/lib/query";
import { router } from "@/routes";

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <MotionConfig reducedMotion="user">
          {/* AuthProvider owns the session state used by guards and the header. */}
          <AuthProvider>
            <ToastProvider>
              <RouterProvider
                router={router}
                fallbackElement={
                  <div className="flex min-h-dvh items-center justify-center">
                    <Spinner label="Loading BuyO" />
                  </div>
                }
              />
            </ToastProvider>
          </AuthProvider>
        </MotionConfig>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
