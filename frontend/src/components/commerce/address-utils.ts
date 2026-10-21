interface AddressLike {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
  label?: string | null;
}

/** Ordered physical lines for an address card or checkout summary. */
export function addressLines(address: AddressLike): string[] {
  const lines = [
    address.line1,
    address.line2?.trim() ? address.line2.trim() : null,
    [address.city, address.state, address.pincode].filter(Boolean).join(", "),
    address.phone,
  ].filter((line): line is string => Boolean(line && line.trim()));
  return lines;
}
