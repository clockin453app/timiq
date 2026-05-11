import type { ReactNode } from "react";

import { DesktopSidebar } from "./desktop-sidebar";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { MobileHeader } from "./mobile-header";

type AppShellProps = {
  activeHref?: string;
  children: ReactNode;
};

export function AppShell({ activeHref = "/dashboard", children }: AppShellProps) {
  return (
    <div className="flex min-h-screen w-full min-w-0 flex-col overflow-x-clip bg-[var(--color-page)] md:flex md:flex-row">
      <DesktopSidebar activeHref={activeHref} />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col pb-[var(--layout-mobile-bottom-nav-height)] md:min-h-screen md:pb-0">
        <MobileHeader activeHref={activeHref} />

        <div className="box-border w-full min-w-0 flex-1 px-3 py-4 sm:px-6 sm:py-5 md:px-8 md:py-6">
          {children}
        </div>
      </main>

      <MobileBottomNav activeHref={activeHref} />
    </div>
  );
}