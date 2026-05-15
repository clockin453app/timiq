"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { useCurrentUser } from "./auth-context";
import { canAccessManagement } from "./roles";

type AdminDashboardRedirectProps = {
  children: ReactNode;
};

/** Company admins and administrators use Overview as their home surface. */
export function AdminDashboardRedirect({ children }: AdminDashboardRedirectProps) {
  const user = useCurrentUser();
  const router = useRouter();
  const management = canAccessManagement(user);

  useEffect(() => {
    if (management) {
      router.replace("/overview");
    }
  }, [management, router]);

  if (management) {
    return null;
  }

  return <>{children}</>;
}
