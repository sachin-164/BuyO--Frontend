import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AddressListResponse } from "@/types/account";

export const addressKeys = {
  all: ["addresses"] as const,
  item: (id: number) => [...addressKeys.all, "item", id] as const,
};

export function useAddresses({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<AddressListResponse>({
    queryKey: addressKeys.all,
    queryFn: ({ signal }) => api.get<AddressListResponse>("/api/addresses", signal),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}
