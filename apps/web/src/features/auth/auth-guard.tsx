"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { getCurrentUser, type AuthUser } from "./api";
import { AuthUserProvider, TIMIQ_AUTH_REFRESH_EVENT } from "./auth-context";

type AuthGuardProps = {
  children: ReactNode;
};

export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();

  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const lastBackgroundRefreshAtRef = useRef(0);

  const refreshAuthUser = useCallback(async () => {
    try {
      const currentUser = await getCurrentUser();
      if (!currentUser) {
        router.replace("/login");
        return;
      }
      setUser(currentUser);
    } catch {
      /* keep existing user on transient /me failures (e.g. network blips) */
    }
  }, [router]);

  const throttledBackgroundRefresh = useCallback(() => {
    const now = Date.now();
    if (now - lastBackgroundRefreshAtRef.current < 1500) {
      return;
    }
    lastBackgroundRefreshAtRef.current = now;
    void refreshAuthUser();
  }, [refreshAuthUser]);

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

    void loadUser();

    return () => {
      isMounted = false;
    };
  }, [router]);

  useEffect(() => {
    function onWindowFocus() {
      throttledBackgroundRefresh();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        throttledBackgroundRefresh();
      }
    }

    function onAuthRefreshEvent() {
      throttledBackgroundRefresh();
    }

    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener(TIMIQ_AUTH_REFRESH_EVENT, onAuthRefreshEvent);

    return () => {
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener(TIMIQ_AUTH_REFRESH_EVENT, onAuthRefreshEvent);
    };
  }, [throttledBackgroundRefresh]);

  if (isLoading) {
    return (
      <div className="timiq-page flex min-h-screen items-center justify-center px-4 py-8">
        <div className="timiq-loading-panel text-center text-sm text-[var(--color-text)]">
          <div aria-hidden className="timiq-spinner" />
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <AuthUserProvider refreshAuthUser={refreshAuthUser} user={user}>
      {children}
    </AuthUserProvider>
  );
}
