"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { getCurrentUser, type AuthUser } from "./api";
import { AuthUserProvider } from "./auth-context";

type AuthGuardProps = {
  children: ReactNode;
};

export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();

  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadUser() {
      try {
        const currentUser = await getCurrentUser();

        if (!isMounted) {
          return;
        }

        if (!currentUser) {
          router.replace("/login");
          return;
        }

        setUser(currentUser);
      } catch {
        router.replace("/login");
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadUser();

    return () => {
      isMounted = false;
    };
  }, [router]);

  if (isLoading) {
    return (
      <div className="timiq-page flex min-h-screen items-center justify-center">
        <div className="timiq-sheet px-4 py-3 text-sm">
          Loading...
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <AuthUserProvider user={user}>{children}</AuthUserProvider>;
}