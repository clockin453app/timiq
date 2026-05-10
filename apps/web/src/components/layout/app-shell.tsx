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
    <div className="min-h-screen bg-[var(--color-page)] md:flex">
      <DesktopSidebar activeHref={activeHref} />

      <main className="min-w-0 flex-1 pb-[var(--layout-mobile-bottom-nav-height)] md:pb-0">
        <MobileHeader activeHref={activeHref} />

        <div className="p-3 md:p-4">{children}</div>
      </main>

      <MobileBottomNav activeHref={activeHref} />
    </div>
  );
}