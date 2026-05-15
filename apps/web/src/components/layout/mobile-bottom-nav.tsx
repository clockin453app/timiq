"use client";

import Link from "next/link";
import {
  Banknote,
  Calendar,
  CalendarRange,
  Clock,
  LayoutDashboard,
  UserRound,
} from "lucide-react";

import { canAccessManagement, useCurrentUser } from "../../features/auth";
import { useT } from "../../lib/i18n";

type MobileBottomNavProps = {
  activeHref?: string;
};

type MobileNavItem = {
  labelKey:
    | "nav.mobile.dashboard"
    | "nav.mobile.clock"
    | "nav.mobile.timesheets"
    | "nav.mobile.week"
    | "nav.mobile.pay"
    | "nav.mobile.more";
  fallback: string;
  href: string;
  Icon: typeof LayoutDashboard;
};

const employeePrimaryLinks: MobileNavItem[] = [
  { labelKey: "nav.mobile.dashboard", fallback: "Dashboard", href: "/dashboard", Icon: LayoutDashboard },
  { labelKey: "nav.mobile.clock", fallback: "Clock", href: "/clock", Icon: Clock },
  { labelKey: "nav.mobile.timesheets", fallback: "Timesheets", href: "/timesheets", Icon: Calendar },
  { labelKey: "nav.mobile.pay", fallback: "Pay", href: "/pay-history", Icon: Banknote },
  { labelKey: "nav.mobile.more", fallback: "More", href: "/profile", Icon: UserRound },
];

const managementPrimaryLinks: MobileNavItem[] = [
  { labelKey: "nav.mobile.dashboard", fallback: "Dashboard", href: "/dashboard", Icon: LayoutDashboard },
  { labelKey: "nav.mobile.clock", fallback: "Clock", href: "/clock", Icon: Clock },
  { labelKey: "nav.mobile.timesheets", fallback: "Timesheets", href: "/timesheets", Icon: Calendar },
  { labelKey: "nav.mobile.week", fallback: "Week", href: "/week-report", Icon: CalendarRange },
  { labelKey: "nav.mobile.more", fallback: "More", href: "/profile", Icon: UserRound },
];

export function MobileBottomNav({ activeHref = "/dashboard" }: MobileBottomNavProps) {
  const t = useT();
  const user = useCurrentUser();
  const links = canAccessManagement(user) ? managementPrimaryLinks : employeePrimaryLinks;

  return (
    <nav
      className="timiq-print-hide-chrome fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-[var(--color-border-dark)] bg-[var(--color-header)] pb-[env(safe-area-inset-bottom,0px)] text-[11px] leading-tight xl:hidden"
    >
      {links.map((item) => {
        const Icon = item.Icon;
        const active = activeHref === item.href;
        return (
          <Link
            className={
              active
                ? "flex min-h-[44px] min-w-0 flex-col items-center justify-center gap-0.5 border-r border-[var(--color-border)] bg-[var(--color-btn-active-bg)] px-1 py-1 text-center font-bold text-[var(--color-text)]"
                : "flex min-h-[44px] min-w-0 flex-col items-center justify-center gap-0.5 border-r border-[var(--color-border)] px-1 py-1 text-center text-[var(--color-text-muted)] hover:bg-[var(--color-cell)]"
            }
            href={item.href}
            key={item.href}
            aria-label={t(item.labelKey, item.fallback)}
          >
            <Icon aria-hidden className="h-[18px] w-[18px] shrink-0 opacity-90" />
            <span className="max-w-full truncate">{t(item.labelKey, item.fallback)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
