import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Client-side diagnostics only; no secrets or user data are logged.
    console.error("Unhandled UI error", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-dvh items-center justify-center px-4">
          <div role="alert" className="max-w-md text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-accent">
              Something went wrong
            </p>
            <h1 className="mt-3 text-3xl font-semibold">This page could not load</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              The error was contained. Reload to try again — your saved cart and
              account are not affected.
            </p>
            <Button className="mt-6" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
