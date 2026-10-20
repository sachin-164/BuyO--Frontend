import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("renders its label and the requested variant", () => {
    render(<Button variant="accent">Buy now</Button>);

    const button = screen.getByRole("button", { name: "Buy now" });
    expect(button).toHaveClass("bg-accent");
    expect(button).toBeEnabled();
  });

  it("exposes a busy, disabled state while loading", () => {
    render(<Button isLoading>Saving</Button>);

    const button = screen.getByRole("button", { name: "Saving" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("can render as a child element without losing styles", () => {
    render(
      <Button asChild variant="outline">
        <a href="/shop">Shop</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Shop" });
    expect(link).toHaveClass("inline-flex");
    expect(link).toHaveAttribute("href", "/shop");
  });
});
