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
      <div className="flex items-center justify-between px-3 py-2">
        <div>
          <p className="font-bold text-[var(--color-text)]">TimIQ</p>
          <p className="text-xs text-[var(--color-text-soft)]">
            Payroll workforce app
          </p>
        </div>

        <details className="relative">
          <summary className="list-none border border-[var(--color-border-dark)] bg-[var(--color-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--color-text)]">
            Menu
          </summary>

          <div className="absolute right-0 z-20 mt-2 w-64 border border-[var(--color-border-dark)] bg-[var(--color-sheet)]">
            <nav className="p-2 text-sm">
              {employeeLinks.map((item) => (
                <Link
                  className={
                    item.href === activeHref
                      ? "block border border-[var(--color-border-dark)] bg-[var(--color-header)] px-2 py-1.5 font-semibold"
                      : "block border border-transparent px-2 py-1.5 text-[var(--color-text-muted)]"
                  }
                  href={item.href}
                  key={item.href}
                >
                  {item.label}
                </Link>
              ))}

              {managementLinks.length > 0 ? (
                <>
                  <p className="mt-3 border-t border-[var(--color-border)] px-2 pt-3 text-xs font-bold uppercase text-[var(--color-text-soft)]">
                    Management
                  </p>

                  {managementLinks.map((item) => (
                    <Link
                      className={
                        item.href === activeHref
                          ? "block border border-[var(--color-border-dark)] bg-[var(--color-header)] px-2 py-1.5 font-semibold"
                          : "block border border-transparent px-2 py-1.5 text-[var(--color-text-muted)]"
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