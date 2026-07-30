"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { canAccessManagement, useCurrentUser } from "../../features/auth";
import { LimitedAccessRouteGuard } from "../../features/auth/limited-access-route-guard";
import { cn } from "../../lib/cn";
import { NotificationSoundListener } from "./notification-sound-listener";
import { PushEnablePrompt } from "./push-enable-prompt";
import { PushSubscriptionSync } from "./push-subscription-sync";
import { DesktopSidebar } from "./desktop-sidebar";
import { DesktopTopBar } from "./desktop-top-bar";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { MobileHeader } from "./mobile-header";
import { PageLocationActionProvider } from "./page-location-action-context";
import { PageLocationGuide } from "./page-location-guide";
import { PresenceHeartbeat } from "./presence-heartbeat";

type AppShellProps = {
  /** Optional override for tests; defaults to the current pathname. */
  activeHref?: string;
  children: ReactNode;
};

export function AppShell({ activeHref, children }: AppShellProps) {
  const pathname = usePathname() || "/dashboard";
  const resolvedActiveHref = activeHref ?? pathname;
  const user = useCurrentUser();
  const hasMobileBottomNav = !canAccessManagement(user);

  return (
    <div
      className="flex min-h-dvh w-full min-w-0 max-w-full flex-col overflow-x-hidden bg-[var(--color-app-page)] lg:h-dvh lg:max-h-dvh lg:min-h-0 lg:overflow-hidden"
      data-timiq-app-shell
    >
      <NotificationSoundListener />
      <PushSubscriptionSync />
      <PushEnablePrompt />
      <PresenceHeartbeat />
      <DesktopTopBar activeHref={resolvedActiveHref} />
      <MobileHeader activeHref={resolvedActiveHref} />

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <DesktopSidebar activeHref={resolvedActiveHref} />
        <main
          className="timiq-app-main flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          id="main-content"
        >
          <div
            className={cn(
              "box-border min-h-0 w-full min-w-0 max-w-full flex-1 overflow-auto px-[var(--space-page-x)] py-[var(--space-page-y)]",
              hasMobileBottomNav
                ? "scroll-pb-[calc(var(--layout-mobile-bottom-nav-height)+var(--layout-mobile-keyboard-pad))] pb-[calc(var(--layout-mobile-bottom-nav-height)+var(--layout-mobile-keyboard-pad))] lg:scroll-pb-[var(--space-page-y)] lg:pb-[var(--space-page-y)]"
                : "pb-[var(--space-page-y)]",
            )}
          >
            <PageLocationActionProvider>
              <PageLocationGuide activeHref={resolvedActiveHref} />
              <LimitedAccessRouteGuard>{children}</LimitedAccessRouteGuard>
            </PageLocationActionProvider>
          </div>
        </main>
      </div>

      <MobileBottomNav activeHref={resolvedActiveHref} />
    </div>
  );
}
