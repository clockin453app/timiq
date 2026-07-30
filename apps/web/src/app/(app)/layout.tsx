import type { ReactNode } from "react";

import { AuthGuard } from "../../features/auth";
import { AppShell } from "../../components/layout";

type AuthenticatedAppLayoutProps = {
  children: ReactNode;
};

/**
 * Persistent authenticated chrome. Route-group `(app)` does not affect URLs.
 * AuthGuard + AppShell mount once; only `{children}` swaps on navigation.
 */
export default function AuthenticatedAppLayout({ children }: AuthenticatedAppLayoutProps) {
  return (
    <AuthGuard>
      <AppShell>{children}</AppShell>
    </AuthGuard>
  );
}
