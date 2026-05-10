"use client";

import type { ReactNode } from "react";

import type { SystemRole } from "./roles";
import { hasAnyRole } from "./roles";
import { useCurrentUser } from "./auth-context";

type RoleGuardProps = {
  allowedRoles: SystemRole[];
  children: ReactNode;
  fallback?: ReactNode;
};

export function RoleGuard({
  allowedRoles,
  children,
  fallback = null,
}: RoleGuardProps) {
  const user = useCurrentUser();

  if (!hasAnyRole(user, allowedRoles)) {
    return fallback;
  }

  return children;
}