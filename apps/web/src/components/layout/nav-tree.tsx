"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { ChevronRight } from "lucide-react";

import {
  collectFolderIds,
  findActiveAncestorIds,
  nodeContainsActiveRoute,
  pathnameMatchesNavHref,
  type NavigationNode,
  type SystemRole,
} from "../../config/navigation";
import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";
import { useT } from "../../lib/i18n";
import { NavGroupIcon, NavItemIcon } from "./nav-item-icon";

const TREE_EXPANSION_PREFIX = "timiq-nav-tree:v1:";
const LEGACY_STORAGE_PREFIXES = [
  "timiq-nav-groups:v1:",
  "timiq-nav-groups:v2:",
] as const;

const GUIDE_COLOR = "rgba(80, 110, 150, 0.35)";

export type NavTreeVariant = "sidebar" | "drawer";

type NavTreeProps = {
  nodes: NavigationNode[];
  activeHref: string;
  storageScope: string;
  role: SystemRole;
  variant: NavTreeVariant;
  showIcons?: boolean;
  badgeByHref?: Record<string, number>;
  onNavigate?: () => void;
  /** Extra folder ids that must be open (e.g. collapsed-rail section click). */
  forceOpenIds?: string[];
};

function expansionStorageKey(scope: string, role: SystemRole): string {
  return `${TREE_EXPANSION_PREFIX}${scope}:${role}`;
}

function readExpandedIds(scope: string, role: SystemRole): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(expansionStorageKey(scope, role));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

function writeExpandedIds(scope: string, role: SystemRole, ids: string[]): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(expansionStorageKey(scope, role), JSON.stringify(ids));
  } catch {
    /* best effort */
  }
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

export function navItemMatchesActive(itemHref: string, activeHref: string): boolean {
  return pathnameMatchesNavHref(itemHref, activeHref);
}

function mergeUnique(ids: string[]): string[] {
  return [...new Set(ids)];
}

export function useNavTreeExpansion(
  nodes: NavigationNode[],
  activeHref: string,
  storageScope: string,
  role: SystemRole,
  forceOpenIds: string[] = [],
) {
  const ancestorIds = useMemo(
    () => findActiveAncestorIds(nodes, activeHref),
    [nodes, activeHref],
  );
  const validFolderIds = useMemo(() => new Set(collectFolderIds(nodes)), [nodes]);

  const [manualExpanded, setManualExpanded] = useState<string[]>(() => {
    const stored = readExpandedIds(storageScope, role).filter((id) => validFolderIds.has(id));
    return mergeUnique([...stored, ...ancestorIds, ...forceOpenIds]);
  });

  useEffect(() => {
    clearLegacyNavStorage(storageScope, role);
  }, [storageScope, role]);

  useEffect(() => {
    setManualExpanded((prev) => {
      const pruned = prev.filter((id) => validFolderIds.has(id));
      const next = mergeUnique([...pruned, ...ancestorIds, ...forceOpenIds]).filter((id) =>
        validFolderIds.has(id),
      );
      if (next.length === prev.length && next.every((id, i) => id === prev[i])) {
        return prev;
      }
      writeExpandedIds(storageScope, role, next);
      return next;
    });
  }, [ancestorIds, forceOpenIds, storageScope, role, validFolderIds]);

  const expandedSet = useMemo(() => new Set(manualExpanded), [manualExpanded]);

  const isExpanded = useCallback((id: string) => expandedSet.has(id), [expandedSet]);

  const toggleExpanded = useCallback(
    (id: string, nextOpen?: boolean) => {
      setManualExpanded((prev) => {
        const open = nextOpen ?? !prev.includes(id);
        if (!open && ancestorIds.includes(id)) {
          return prev;
        }
        const next = open
          ? mergeUnique([...prev, id])
          : prev.filter((existing) => existing !== id);
        writeExpandedIds(storageScope, role, next);
        return next;
      });
    },
    [ancestorIds, storageScope, role],
  );

  const ensureOpen = useCallback(
    (ids: string[]) => {
      setManualExpanded((prev) => {
        const next = mergeUnique([...prev, ...ids]);
        writeExpandedIds(storageScope, role, next);
        return next;
      });
    },
    [storageScope, role],
  );

  return { isExpanded, toggleExpanded, ensureOpen, expandedIds: manualExpanded };
}

type TreeRowProps = {
  node: NavigationNode;
  depth: number;
  activeHref: string;
  variant: NavTreeVariant;
  showIcons: boolean;
  badgeByHref: Record<string, number>;
  isExpanded: (id: string) => boolean;
  toggleExpanded: (id: string, nextOpen?: boolean) => void;
  onNavigate?: () => void;
  showGuides: boolean;
};

function TreeRow({
  node,
  depth,
  activeHref,
  variant,
  showIcons,
  badgeByHref,
  isExpanded,
  toggleExpanded,
  onNavigate,
  showGuides,
}: TreeRowProps) {
  const t = useT();
  const isFolder = Boolean(node.children && node.children.length > 0 && !node.href);
  const label = t(node.labelKey, node.label);
  const open = isFolder ? isExpanded(node.id) : false;
  const activeLeaf = Boolean(node.href && navItemMatchesActive(node.href, activeHref));
  const containsActive = nodeContainsActiveRoute(node, activeHref);
  const indentPx = depth * (variant === "drawer" ? 14 : 15);
  const badgeHref = node.badgeId ?? node.href;
  const badgeCount = badgeHref ? (badgeByHref[badgeHref] ?? 0) : 0;
  const nestedOnChildBg = variant === "sidebar" && depth > 0;

  const onFolderKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (!open) {
        toggleExpanded(node.id, true);
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (open) {
        toggleExpanded(node.id, false);
      }
    }
  };

  if (isFolder) {
    const panelId = `nav-tree-${node.id}`;
    return (
      <div className="relative">
        <button
          aria-controls={panelId}
          aria-expanded={open}
          className={cn(
            "relative flex w-full min-w-0 items-center gap-1.5 text-left",
            uiClasses.transitionColors,
            variant === "sidebar"
              ? cn(
                  "px-2 font-medium",
                  "focus-visible:relative focus-visible:z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80",
                  depth === 0
                    ? "min-h-[var(--layout-sidebar-row-height)] text-[12.5px] text-white"
                    : "min-h-[var(--layout-sidebar-folder-row-height)] text-[12px] text-[var(--color-sidebar-child-fg)]",
                  nestedOnChildBg
                    ? containsActive || open
                      ? "bg-[#d5e1ee]"
                      : "hover:bg-[var(--color-sidebar-child-hover)]"
                    : containsActive || open
                      ? "bg-[var(--color-sidebar-active)]"
                      : "hover:bg-white/10",
                )
              : cn(
                  "min-h-11 rounded-none px-2 text-sm font-semibold text-[var(--color-text)]",
                  uiClasses.focusRing,
                  open ? "bg-[var(--color-surface-muted)]" : "hover:bg-[var(--color-surface-muted)]",
                ),
          )}
          style={{ paddingLeft: 8 + indentPx }}
          title={label}
          type="button"
          onClick={() => toggleExpanded(node.id)}
          onKeyDown={onFolderKeyDown}
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "h-2.5 w-2.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
              nestedOnChildBg
                ? "text-[var(--color-sidebar-child-fg)]/70"
                : variant === "sidebar"
                  ? "text-white/70"
                  : "text-[var(--color-text-soft)]",
              open ? "rotate-90" : "",
            )}
            strokeWidth={1.8}
          />
          {showIcons ? (
            <NavGroupIcon
              className="h-3.5 w-3.5 shrink-0"
              groupId={node.iconKey}
              surface={variant === "sidebar" ? (nestedOnChildBg ? "light" : "navy") : "light"}
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </button>
        {open ? (
          <div
            className={cn("relative", variant === "sidebar" ? "bg-[var(--color-sidebar-child-bg)]" : undefined)}
            id={panelId}
          >
            {showGuides && variant === "sidebar" ? (
              <span
                aria-hidden
                className="pointer-events-none absolute bottom-1 top-0 w-px"
                style={{
                  left: 8 + indentPx + 5,
                  backgroundColor: GUIDE_COLOR,
                }}
              />
            ) : null}
            {node.children?.map((child) => (
              <div className="relative" key={child.id}>
                {showGuides && variant === "sidebar" ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 h-px"
                    style={{
                      left: 8 + indentPx + 5,
                      width: 10,
                      backgroundColor: GUIDE_COLOR,
                    }}
                  />
                ) : null}
                <TreeRow
                  activeHref={activeHref}
                  badgeByHref={badgeByHref}
                  depth={depth + 1}
                  isExpanded={isExpanded}
                  node={child}
                  showGuides={showGuides}
                  showIcons={showIcons}
                  toggleExpanded={toggleExpanded}
                  variant={variant}
                  onNavigate={onNavigate}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (!node.href) {
    return null;
  }

  const isRootLeaf = depth === 0 && variant === "sidebar";
  const leafIconKey = node.iconKey.startsWith("nav.") ? node.iconKey : node.labelKey;

  return (
    <Link
      aria-current={activeLeaf ? "page" : undefined}
      className={cn(
        "relative flex w-full min-w-0 items-center gap-1.5",
        uiClasses.transitionColors,
        variant === "sidebar"
          ? cn(
              isRootLeaf
                ? "min-h-[var(--layout-sidebar-row-height)] border-l-[3px] border-transparent px-3 text-[12.5px] font-medium text-white"
                : "min-h-[var(--layout-sidebar-page-row-height)] border-l-[3px] border-transparent text-[12px] font-medium text-[var(--color-sidebar-child-fg)]",
              "focus-visible:relative focus-visible:z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80",
              activeLeaf
                ? isRootLeaf
                  ? "border-l-white/80 bg-[var(--color-sidebar-active)]"
                  : "border-l-[var(--color-sidebar-active)] bg-[#d5e1ee] font-semibold"
                : isRootLeaf
                  ? "hover:bg-white/10"
                  : "hover:bg-[var(--color-sidebar-child-hover)]",
            )
          : cn(
              uiClasses.navDrawerLinkBase,
              "min-h-11 gap-2.5",
              activeLeaf ? uiClasses.navDrawerLinkActive : uiClasses.navDrawerLinkIdle,
            ),
      )}
      href={node.href}
      style={
        variant === "sidebar" && !isRootLeaf
          ? { paddingLeft: 8 + indentPx + 14, paddingRight: 12 }
          : variant === "drawer"
            ? { paddingLeft: 8 + indentPx }
            : undefined
      }
      title={label}
      onClick={onNavigate}
    >
      {showIcons ? (
        <NavItemIcon
          className="h-3.5 w-3.5 shrink-0"
          labelKey={leafIconKey}
          surface={variant === "sidebar" ? (isRootLeaf ? "navy" : "light") : "neutral"}
        />
      ) : null}
      <span className={cn("min-w-0 flex-1", variant === "sidebar" ? "truncate" : "break-words")}>
        {label}
      </span>
      {badgeCount > 0 ? (
        <span className="ml-1 shrink-0 rounded-full bg-red-600 px-1.5 text-[10px] font-bold leading-tight text-white">
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      ) : null}
    </Link>
  );
}

export function NavTree({
  nodes,
  activeHref,
  storageScope,
  role,
  variant,
  showIcons = true,
  badgeByHref = {},
  onNavigate,
  forceOpenIds = [],
}: NavTreeProps) {
  const { isExpanded, toggleExpanded } = useNavTreeExpansion(
    nodes,
    activeHref,
    storageScope,
    role,
    forceOpenIds,
  );

  if (nodes.length === 0) {
    return null;
  }

  return (
    <div className={variant === "sidebar" ? "space-y-0" : "space-y-0.5"}>
      {nodes.map((node) => (
        <div
          className={variant === "sidebar" ? "border-b border-white/10 last:border-b-0" : undefined}
          key={node.id}
        >
          <TreeRow
            activeHref={activeHref}
            badgeByHref={badgeByHref}
            depth={0}
            isExpanded={isExpanded}
            node={node}
            showGuides={variant === "sidebar"}
            showIcons={showIcons}
            toggleExpanded={toggleExpanded}
            variant={variant}
            onNavigate={onNavigate}
          />
        </div>
      ))}
    </div>
  );
}
