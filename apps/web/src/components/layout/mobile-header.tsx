"use client";

import { useMemo } from "react";

import {
  getEmployeeNavigationGroups,
  getManagementNavigationGroups,
} from "../../config/navigation";
import { useCurrentUser } from "../../features/auth";

import { GroupedNavBlock } from "./grouped-nav";

type MobileHeaderProps = {
  activeHref?: string;
};

export function MobileHeader({ activeHref = "/dashboard" }: MobileHeaderProps) {
  const user = useCurrentUser();

  const employeeGroups = useMemo(
    () => getEmployeeNavigationGroups(user.system_role),
    [user.system_role],
  );

  const managementGroups = useMemo(
    () => getManagementNavigationGroups(user.system_role),
    [user.system_role],
  );

  return (
    <header className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] md:hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate font-bold tracking-tight text-[var(--color-text)]">TimIQ</p>
          <p className="truncate text-xs text-[#4b5563]">Payroll & workforce</p>
        </div>

        <details className="relative shrink-0">
          <summary className="list-none rounded-[var(--radius-md)] border border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] px-3 py-1.5 text-sm font-semibold text-[var(--color-text)] [&::-webkit-details-marker]:hidden">
            Menu
          </summary>

          <div className="absolute right-0 z-20 mt-2 w-[min(100vw-1.5rem,19rem)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] shadow-[0_1px_4px_rgba(15,23,42,0.08)]">
            <nav className="max-h-[min(75vh,28rem)] overflow-y-auto p-2 text-sm">
              <GroupedNavBlock
                activeHref={activeHref}
                groups={employeeGroups}
                role={user.system_role}
                storageScope="drawer-mobile-primary"
                variant="drawer"
              />

              {managementGroups.length > 0 ? (
                <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                  <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-wider text-[#374151]">
                    Management
                  </p>
                  <GroupedNavBlock
                    activeHref={activeHref}
                    groups={managementGroups}
                    role={user.system_role}
                    storageScope="drawer-mobile-management"
                    variant="drawer"
                  />
                </div>
              ) : null}
            </nav>
          </div>
        </details>
      </div>
    </header>
  );
}
