"use client";


import Link from "next/link";

import {
  employeeNavigation,
  getNavigationForRole,
  managementNavigation,
} from "../../config/navigation";
import { useCurrentUser, UserAccountSummary } from "../../features/auth";

type DesktopSidebarProps = {
  activeHref?: string;
};

export function DesktopSidebar({ activeHref = "/dashboard" }: DesktopSidebarProps) {
  const user = useCurrentUser();

  const employeeLinks = getNavigationForRole(
    employeeNavigation,
    user.system_role,
  );

  const managementLinks = getNavigationForRole(
    managementNavigation,
    user.system_role,
  );

  function navLinkClass(href: string) {
    const active = href === activeHref;
    return [
      "block rounded-[var(--radius-md)] border px-2.5 py-2 text-[var(--color-text-muted)] transition-colors",
      active
        ? "border-[var(--color-border-dark)] bg-[var(--color-header)] font-semibold text-[var(--color-text)]"
        : "border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-header)]",
    ].join(" ");
  }

  return (
    <aside className="hidden min-h-screen w-[var(--layout-sidebar-width)] flex-col border-r border-[var(--color-border)] bg-[var(--color-sheet)] text-sm md:flex">
      <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-4">
        <p className="text-base font-bold tracking-tight text-[var(--color-text)]">TimIQ</p>
        <p className="mt-1 text-xs leading-snug text-[var(--color-text-soft)]">
          Payroll & workforce
        </p>
      </div>

      <nav className="flex-1 px-2.5 py-4">
        <div className="space-y-1">
          {employeeLinks.map((item) => (
            <Link className={navLinkClass(item.href)} href={item.href} key={item.href}>
              {item.label}
            </Link>
          ))}
        </div>

        {managementLinks.length > 0 ? (
          <div className="mt-6 border-t border-[var(--color-border)] pt-4">
            <p className="mb-2 px-2.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
              Management
            </p>

            <div className="space-y-1">
              {managementLinks.map((item) => (
                <Link className={navLinkClass(item.href)} href={item.href} key={item.href}>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </nav>

      <UserAccountSummary />
    </aside>
  );
}