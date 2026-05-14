import type { ReactNode } from "react";

import { DesktopSidebar } from "./desktop-sidebar";
import { DesktopTopBar } from "./desktop-top-bar";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { MobileHeader } from "./mobile-header";

type AppShellProps = {
  activeHref?: string;
  children: ReactNode;
};

export function AppShell({ activeHref = "/dashboard", children }: AppShellProps) {
  return (
    <div className="flex min-h-dvh w-full max-w-[100vw] min-w-0 flex-col overflow-x-clip bg-[var(--color-page)] xl:flex xl:flex-row">
      <DesktopSidebar activeHref={activeHref} />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col pb-[var(--layout-mobile-bottom-nav-height)] xl:min-h-dvh xl:pb-0">
        <DesktopTopBar activeHref={activeHref} />
        <MobileHeader activeHref={activeHref} />

        <div className="box-border w-full min-w-0 flex-1 overflow-x-clip px-3 py-4 sm:px-6 sm:py-5 xl:px-8 xl:py-6">
          {children}
        </div>
      </main>

      <MobileBottomNav activeHref={activeHref} />
    </div>
  );
}
