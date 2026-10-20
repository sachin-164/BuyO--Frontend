import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AboutPage from "@/pages/info/about-page";
import PrivacyPage from "@/pages/info/privacy-page";
import ReturnsPage from "@/pages/info/returns-page";
import { renderWithProviders } from "@/test/render";

describe("informational pages", () => {
  it("marks unpublished company details as owner input", () => {
    renderWithProviders(<AboutPage />, { route: "/about" });

    expect(
      screen.getByRole("heading", { level: 1, name: "About BuyO" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Owner input required")).toBeInTheDocument();
    expect(
      screen.getByText("Legal business name and registered address"),
    ).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "On this page" })).toBeInTheDocument();
  });

  it("labels the privacy draft and does not invent a legal policy", () => {
    renderWithProviders(<PrivacyPage />, { route: "/privacy" });

    expect(screen.getByText("Draft — owner review required")).toBeInTheDocument();
    expect(
      screen.getByText("Lawyer review of the final notice"),
    ).toBeInTheDocument();
    expect(screen.getByText(/stored only as a bcrypt hash/)).toBeInTheDocument();
  });

  it("states that no returns policy has been published", () => {
    renderWithProviders(<ReturnsPage />, { route: "/returns" });

    expect(
      screen.getByText(/No returns, exchange, or refund policy has been published yet/),
    ).toBeInTheDocument();
    expect(screen.getByText("Draft — owner review required")).toBeInTheDocument();
  });
});
