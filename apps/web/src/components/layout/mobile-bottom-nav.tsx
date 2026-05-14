"use client";

import Link from "next/link";

import { useT } from "../../lib/i18n";

type MobileBottomNavProps = {
  activeHref?: string;
};

const mobilePrimaryLinks = [
  { labelKey: "nav.mobile.dashboard" as const, fallback: "Dashboard", href: "/dashboard" },
  { labelKey: "nav.mobile.clock" as const, fallback: "Clock", href: "/clock" },
  { labelKey: "nav.mobile.timesheets" as const, fallback: "Timesheets", href: "/timesheets" },
  { labelKey: "nav.mobile.week" as const, fallback: "Week", href: "/week-report" },
  { labelKey: "nav.mobile.more" as const, fallback: "More", href: "/profile" },
];

export function MobileBottomNav({ activeHref = "/dashboard" }: MobileBottomNavProps) {
  const t = useT();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-[var(--color-border-dark)] bg-[var(--color-header)] pb-[env(safe-area-inset-bottom,0px)] text-[11px] leading-tight xl:hidden"
    >
      {mobilePrimaryLinks.map((item) => (
        <Link
          className={
            item.href === activeHref
              ? "flex min-h-[44px] min-w-0 flex-col items-center justify-center border-r border-[var(--color-border)] bg-[var(--color-btn-active-bg)] px-1 py-1.5 text-center font-bold text-[var(--color-text)]"
              : "flex min-h-[44px] min-w-0 flex-col items-center justify-center border-r border-[var(--color-border)] px-1 py-1.5 text-center text-[var(--color-text-muted)] hover:bg-[var(--color-cell)]"
          }
          href={item.href}
          key={item.href}
        >
          {t(item.labelKey, item.fallback)}
        </Link>
      ))}
    </nav>
  );
}
