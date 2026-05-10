"use client";

import { createContext, useContext } from "react";

import type { AuthUser } from "./api";

const AuthUserContext = createContext<AuthUser | null>(null);

type AuthUserProviderProps = {
  children: React.ReactNode;
  user: AuthUser;
};

export function AuthUserProvider({ children, user }: AuthUserProviderProps) {
  return (
    <AuthUserContext.Provider value={user}>
      {children}
    </AuthUserContext.Provider>
  );
}

export function useCurrentUser() {
  const user = useContext(AuthUserContext);

  if (!user) {
    throw new Error("useCurrentUser must be used inside AuthGuard.");
  }

  return user;
}