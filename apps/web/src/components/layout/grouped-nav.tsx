"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

import type { NavigationGroupDefinition, SystemRole } from "../../config/navigation";
import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";
import { useT } from "../../lib/i18n";
import { NavItemIcon } from "./nav-item-icon";

/**
 * v3: open state is route-driven on each navigation — we do not merge legacy localStorage blobs
 * that left Profile / Sites / Attendance expanded for everyone.
 */
const LEGACY_STORAGE_PREFIXES = ["timiq-nav-groups:v1:", "timiq-nav-groups:v2:"] as const;

type GroupedNavVariant = "sidebar" | "drawer";

type GroupedNavBlockProps = {
  groups: NavigationGroupDefinition[];
  activeHref: string;
  /** Reserved for legacy cleanup only. */
  storageScope: string;
  variant: GroupedNavVariant;
  role: SystemRole;
  /** Show Lucide icons beside labels (desktop polish). */
  showIcons?: boolean;
  /** Optional small counts for primary links (e.g. from notification summary). */
  badgeByHref?: Record<string, number>;
  /**
   * Accordion (single open group across primary + management blocks).
   * When both are set, this block is controlled by the parent.
   */
  accordionOpenGroupId?: string | null;
  onAccordionOpenGroupChange?: (groupId: string | null) => void;
  /** Called when a nav link is activated (e.g. close mobile drawer). */
  onNavigate?: () => void;
};

/** Match nav item active state (nested routes under the item href). */
export function navItemMatchesActive(itemHref: string, activeHref: string): boolean {
  if (itemHref === "/dashboard") {
    return activeHref === "/dashboard";
  }
  return activeHref === itemHref || activeHref.startsWith(`${itemHref}/`);
}

export function groupContainsActiveRoute(group: NavigationGroupDefinition, activeHref: string): boolean {
  return group.items.some((item) => navItemMatchesActive(item.href, activeHref));
}

/** First multi-item group in primary, then secondary, that contains the active route. */
export function findDefaultAccordionGroupId(
  primaryGroups: NavigationGroupDefinition[],
  secondaryGroups: NavigationGroupDefinition[],
  activeHref: string,
): string | null {
  for (const g of primaryGroups) {
    if (g.items.length > 1 && groupContainsActiveRoute(g, activeHref)) {
      return g.id;
    }
  }
  for (const g of secondaryGroups) {
    if (g.items.length > 1 && groupContainsActiveRoute(g, activeHref)) {
      return g.id;
    }
  }
  return null;
}

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

function linkClass(active: boolean, variant: GroupedNavVariant, withIcon: boolean): string {
  if (variant === "drawer") {
    return cn(
      uiClasses.navDrawerLinkBase,
      uiClasses.transitionColors,
      withIcon ? "gap-2.5" : "block",
      active ? uiClasses.navDrawerLinkActive : uiClasses.navDrawerLinkIdle,
    );
  }
  const sidebarBase = withIcon
    ? "flex min-w-0 max-w-full items-center gap-2 break-words rounded-[var(--radius-md)] border px-2 py-1.5 text-sm font-medium"
    : "block min-w-0 max-w-full break-words rounded-[var(--radius-md)] border px-2 py-1.5 text-sm font-medium";
  return cn(
    sidebarBase,
    uiClasses.transitionColors,
    active ? uiClasses.navDrawerLinkActive : uiClasses.navDrawerLinkIdle,
  );
}

export function GroupedNavBlock({
  groups,
  activeHref,
  storageScope: _storageScope,
  variant,
  role,
  showIcons = true,
  badgeByHref = {},
  accordionOpenGroupId: controlledOpenId,
  onAccordionOpenGroupChange,
  onNavigate,
}: GroupedNavBlockProps) {
  const t = useT();
  const isControlled = typeof onAccordionOpenGroupChange === "function";

  const [internalOpenId, setInternalOpenId] = useState<string | null>(() => {
    for (const g of groups) {
      if (g.items.length > 1 && groupContainsActiveRoute(g, activeHref)) {
        return g.id;
      }
    }
    return null;
  });

  useEffect(() => {
    clearLegacyNavStorage(_storageScope, role);
  }, [_storageScope, role]);

  useEffect(() => {
    if (isControlled) {
      return;
    }
    for (const g of groups) {
      if (g.items.length > 1 && groupContainsActiveRoute(g, activeHref)) {
        setInternalOpenId(g.id);
        return;
      }
    }
    setInternalOpenId(null);
  }, [groups, activeHref, isControlled]);

  const openAccordionId = isControlled ? (controlledOpenId ?? null) : internalOpenId;

  const setOpenAccordionId = useCallback(
    (next: string | null) => {
      if (isControlled && onAccordionOpenGroupChange) {
        onAccordionOpenGroupChange(next);
      } else if (!isControlled) {
        setInternalOpenId(next);
      }
    },
    [isControlled, onAccordionOpenGroupChange],
  );

  const onGroupHeaderClick = useCallback(
    (groupId: string) => {
      const group = groups.find((g) => g.id === groupId);
      if (!group || group.items.length <= 1) {
        return;
      }
      if (openAccordionId === groupId) {
        if (groupContainsActiveRoute(group, activeHref)) {
          return;
        }
        setOpenAccordionId(null);
        return;
      }
      setOpenAccordionId(groupId);
    },
    [groups, activeHref, openAccordionId, setOpenAccordionId],
  );

  if (groups.length === 0) {
    return null;
  }

  const outerSpacing = variant === "sidebar" ? "space-y-1" : "space-y-1.5";

  return (
    <div className={outerSpacing}>
      {groups.map((group) => {
        const visible = group.items;
        if (visible.length === 0) {
          return null;
        }

        if (visible.length === 1) {
          const only = visible[0];
          const active = navItemMatchesActive(only.href, activeHref);
          const n = badgeByHref[only.href] ?? 0;
          return (
            <div key={group.id}>
              <Link className={linkClass(active, variant, showIcons)} href={only.href} onClick={onNavigate}>
                {showIcons ? <NavItemIcon labelKey={only.labelKey} className="h-[1.125rem] w-[1.125rem] shrink-0" /> : null}
                <span className="min-w-0 flex-1 break-words">{t(only.labelKey, only.label)}</span>
                {n > 0 ? (
                  <span className="ml-1 shrink-0 rounded-full bg-red-600 px-1.5 text-[10px] font-bold leading-tight text-white">
                    {n > 99 ? "99+" : n}
                  </span>
                ) : null}
              </Link>
            </div>
          );
        }

        const isOpen = openAccordionId === group.id;
        return (
          <div key={group.id}>
            <button
              aria-expanded={isOpen}
              className={cn(
                uiClasses.navAccordionHeader,
                uiClasses.transitionColors,
                uiClasses.focusRing,
                isOpen ? uiClasses.navAccordionHeaderOpen : uiClasses.navAccordionHeaderIdle,
              )}
              type="button"
              onClick={() => onGroupHeaderClick(group.id)}
            >
              <span className="min-w-0 truncate">{t(group.groupLabelKey, group.label)}</span>
              <ChevronDown
                aria-hidden
                className={cn(
                  "h-4 w-4 shrink-0 text-[var(--color-text-soft)] transition-transform duration-150",
                  isOpen ? "rotate-180" : "",
                )}
              />
            </button>
            {isOpen ? (
              <div className="mt-1 space-y-0.5 border-l border-[var(--color-border)] pl-2.5">
                {visible.map((item) => {
                  const active = navItemMatchesActive(item.href, activeHref);
                  const n = badgeByHref[item.href] ?? 0;
                  return (
                    <Link
                      className={linkClass(active, variant, showIcons)}
                      href={item.href}
                      key={item.href}
                      onClick={onNavigate}
                    >
                      {showIcons ? (
                        <NavItemIcon labelKey={item.labelKey} className="h-[1.125rem] w-[1.125rem] shrink-0" />
                      ) : null}
                      <span className="min-w-0 flex-1 break-words">{t(item.labelKey, item.label)}</span>
                      {n > 0 ? (
                        <span className="ml-1 shrink-0 rounded-full bg-red-600 px-1.5 text-[10px] font-bold leading-tight text-white">
                          {n > 99 ? "99+" : n}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
