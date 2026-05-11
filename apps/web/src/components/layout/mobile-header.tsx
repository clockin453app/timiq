"use client";

import Link from "next/link";

import {
  employeeNavigation,
  getNavigationForRole,
  managementNavigation,
} from "../../config/navigation";
import { useCurrentUser } from "../../features/auth";

type MobileHeaderProps = {
  activeHref?: string;
};

export function MobileHeader({ activeHref = "/dashboard" }: MobileHeaderProps) {
  const user = useCurrentUser();

  const employeeLinks = getNavigationForRole(employeeNavigation, user.system_role);
  const managementLinks = getNavigationForRole(managementNavigation, user.system_role);

  return (
    <header className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] md:hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate font-bold tracking-tight text-[var(--color-text)]">TimIQ</p>
          <p className="truncate text-xs text-[var(--color-text-soft)]">Payroll & workforce</p>
        </div>

        <details className="relative shrink-0">
          <summary className="list-none rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--color-text)] [&::-webkit-details-marker]:hidden">
            Menu
          </summary>

          <div className="absolute right-0 z-20 mt-2 w-[min(100vw-1.5rem,17rem)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] shadow-[0_1px_4px_rgba(15,23,42,0.08)]">
            <nav className="max-h-[min(70vh,24rem)] overflow-y-auto p-2 text-sm">
              {employeeLinks.map((item) => (
                <Link
                  className={
                    item.href === activeHref
                      ? "block rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-2.5 py-2 font-semibold text-[var(--color-text)]"
                      : "block rounded-[var(--radius-md)] border border-transparent px-2.5 py-2 text-[var(--color-text-muted)] hover:bg-[var(--color-header)]"
                  }
                  href={item.href}
                  key={item.href}
                >
                  {item.label}
                </Link>
              ))}

              {managementLinks.length > 0 ? (
                <>
                  <p className="mt-3 border-t border-[var(--color-border)] px-2.5 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
                    Management
                  </p>

                  {managementLinks.map((item) => (
                    <Link
                      className={
                        item.href === activeHref
                          ? "block rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-2.5 py-2 font-semibold text-[var(--color-text)]"
                          : "block rounded-[var(--radius-md)] border border-transparent px-2.5 py-2 text-[var(--color-text-muted)] hover:bg-[var(--color-header)]"
                      }
                      href={item.href}
                      key={item.href}
                    >
                      {item.label}
                    </Link>
                  ))}
                </>
              ) : null}
            </nav>
          </div>
        </details>
      </div>
    </header>
  );
}