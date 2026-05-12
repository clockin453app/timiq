"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { NavigationGroupDefinition, SystemRole } from "../../config/navigation";

/**
 * v3: open state is route-driven on each navigation — we do not merge legacy localStorage blobs
 * that left Profile / Sites / Attendance expanded for everyone. User toggles apply until the next
 * activeHref change (desktop drawer matches: no persisted drawer state).
 */
const LEGACY_STORAGE_PREFIXES = ["timiq-nav-groups:v1:", "timiq-nav-groups:v2:"] as const;

type GroupedNavVariant = "sidebar" | "drawer";

type GroupedNavBlockProps = {
  groups: NavigationGroupDefinition[];
  activeHref: string;
  /** Reserved for future optional persistence; unused in v3. */
  storageScope: string;
  variant: GroupedNavVariant;
  role: SystemRole;
};

function groupContainsHref(group: NavigationGroupDefinition, href: string): boolean {
  return group.items.some((item) => item.href === href);
}

function defaultOpenMap(groups: NavigationGroupDefinition[], activeHref: string): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const g of groups) {
    map[g.id] = groupContainsHref(g, activeHref);
  }
  return map;
}

/** One-time cleanup of old keys so they never get re-introduced by tooling or merges. */
function clearLegacyNavStorage(scope: string, role: SystemRole) {
  if (typeof window === "undefined") {
    return;
  }
  const merged = `${scope}:${role}`;
  for (const prefix of LEGACY_STORAGE_PREFIXES) {
    try {
      window.localStorage.removeItem(`${prefix}${merged}`);
    } catch {
      /* ignore */
    }
  }
}

function linkClass(active: boolean, variant: GroupedNavVariant): string {
  const base =
    variant === "sidebar"
      ? "block min-w-0 max-w-full break-words rounded-[var(--radius-md)] border px-2.5 py-2 text-sm font-medium text-[#1f2937] transition-colors"
      : "block min-w-0 max-w-full break-words rounded-[var(--radius-md)] border px-2.5 py-2 text-sm font-medium text-[#1f2937]";
  if (active) {
    return `${base} border-[var(--color-border-dark)] bg-[#e5e7eb] font-semibold text-[#111827]`;
  }
  return `${base} border-transparent hover:border-[var(--color-border)] hover:bg-[#e5e7eb] hover:text-[#111827]`;
}

export function GroupedNavBlock({
  groups,
  activeHref,
  storageScope: _storageScope,
  variant,
  role,
}: GroupedNavBlockProps) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => defaultOpenMap(groups, activeHref));

  useEffect(() => {
    clearLegacyNavStorage(_storageScope, role);
  }, [_storageScope, role]);

  useEffect(() => {
    setOpen(defaultOpenMap(groups, activeHref));
  }, [groups, activeHref]);

  const toggle = useCallback(
    (groupId: string) => {
      setOpen((prev) => {
        const group = groups.find((g) => g.id === groupId);
        if (group && groupContainsHref(group, activeHref) && prev[groupId]) {
          return prev;
        }
        return { ...prev, [groupId]: !prev[groupId] };
      });
    },
    [groups, activeHref],
  );

  if (groups.length === 0) {
    return null;
  }

  const outerSpacing = variant === "sidebar" ? "space-y-2" : "space-y-1.5";

  return (
    <div className={outerSpacing}>
      {groups.map((group) => {
        const visible = group.items;
        if (visible.length === 0) {
          return null;
        }

        if (visible.length === 1) {
          const only = visible[0];
          return (
            <div key={group.id}>
              <Link className={linkClass(only.href === activeHref, variant)} href={only.href}>
                {only.label}
              </Link>
            </div>
          );
        }

        const isOpen = open[group.id] ?? false;
        return (
          <div key={group.id}>
            <button
              aria-expanded={isOpen}
              className={[
                "flex w-full min-w-0 items-center justify-between gap-2 rounded-[var(--radius-md)] border px-2.5 py-2 text-left text-sm font-medium text-[#1f2937]",
                isOpen
                  ? "border-[var(--color-border-dark)] bg-[#e5e7eb] text-[#111827]"
                  : "border-transparent text-[#1f2937] hover:border-[var(--color-border)] hover:bg-[#e5e7eb]/80",
              ].join(" ")}
              type="button"
              onClick={() => toggle(group.id)}
            >
              <span className="min-w-0 truncate">{group.label}</span>
              <span
                aria-hidden
                className={[
                  "inline-flex w-4 shrink-0 select-none justify-end text-[11px] font-medium leading-none text-[#6b7280] transition-transform duration-150",
                  isOpen ? "rotate-90" : "",
                ].join(" ")}
              >
                &gt;
              </span>
            </button>
            {isOpen ? (
              <div className="mt-1 space-y-0.5 border-l border-[var(--color-border-dark)] pl-2.5">
                {visible.map((item) => (
                  <Link
                    className={linkClass(item.href === activeHref, variant)}
                    href={item.href}
                    key={item.href}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
