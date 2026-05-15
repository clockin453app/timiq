"use client";

import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";

import { LimitedAccessBlocked } from "../../components/auth/limited-access-blocked";
import { LimitedAccessBanner } from "../../components/auth/limited-access-banner";

import { useCurrentUser } from "./auth-context";
import {
  defaultLimitedAccessPath,
  isPathAllowedForLimitedAccess,
  userHasLimitedAccess,
} from "./limited-access";

type LimitedAccessRouteGuardProps = {
  children: ReactNode;
};

export function LimitedAccessRouteGuard({ children }: LimitedAccessRouteGuardProps) {
  const user = useCurrentUser();
  const pathname = usePathname();
  const router = useRouter();
  const limited = userHasLimitedAccess(user);

  useEffect(() => {
    if (!limited) {
      return;
    }
    if (pathname === "/dashboard") {
      router.replace(defaultLimitedAccessPath());
    }
  }, [limited, pathname, router]);

  if (!limited) {
    return children;
  }

  if (!isPathAllowedForLimitedAccess(pathname)) {
    return <LimitedAccessBlocked />;
  }

  return (
    <>
      <LimitedAccessBanner />
      {children}
    </>
  );
}
