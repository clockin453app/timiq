import type { ReactNode } from "react";

import { LimitedAccessRouteGuard } from "../../features/auth/limited-access-route-guard";
import { DesktopTopBar } from "./desktop-top-bar";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { MobileHeader } from "./mobile-header";

type AppShellProps = {
  activeHref?: string;
  children: ReactNode;
};

export function AppShell({ activeHref = "/dashboard", children }: AppShellProps) {
  return (
    <div className="flex min-h-dvh w-full max-w-[100vw] min-w-0 flex-col overflow-x-clip bg-[var(--color-page)] xl:h-dvh xl:max-h-dvh xl:min-h-0">
      <DesktopTopBar activeHref={activeHref} />
      <MobileHeader activeHref={activeHref} />

      <main className="timiq-app-main flex min-h-0 min-w-0 flex-1 flex-col overflow-x-clip">
        <div className="box-border min-h-0 w-full min-w-0 flex-1 overflow-x-clip overflow-y-auto px-3 py-4 pb-[calc(var(--layout-mobile-bottom-nav-height)+var(--layout-mobile-keyboard-pad))] sm:px-6 sm:py-5 xl:px-8 xl:py-6 xl:pb-6">
          <LimitedAccessRouteGuard>{children}</LimitedAccessRouteGuard>
        </div>
      </main>

      <MobileBottomNav activeHref={activeHref} />
    </div>
  );
}
