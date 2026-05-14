"use client";

import { createContext, useContext, useMemo } from "react";

import type { AuthUser } from "./api";

/** Same-tab signal for AuthGuard to refetch `/me` (e.g. after email verification). */
export const TIMIQ_AUTH_REFRESH_EVENT = "timiq:auth-refresh";

export type AuthSession = {
  user: AuthUser;
  refreshAuthUser: () => Promise<void>;
};

const AuthSessionContext = createContext<AuthSession | null>(null);

type AuthUserProviderProps = {
  children: React.ReactNode;
  user: AuthUser;
  refreshAuthUser: () => Promise<void>;
};

export function AuthUserProvider({ children, refreshAuthUser, user }: AuthUserProviderProps) {
  const value = useMemo(
    () => ({
      user,
      refreshAuthUser,
    }),
    [user, refreshAuthUser],
  );

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useCurrentUser(): AuthUser {
  const session = useContext(AuthSessionContext);

  if (!session) {
    throw new Error("useCurrentUser must be used inside AuthGuard.");
  }

  return session.user;
}

export function useRefreshAuthUser(): () => Promise<void> {
  const session = useContext(AuthSessionContext);

  if (!session) {
    throw new Error("useRefreshAuthUser must be used inside AuthGuard.");
  }

  return session.refreshAuthUser;
}
