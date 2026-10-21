import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AddressForm,
  addressFormSchema,
} from "@/components/commerce/address-form";
import { jsonResponse, renderWithProviders } from "@/test/render";
import type { Address } from "@/types/account";

const ADDRESS: Address = {
  id: 7,
  fullName: "Anita Rao",
  phone: "9876543210",
  line1: "12 Rose Street",
  line2: "Kalyani Nagar",
  city: "Pune",
  state: "Maharashtra",
  pincode: "411006",
  isDefault: false,
  label: "Home",
};

function installFetch({ responseData }: { responseData?: unknown } = {}) {
  const requests: Array<{ url: URL; method: string; body?: string }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    requests.push({ url, method, body });

    if (method === "POST" && url.pathname === "/api/addresses") {
      if (responseData) return jsonResponse(responseData, 400);
      return jsonResponse({ success: true, message: "Address saved", address: ADDRESS }, 201);
    }
    if (method === "PUT" && url.pathname === "/api/addresses/7") {
      return jsonResponse({
        success: true,
        message: "Address updated",
        address: { ...ADDRESS, pincode: "411015" },
      });
    }
    return jsonResponse({ success: false, message: "Not found" }, 404);
  });

  vi.stubGlobal("fetch", fetchMock);
  return requests;
}

describe("AddressForm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces client-side validation for every required field", async () => {
    const user = userEvent.setup();
    const requests = installFetch();
    renderWithProviders(<AddressForm />);

    await user.click(screen.getByRole("button", { name: "Save address" }));

    expect(
      screen.getByText(/Full name needs at least 2 characters/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Enter 10-15 digits/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Address line 1 needs at least 3 characters/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/City needs at least 2 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/State needs at least 2 characters/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Enter a 6-digit Indian PIN code/i),
    ).toBeInTheDocument();
    // Six field-level alerts, and no request reached the server.
    expect(screen.getAllByRole("alert")).toHaveLength(6);
    expect(requests).toHaveLength(0);
  });

  it.each([
    ["address-phone", "98765", /Enter 10-15 digits/i],
    ["address-pincode", "12345", /Enter a 6-digit Indian PIN code/i],
  ])("validates phone and PIN formats", async (id, value, expected) => {
    const user = userEvent.setup();
    installFetch();
    renderWithProviders(<AddressForm />);

    const element = document.getElementById(id);
    expect(element).not.toBeNull();
    await user.type(element as HTMLElement, value);
    await user.click(screen.getByRole("button", { name: "Save address" }));

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("posts a valid address with optional fields trimmed", async () => {
    const user = userEvent.setup();
    const requests = installFetch();
    const onSaved = vi.fn();
    renderWithProviders(<AddressForm onSaved={onSaved} />);

    await user.type(screen.getByLabelText(/Full name/i), "Anita Rao");
    await user.type(screen.getByLabelText(/Phone/i), "9876543210");
    await user.type(screen.getByLabelText(/Address line 1/i), "12 Rose Street");
    await user.type(screen.getByLabelText(/Address line 2/i), "Kalyani Nagar");
    await user.type(screen.getByLabelText(/City/i), "Pune");
    await user.type(screen.getByLabelText(/State/i), "Maharashtra");
    await user.type(screen.getByLabelText(/PIN code/i), "411006");

    await user.click(screen.getByRole("button", { name: "Save address" }));

    expect(await screen.findByText("Address saved")).toBeInTheDocument();
    const post = requests.find(
      (request) => request.method === "POST" && request.url.pathname === "/api/addresses",
    );
    expect(JSON.parse(post?.body ?? "{}")).toEqual({
      fullName: "Anita Rao",
      phone: "9876543210",
      line1: "12 Rose Street",
      line2: "Kalyani Nagar",
      city: "Pune",
      state: "Maharashtra",
      pincode: "411006",
      isDefault: false,
    });
    expect(onSaved).toHaveBeenCalledWith(ADDRESS);
  });

  it("maps server validation errors back onto the matching fields", async () => {
    const user = userEvent.setup();
    installFetch({
      responseData: {
        success: false,
        message: "Validation failed",
        errors: [
          "phone must be 10-15 digits (spaces, hyphens and a leading + are allowed)",
        ],
      },
    });
    renderWithProviders(<AddressForm />);

    await user.type(screen.getByLabelText(/Full name/i), "Anita Rao");
    await user.type(screen.getByLabelText(/Phone/i), "9876543210");
    await user.type(screen.getByLabelText(/Address line 1/i), "12 Rose Street");
    await user.type(screen.getByLabelText(/City/i), "Pune");
    await user.type(screen.getByLabelText(/State/i), "Maharashtra");
    await user.type(screen.getByLabelText(/PIN code/i), "411006");

    await user.click(screen.getByRole("button", { name: "Save address" }));

    expect(
      await screen.findByText(
        /must be 10-15 digits \(spaces, hyphens and a leading \+ are allowed\)/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Please correct the highlighted fields/i),
    ).toBeInTheDocument();
  });

  it("keeps the default checkbox locked when editing the active default", () => {
    installFetch();
    renderWithProviders(<AddressForm address={{ ...ADDRESS, isDefault: true }} />);

    const checkbox = screen.getByRole("checkbox", { name: /Use as default address/i });
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeDisabled();
  });

  it("lets a non-default address be promoted to default", () => {
    installFetch();
    renderWithProviders(<AddressForm address={ADDRESS} />);

    const checkbox = screen.getByRole("checkbox", { name: /Use as default address/i });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toBeEnabled();
  });
});

describe("address schema", () => {
  it("accepts phone numbers with spaces and hyphens", () => {
    expect(addressFormSchema.shape.phone.safeParse("987 654-3210").success).toBe(true);
  });

  it("rejects PIN codes that start with 0", () => {
    expect(addressFormSchema.shape.pincode.safeParse("098765").success).toBe(false);
  });

  it("caps optional fields at server limits", () => {
    expect(addressFormSchema.shape.label.safeParse("x".repeat(51)).success).toBe(false);
    expect(addressFormSchema.shape.line2.safeParse("x".repeat(256)).success).toBe(false);
  });
});
