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

  return (
    <aside className="hidden min-h-screen w-[var(--layout-sidebar-width)] flex-col border-r border-[var(--color-border-dark)] bg-[var(--color-sheet)] text-sm md:flex">
      <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-3">
        <p className="font-bold text-[var(--color-text)]">TimIQ</p>
        <p className="mt-0.5 text-xs text-[var(--color-text-soft)]">
          Payroll workforce app
        </p>
      </div>

      <nav className="flex-1 px-2 py-3">
        <div className="space-y-0.5">
          {employeeLinks.map((item) => (
            <Link
              className={
                item.href === activeHref
                  ? "block border border-[var(--color-border-dark)] bg-[var(--color-header)] px-2 py-1.5 font-semibold text-[var(--color-text)]"
                  : "block border border-transparent px-2 py-1.5 text-[var(--color-text-muted)] hover:border-[var(--color-border)] hover:bg-[var(--color-cell)]"
              }
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
        </div>

        {managementLinks.length > 0 ? (
          <div className="mt-5 border-t border-[var(--color-border)] pt-3">
            <p className="px-2 pb-1 text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
              Management
            </p>

            <div className="space-y-0.5">
              {managementLinks.map((item) => (
                <Link
                  className={
                    item.href === activeHref
                      ? "block border border-[var(--color-border-dark)] bg-[var(--color-header)] px-2 py-1.5 font-semibold text-[var(--color-text)]"
                      : "block border border-transparent px-2 py-1.5 text-[var(--color-text-muted)] hover:border-[var(--color-border)] hover:bg-[var(--color-cell)]"
                  }
                  href={item.href}
                  key={item.href}
                >
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