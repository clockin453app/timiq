"use client";

import { useMemo } from "react";

import {
  getEmployeeNavigationGroups,
  getManagementNavigationGroups,
} from "../../config/navigation";
import { useCurrentUser, UserAccountSummary } from "../../features/auth";

import { GroupedNavBlock } from "./grouped-nav";

type DesktopSidebarProps = {
  activeHref?: string;
};

export function DesktopSidebar({ activeHref = "/dashboard" }: DesktopSidebarProps) {
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
    <aside className="hidden min-h-screen w-[var(--layout-sidebar-width)] flex-col border-r border-[var(--color-border-dark)] bg-[var(--color-sidebar-bg)] text-sm md:flex">
      <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-4">
        <p className="text-base font-bold tracking-tight text-[var(--color-text)]">TimIQ</p>
        <p className="mt-1 text-xs leading-snug text-[#4b5563]">
          Payroll & workforce
        </p>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 py-4">
        <GroupedNavBlock
          activeHref={activeHref}
          groups={employeeGroups}
          role={user.system_role}
          storageScope="sidebar-desktop-primary"
          variant="sidebar"
        />

        {managementGroups.length > 0 ? (
          <div className="mt-5 border-t border-[var(--color-border)] pt-4">
            <p className="mb-2 px-2 text-xs font-medium tracking-normal text-[#374151]">
              Management
            </p>
            <GroupedNavBlock
              activeHref={activeHref}
              groups={managementGroups}
              role={user.system_role}
              storageScope="sidebar-desktop-management"
              variant="sidebar"
            />
          </div>
        ) : null}
      </nav>

      <UserAccountSummary />
    </aside>
  );
}
