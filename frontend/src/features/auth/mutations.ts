import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, setToken } from "@/lib/api";
import { authKeys } from "@/features/auth/auth-context";
import type {
  AuthMeResponse,
  ChangePasswordResponse,
  MessageResponse,
  UpdateProfileResponse,
} from "@/types/account";

/**
 * PATCH /api/auth/me — name only.
 *
 * The response carries the freshly loaded public user, which is written straight
 * into the auth cache so the header/account page update without a refetch.
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string }) =>
      api.patch<UpdateProfileResponse>("/api/auth/me", input),
    onSuccess: (data) => {
      queryClient.setQueryData<AuthMeResponse>(authKeys.me(), {
        success: true,
        user: data.user,
      });
    },
  });
}

/**
 * POST /api/auth/change-password.
 *
 * The server invalidates every token bound to the old password hash, so the
 * response includes a replacement token for THIS device. Storing it keeps the
 * current session alive while every other device is signed out.
 */
export function useChangePassword() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      api.post<ChangePasswordResponse>("/api/auth/change-password", input),
    onSuccess: (data) => {
      setToken(data.token);
      queryClient.setQueryData<AuthMeResponse>(authKeys.me(), {
        success: true,
        user: data.user,
      });
    },
  });
}

/**
 * POST /api/auth/resend-verification.
 *
 * Deliberately resolves with the same generic message for unknown, verified and
 * unverified addresses — the UI must never claim "we sent it to X" as proof the
 * account exists.
 */
export function useResendVerification() {
  return useMutation({
    mutationFn: (input: { email: string }) =>
      api.post<MessageResponse>("/api/auth/resend-verification", input),
  });
}
