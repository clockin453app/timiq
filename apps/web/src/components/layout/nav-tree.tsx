"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { ChevronRight, Folder, FolderOpen } from "lucide-react";

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

const GUIDE_COLOR = "var(--color-sidebar-guide)";
const FOLDER_GOLD = "var(--color-sidebar-folder-gold)";

export type NavTreeVariant = "sidebar" | "drawer";

/** Main section left padding (px). */
const SIDEBAR_SECTION_PAD_X = 12;
/** Second-level folder content left position (px). */
const SIDEBAR_FOLDER_PAD_X = 28;
/** Final page content left position (px). */
const SIDEBAR_PAGE_PAD_X = 58;

/** Section / folder / page label sizes (px) — section largest, page ≥ 13. */
const SIDEBAR_SECTION_FONT_PX = 14.5;
const SIDEBAR_FOLDER_FONT_PX = 13.5;
const SIDEBAR_PAGE_FONT_PX = 13;

function folderPadX(depth: number): number {
  if (depth <= 0) {
    return SIDEBAR_SECTION_PAD_X;
  }
  return SIDEBAR_FOLDER_PAD_X + Math.max(0, depth - 1) * 12;
}

function pagePadX(depth: number): number {
  if (depth <= 0) {
    return SIDEBAR_SECTION_PAD_X;
  }
  return SIDEBAR_PAGE_PAD_X + Math.max(0, depth - 1) * 8;
}

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
  const badgeHref = node.badgeId ?? node.href;
  const badgeCount = badgeHref ? (badgeByHref[badgeHref] ?? 0) : 0;
  const isSectionFolder = depth === 0;
  const folderPad = folderPadX(depth);
  const pagePad = pagePadX(depth);
  const guideLeft = folderPad + 5;

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
    const FolderIcon = open ? FolderOpen : Folder;
    return (
      <div className="relative">
        <button
          aria-controls={panelId}
          aria-expanded={open}
          className={cn(
            "relative flex w-full min-w-0 items-center gap-2 pr-3 text-left",
            uiClasses.transitionColors,
            "focus-visible:relative focus-visible:z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset",
            isSectionFolder
              ? cn(
                  "min-h-[var(--layout-sidebar-row-height)] bg-[var(--color-sidebar-bg)] font-semibold text-white",
                  "focus-visible:ring-white/80",
                  containsActive || open
                    ? "bg-[var(--color-sidebar-active)]"
                    : "hover:bg-white/10",
                )
              : cn(
                  "min-h-[var(--layout-sidebar-folder-row-height)] font-medium text-black",
                  "focus-visible:ring-black/35",
                  open
                    ? "bg-[var(--color-sidebar-folder-expanded-bg)]"
                    : "bg-[var(--color-sidebar-folder-bg)] hover:bg-[var(--color-sidebar-folder-hover)]",
                ),
          )}
          style={{
            paddingLeft: folderPad,
            fontSize: isSectionFolder ? SIDEBAR_SECTION_FONT_PX : SIDEBAR_FOLDER_FONT_PX,
          }}
          title={label}
          type="button"
          onClick={() => toggleExpanded(node.id)}
          onKeyDown={onFolderKeyDown}
        >
          <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center">
            <ChevronRight
              aria-hidden
              className={cn(
                "h-2.5 w-2.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
                isSectionFolder ? "text-white" : "text-black",
                open ? "rotate-90" : "",
              )}
              strokeWidth={1.8}
            />
          </span>
          {showIcons ? (
            isSectionFolder ? (
              <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center">
                <NavGroupIcon
                  className="h-4 w-4 shrink-0"
                  groupId={node.iconKey}
                  surface="navy"
                />
              </span>
            ) : (
              <span
                aria-hidden
                className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center"
                data-sidebar-folder-icon={open ? "open" : "closed"}
              >
                <FolderIcon
                  aria-hidden
                  className="h-4 w-4 shrink-0"
                  strokeWidth={1.8}
                  style={{ color: FOLDER_GOLD }}
                />
              </span>
            )
          ) : null}
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </button>
        {open ? (
          <div
            className={cn(
              "relative",
              isSectionFolder
                ? "bg-[var(--color-sidebar-child-bg)]"
                : "bg-[var(--color-sidebar-page-bg)]",
            )}
            id={panelId}
          >
            {showGuides ? (
              <span
                aria-hidden
                className="pointer-events-none absolute bottom-1 top-0 w-px"
                style={{
                  left: guideLeft,
                  backgroundColor: GUIDE_COLOR,
                }}
              />
            ) : null}
            {node.children?.map((child) => (
              <div className="relative" key={child.id}>
                {showGuides ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 h-px"
                    style={{
                      left: guideLeft,
                      width: Math.max(8, pagePadX(depth + 1) - guideLeft - 4),
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

  const isRootLeaf = depth === 0;
  const leafIconKey = node.iconKey.startsWith("nav.") ? node.iconKey : node.labelKey;

  return (
    <Link
      aria-current={activeLeaf ? "page" : undefined}
      className={cn(
        "relative flex w-full min-w-0 items-center gap-2 pr-3",
        uiClasses.transitionColors,
        "focus-visible:relative focus-visible:z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset",
        isRootLeaf
          ? cn(
              "min-h-[var(--layout-sidebar-row-height)] border-l-[3px] border-transparent bg-[var(--color-sidebar-bg)] font-semibold text-white",
              "focus-visible:ring-white/80",
              activeLeaf
                ? "border-l-white bg-[var(--color-sidebar-active)]"
                : "hover:bg-white/10",
            )
          : cn(
              "min-h-[var(--layout-sidebar-page-row-height)] border-l-[3px] border-transparent bg-[var(--color-sidebar-page-bg)] font-normal text-black",
              "focus-visible:ring-black/35",
              activeLeaf
                ? "border-l-black bg-[var(--color-sidebar-page-active-bg)] font-semibold text-black"
                : "hover:bg-[var(--color-sidebar-child-hover)] hover:text-black",
            ),
      )}
      href={node.href}
      style={{
        paddingLeft: pagePad,
        fontSize: isRootLeaf ? SIDEBAR_SECTION_FONT_PX : SIDEBAR_PAGE_FONT_PX,
      }}
      title={label}
      onClick={onNavigate}
    >
      {showIcons ? (
        <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center">
          <NavItemIcon
            className={cn(
              "h-4 w-4 shrink-0",
              !isRootLeaf && "text-[var(--color-sidebar-page-icon)]",
            )}
            labelKey={leafIconKey}
            surface={isRootLeaf ? "navy" : "light"}
          />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">
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
    <div className={variant === "sidebar" ? "space-y-0" : "space-y-0"}>
      {nodes.map((node) => (
        <div
          className={
            variant === "sidebar"
              ? "border-b border-white/10 last:border-b-0"
              : "border-b border-neutral-200 last:border-b-0"
          }
          data-nav-variant={variant}
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
