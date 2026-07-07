import type { ReactNode } from "react";

import { LimitedAccessRouteGuard } from "../../features/auth/limited-access-route-guard";
import { NotificationSoundListener } from "./notification-sound-listener";
import { PushEnablePrompt } from "./push-enable-prompt";
import { PushSubscriptionSync } from "./push-subscription-sync";
import { DesktopTopBar } from "./desktop-top-bar";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { MobileHeader } from "./mobile-header";
import { PageLocationActionProvider } from "./page-location-action-context";
import { PageLocationGuide } from "./page-location-guide";
import { PresenceHeartbeat } from "./presence-heartbeat";

type AppShellProps = {
  activeHref?: string;
  children: ReactNode;
};

export function AppShell({ activeHref = "/dashboard", children }: AppShellProps) {
  return (
    <div className="flex min-h-dvh w-full max-w-[100vw] min-w-0 flex-col overflow-x-clip bg-[var(--color-page)] xl:h-dvh xl:max-h-dvh xl:min-h-0">
      <NotificationSoundListener />
      <PushSubscriptionSync />
      <PushEnablePrompt />
      <PresenceHeartbeat />
      <DesktopTopBar activeHref={activeHref} />
      <MobileHeader activeHref={activeHref} />

      <main className="timiq-app-main flex min-h-0 min-w-0 flex-1 flex-col overflow-x-clip">
        <div className="box-border min-h-0 w-full min-w-0 flex-1 overflow-x-clip overflow-y-auto px-[var(--space-page-x)] py-[var(--space-page-y)] pb-[calc(var(--layout-mobile-bottom-nav-height)+var(--layout-mobile-keyboard-pad))] xl:pb-[var(--space-page-y)]">
          <PageLocationActionProvider>
            <PageLocationGuide activeHref={activeHref} />
            <LimitedAccessRouteGuard>{children}</LimitedAccessRouteGuard>
          </PageLocationActionProvider>
        </div>
      </main>

      <MobileBottomNav activeHref={activeHref} />
    </div>
  );
}
