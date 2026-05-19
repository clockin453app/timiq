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
import { userHasLimitedAccess } from "../../features/auth/limited-access";
import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";
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

const limitedAccessPrimaryLinks: MobileNavItem[] = [
  { labelKey: "nav.mobile.timesheets", fallback: "Timesheets", href: "/timesheets", Icon: Calendar },
  { labelKey: "nav.mobile.pay", fallback: "Pay", href: "/pay-history", Icon: Banknote },
  { labelKey: "nav.mobile.more", fallback: "Profile", href: "/profile", Icon: UserRound },
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
  const limited = userHasLimitedAccess(user);
  const links = limited
    ? limitedAccessPrimaryLinks
    : canAccessManagement(user)
      ? managementPrimaryLinks
      : employeePrimaryLinks;
  const colClass =
    links.length === 3 ? "grid-cols-3" : links.length === 4 ? "grid-cols-4" : "grid-cols-5";

  return (
    <nav
      className={cn(
        "timiq-print-hide-chrome fixed inset-x-0 bottom-0 z-30 grid pb-[env(safe-area-inset-bottom,0px)] text-[11px] leading-tight xl:hidden",
        colClass,
        uiClasses.bottomNavBar,
      )}
    >
      {links.map((item) => {
        const Icon = item.Icon;
        const active = activeHref === item.href;
        return (
          <Link
            className={cn(
              uiClasses.bottomNavItemBase,
              uiClasses.transitionColors,
              active ? uiClasses.bottomNavItemActive : uiClasses.bottomNavItemIdle,
            )}
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
