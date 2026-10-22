import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, clearToken, getToken, onUnauthorized, setToken } from "@/lib/api";
import { mergeGuestCart } from "@/features/cart/merge";
import type { AuthMeResponse, LoginResponse, User } from "@/types/account";

export const authKeys = {
  all: ["auth"] as const,
  me: () => [...authKeys.all, "me"] as const,
};

type AuthStatus = "loading" | "authenticated" | "anonymous" | "error";

interface AuthContextValue {
  user: User | null;
  /** Token presence is useful for actions while the profile request is still loading. */
  hasToken: boolean;
  status: AuthStatus;
  error: unknown;
  signIn: (response: LoginResponse) => void;
  signOut: () => void;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const USER_QUERY_KEYS = ["cart", "wishlist", "addresses", "orders"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const clearing = useRef(false);
  const mergingGuestCart = useRef(false);

  const meQuery = useQuery<AuthMeResponse>({
    queryKey: authKeys.me(),
    queryFn: ({ signal }) => api.get<AuthMeResponse>("/api/auth/me", signal),
    enabled: Boolean(token),
    retry: false,
    staleTime: 60_000,
  });

  const removePrivateQueries = useCallback(() => {
    queryClient.removeQueries({ queryKey: authKeys.all });
    for (const key of USER_QUERY_KEYS) {
      queryClient.removeQueries({ queryKey: [key] });
    }
  }, [queryClient]);

  const signOut = useCallback(() => {
    clearToken();
    setTokenState(null);
    removePrivateQueries();
  }, [removePrivateQueries]);

  useEffect(() => {
    return onUnauthorized(() => {
      if (clearing.current) return;
      clearing.current = true;
      clearToken();
      setTokenState(null);
      removePrivateQueries();
      clearing.current = false;
    });
  }, [removePrivateQueries]);

  const signIn = useCallback(
    (response: LoginResponse) => {
      setToken(response.token);
      setTokenState(response.token);
      queryClient.setQueryData<AuthMeResponse>(authKeys.me(), {
        success: true,
        user: response.user,
      });
    },
    [queryClient],
  );

  // Adopt the browser's guest cart after sign-in (and after a reload while
  // still signed in). Failures leave the local copy untouched for a retry.
  useEffect(() => {
    if (!token || mergingGuestCart.current) return;
    mergingGuestCart.current = true;
    void mergeGuestCart(queryClient).finally(() => {
      mergingGuestCart.current = false;
    });
  }, [token, queryClient]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: authKeys.me() });
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(() => {
    const user = meQuery.data?.user ?? null;
    let status: AuthStatus;
    if (!token) {
      status = "anonymous";
    } else if (user) {
      status = "authenticated";
    } else if (meQuery.isError) {
      status =
        meQuery.error instanceof ApiError && meQuery.error.status === 401
          ? "anonymous"
          : "error";
    } else {
      status = "loading";
    }

    return {
      user,
      hasToken: Boolean(token),
      status,
      error: meQuery.error,
      signIn,
      signOut,
      refresh,
    };
  }, [meQuery.data, meQuery.error, meQuery.isError, refresh, signIn, signOut, token]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
