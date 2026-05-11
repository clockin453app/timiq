"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { NavigationGroupDefinition, SystemRole } from "../../config/navigation";

/** Bump version to ignore legacy open-state blobs that left many groups expanded. */
const STORAGE_PREFIX = "timiq-nav-groups:v2:";

type GroupedNavVariant = "sidebar" | "drawer";

type GroupedNavBlockProps = {
  groups: NavigationGroupDefinition[];
  activeHref: string;
  /** Unique per surface + role, e.g. sidebar-desktop-admin */
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

function loadStoredOpen(scope: string): Record<string, boolean> | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${scope}`);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed as Record<string, boolean>;
  } catch {
    return null;
  }
}

function saveStoredOpen(scope: string, state: Record<string, boolean>) {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${scope}`, JSON.stringify(state));
  } catch {
    /* ignore quota / private mode */
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
  storageScope,
  variant,
  role,
}: GroupedNavBlockProps) {
  const mergedScope = `${storageScope}:${role}`;

  const [open, setOpen] = useState<Record<string, boolean>>(() => defaultOpenMap(groups, activeHref));

  useEffect(() => {
    const defaults = defaultOpenMap(groups, activeHref);
    const stored = loadStoredOpen(mergedScope);
    const next: Record<string, boolean> = { ...defaults };
    if (stored) {
      for (const g of groups) {
        if (typeof stored[g.id] === "boolean") {
          next[g.id] = stored[g.id];
        }
      }
    }
    for (const g of groups) {
      if (groupContainsHref(g, activeHref)) {
        next[g.id] = true;
      }
    }
    setOpen(next);
  }, [groups, activeHref, mergedScope]);

  const toggle = useCallback(
    (groupId: string) => {
      setOpen((prev) => {
        const next = { ...prev, [groupId]: !prev[groupId] };
        saveStoredOpen(mergedScope, next);
        return next;
      });
    },
    [mergedScope],
  );

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className={variant === "sidebar" ? "space-y-2" : "space-y-1.5"}>
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
                "flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border px-2.5 py-2 text-left text-sm font-medium text-[#1f2937]",
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
