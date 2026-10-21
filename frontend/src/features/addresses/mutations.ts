import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  AddressDeleteResponse,
  AddressMutationResponse,
  AddressInput,
} from "@/types/account";
import { addressKeys } from "@/features/addresses/queries";

export function useCreateAddress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddressInput) => api.post<AddressMutationResponse>("/api/addresses", input),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: addressKeys.all }),
  });
}

export function useUpdateAddress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: number; data: Partial<AddressInput> }) =>
      api.put<AddressMutationResponse>(`/api/addresses/${input.id}`, input.data),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: addressKeys.all }),
  });
}

export function useDeleteAddress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<AddressDeleteResponse>(`/api/addresses/${id}`),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: addressKeys.all }),
  });
}

export function useSetDefaultAddress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api.put<AddressMutationResponse>(`/api/addresses/${id}/default`, {}),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: addressKeys.all }),
  });
}
