"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";

import type { NavigationGroupDefinition, SystemRole } from "../../config/navigation";
import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";
import { useT } from "../../lib/i18n";
import { NavGroupIcon, NavItemIcon } from "./nav-item-icon";

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
    ? "flex min-h-[var(--layout-sidebar-child-row-height)] min-w-0 max-w-full items-center gap-1.5 border-l-[3px] border-transparent px-3 pl-7 text-[12px] font-medium leading-tight"
    : "flex min-h-[var(--layout-sidebar-child-row-height)] min-w-0 max-w-full items-center border-l-[3px] border-transparent px-3 pl-7 text-[12px] font-medium leading-tight";
  return cn(
    sidebarBase,
    uiClasses.transitionColors,
    active
      ? "border-l-[var(--color-sidebar-active)] bg-[#d5e1ee] font-semibold text-[var(--color-sidebar-child-fg)]"
      : "text-[var(--color-sidebar-child-fg)] hover:bg-[var(--color-sidebar-child-hover)]",
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

  const outerSpacing = variant === "sidebar" ? "space-y-0" : "space-y-1.5";

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
            <div
              className={variant === "sidebar" ? "border-b border-white/10 last:border-b-0" : undefined}
              key={group.id}
            >
              <Link
                aria-current={active ? "page" : undefined}
                className={
                  variant === "sidebar"
                    ? cn(
                        "flex min-h-[var(--layout-sidebar-row-height)] min-w-0 items-center gap-1.5 px-3 text-[12.5px] font-medium text-white",
                        uiClasses.transitionColors,
                        active
                          ? "bg-[var(--color-sidebar-active)]"
                          : "hover:bg-white/10",
                      )
                    : linkClass(active, variant, showIcons)
                }
                href={only.href}
                onClick={onNavigate}
                title={t(only.labelKey, only.label)}
              >
                {showIcons ? (
                  <NavItemIcon
                    className="h-3.5 w-3.5 shrink-0"
                    labelKey={only.labelKey}
                    surface={variant === "sidebar" ? "navy" : "neutral"}
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate">{t(only.labelKey, only.label)}</span>
                {n > 0 ? (
                  <span className="ml-1 shrink-0 rounded-full bg-red-600 px-1.5 text-[10px] font-bold leading-tight text-white">
                    {n > 99 ? "99+" : n}
                  </span>
                ) : null}
              </Link>
            </div>
          );
        }

        const isOpen =
          openAccordionId === group.id || groupContainsActiveRoute(group, activeHref);
        return (
          <div
            className={variant === "sidebar" ? "border-b border-white/10 last:border-b-0" : undefined}
            key={group.id}
          >
            <button
              aria-expanded={isOpen}
              className={cn(
                variant === "sidebar"
                  ? "flex min-h-[var(--layout-sidebar-row-height)] w-full min-w-0 items-center gap-1.5 px-3 text-left text-[12.5px] font-medium text-white"
                  : uiClasses.navAccordionHeader,
                uiClasses.transitionColors,
                variant === "sidebar"
                  ? "focus-visible:relative focus-visible:z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80"
                  : uiClasses.focusRing,
                variant === "sidebar"
                  ? isOpen
                    ? "bg-[var(--color-sidebar-active)]"
                    : "hover:bg-white/10"
                  : isOpen
                    ? uiClasses.navAccordionHeaderOpen
                    : uiClasses.navAccordionHeaderIdle,
              )}
              title={t(group.groupLabelKey, group.label)}
              type="button"
              onClick={() => onGroupHeaderClick(group.id)}
            >
              {variant === "sidebar" ? (
                <>
                  <ChevronRight
                    aria-hidden
                    className={cn(
                      "h-3 w-3 shrink-0 text-white/70 transition-transform duration-150 motion-reduce:transition-none",
                      isOpen ? "rotate-90" : "",
                    )}
                    strokeWidth={1.8}
                  />
                  {showIcons ? (
                    <NavGroupIcon
                      className="h-3.5 w-3.5 shrink-0"
                      groupId={group.id}
                      surface="navy"
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">
                    {t(group.groupLabelKey, group.label)}
                  </span>
                </>
              ) : (
                <>
                  <span className="flex min-w-0 items-center gap-2">
                    {showIcons ? (
                      <NavGroupIcon
                        className="h-4 w-4 shrink-0"
                        groupId={group.id}
                        surface="light"
                      />
                    ) : null}
                    <span className="min-w-0 truncate">
                      {t(group.groupLabelKey, group.label)}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden
                    className={cn(
                      "h-4 w-4 shrink-0 text-[var(--color-text-soft)] transition-transform duration-150 motion-reduce:transition-none",
                      isOpen ? "rotate-90" : "",
                    )}
                    strokeWidth={1.8}
                  />
                </>
              )}
            </button>
            {isOpen ? (
              <div
                className={
                  variant === "sidebar"
                    ? "space-y-0 bg-[var(--color-sidebar-child-bg)] py-0.5"
                    : "mt-1 space-y-0.5 border-l border-[var(--color-border)] pl-2.5"
                }
              >
                {visible.map((item) => {
                  const active = navItemMatchesActive(item.href, activeHref);
                  const n = badgeByHref[item.href] ?? 0;
                  return (
                    <Link
                      aria-current={active ? "page" : undefined}
                      className={linkClass(active, variant, showIcons)}
                      href={item.href}
                      key={item.href}
                      onClick={onNavigate}
                      title={t(item.labelKey, item.label)}
                    >
                      {showIcons ? (
                        <NavItemIcon
                          className="h-3.5 w-3.5 shrink-0"
                          labelKey={item.labelKey}
                          surface={variant === "sidebar" ? "light" : "neutral"}
                        />
                      ) : null}
                      <span
                        className={cn(
                          "min-w-0 flex-1",
                          variant === "sidebar" ? "truncate" : "break-words",
                        )}
                      >
                        {t(item.labelKey, item.label)}
                      </span>
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
