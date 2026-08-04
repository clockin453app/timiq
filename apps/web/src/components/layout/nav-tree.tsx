"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";

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
const SIDEBAR_SECTION_PAD_X = 15;
/** Second-level folder content left position (px). */
const SIDEBAR_FOLDER_PAD_X = 32;
/** Vertical tree line X under expanded folders (px). */
const SIDEBAR_TREE_GUIDE_X = 46;
/** Final page content (icon) left position (px). */
const SIDEBAR_PAGE_PAD_X = 68;
/** Nesting step for deeper levels (px). */
const SIDEBAR_NEST_STEP = 10;

/** Section / folder / page label sizes (px) — nothing below 14. */
const SIDEBAR_SECTION_FONT_PX = 15.5;
const SIDEBAR_FOLDER_FONT_PX = 14.5;
const SIDEBAR_PAGE_FONT_PX = 14;

const CHEVRON_BOX_PX = 20;
const ICON_BOX_PX = 20;

function folderPadX(depth: number): number {
  if (depth <= 0) {
    return SIDEBAR_SECTION_PAD_X;
  }
  return SIDEBAR_FOLDER_PAD_X + Math.max(0, depth - 1) * SIDEBAR_NEST_STEP;
}

function pagePadX(depth: number): number {
  if (depth <= 0) {
    return SIDEBAR_SECTION_PAD_X;
  }
  return SIDEBAR_PAGE_PAD_X + Math.max(0, depth - 1) * SIDEBAR_NEST_STEP;
}

/** Vertical guide X for children of a folder/section at `parentDepth`. */
function treeGuideX(parentDepth: number): number {
  if (parentDepth <= 0) {
    return SIDEBAR_SECTION_PAD_X + Math.floor(CHEVRON_BOX_PX / 2);
  }
  return SIDEBAR_TREE_GUIDE_X + Math.max(0, parentDepth - 1) * SIDEBAR_NEST_STEP;
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

function IconBox({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center"
      style={{ width: ICON_BOX_PX, height: ICON_BOX_PX }}
    >
      {children}
    </span>
  );
}

function ChevronBox({
  open,
  tone,
}: {
  open: boolean;
  tone: "white" | "black";
}) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center"
      data-sidebar-chevron={open ? "expanded" : "collapsed"}
      style={{ width: CHEVRON_BOX_PX, height: CHEVRON_BOX_PX }}
    >
      <Icon
        aria-hidden
        className={cn("h-4 w-4 shrink-0", tone === "white" ? "text-white" : "text-black")}
        strokeWidth={2.4}
      />
    </span>
  );
}

/** Per-child tree guides: vertical segment + horizontal branch; last child stops at mid-row. */
function TreeBranchGuides({
  guideLeft,
  branchWidth,
  isLast,
}: {
  guideLeft: number;
  branchWidth: number;
  isLast: boolean;
}) {
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 w-px"
        data-sidebar-tree-vertical={isLast ? "last" : "continue"}
        style={{
          left: guideLeft,
          height: isLast ? "50%" : "100%",
          backgroundColor: GUIDE_COLOR,
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 h-px"
        data-sidebar-tree-branch=""
        style={{
          left: guideLeft,
          width: Math.max(10, branchWidth),
          backgroundColor: GUIDE_COLOR,
        }}
      />
    </>
  );
}

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
  const isDrawer = variant === "drawer";
  const folderPad = folderPadX(depth);
  const pagePad = pagePadX(depth);
  const touchMin = isDrawer ? "min-h-11" : undefined;

  const onFolderKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleExpanded(node.id);
      return;
    }
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
    const guideLeft = treeGuideX(depth);

    return (
      <div
        className="relative"
        data-sidebar-level={isSectionFolder ? "section" : "folder"}
        data-sidebar-node={node.id}
      >
        <button
          aria-controls={panelId}
          aria-expanded={open}
          className={cn(
            "relative flex w-full min-w-0 items-center gap-2.5 pr-3 text-left",
            uiClasses.transitionColors,
            "focus-visible:relative focus-visible:z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset",
            touchMin,
            isSectionFolder
              ? cn(
                  !isDrawer && "min-h-[var(--layout-sidebar-row-height)]",
                  /* Solid navy always — never hover:bg-white/10 (sticky :hover on touch
                     replaces the navy fill with translucent white on the white drawer). */
                  "bg-[var(--color-sidebar-bg)] font-semibold text-white",
                  "hover:bg-[var(--color-sidebar-active)]",
                  "focus-visible:ring-white/80",
                  (containsActive || open) && "bg-[var(--color-sidebar-active)]",
                )
              : cn(
                  !isDrawer && "min-h-[var(--layout-sidebar-folder-row-height)]",
                  "font-medium text-black",
                  "focus-visible:ring-black/35",
                  open
                    ? "bg-[var(--color-sidebar-folder-expanded-bg)]"
                    : "bg-[var(--color-sidebar-folder-bg)] hover:bg-[var(--color-sidebar-folder-hover)]",
                ),
          )}
          data-sidebar-section-header={isSectionFolder ? node.id : undefined}
          style={{
            paddingLeft: folderPad,
            fontSize: isSectionFolder ? SIDEBAR_SECTION_FONT_PX : SIDEBAR_FOLDER_FONT_PX,
          }}
          title={label}
          type="button"
          onClick={() => toggleExpanded(node.id)}
          onKeyDown={onFolderKeyDown}
        >
          <ChevronBox open={open} tone={isSectionFolder ? "white" : "black"} />
          {showIcons ? (
            isSectionFolder ? (
              <IconBox>
                <NavGroupIcon
                  className="h-[17px] w-[17px] shrink-0 text-white"
                  groupId={node.iconKey}
                  surface="navy"
                />
              </IconBox>
            ) : (
              <IconBox>
                <span data-sidebar-folder-icon={open ? "open" : "closed"}>
                  <FolderIcon
                    aria-hidden
                    className="h-[17px] w-[17px] shrink-0"
                    strokeWidth={1.9}
                    style={{ color: FOLDER_GOLD }}
                  />
                </span>
              </IconBox>
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
            data-sidebar-section-panel={isSectionFolder ? node.id : undefined}
            data-sidebar-tree-panel=""
            id={panelId}
          >
            {node.children?.map((child, index) => {
              const isLast = index === (node.children?.length ?? 0) - 1;
              const childIsFolder = Boolean(child.children?.length && !child.href);
              const childPad = childIsFolder ? folderPadX(depth + 1) : pagePadX(depth + 1);
              const branchWidth = Math.max(10, childPad - guideLeft - 6);
              return (
                <div className="relative" data-sidebar-tree-child={isLast ? "last" : "item"} key={child.id}>
                  {showGuides ? (
                    <TreeBranchGuides
                      branchWidth={branchWidth}
                      guideLeft={guideLeft}
                      isLast={isLast}
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
              );
            })}
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
        "relative flex w-full min-w-0 items-center gap-2.5 pr-3",
        uiClasses.transitionColors,
        "focus-visible:relative focus-visible:z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset",
        touchMin,
        isRootLeaf
          ? cn(
              !isDrawer && "min-h-[var(--layout-sidebar-row-height)]",
              "border-l-[3px] border-transparent bg-[var(--color-sidebar-bg)] font-semibold text-white",
              "hover:bg-[var(--color-sidebar-active)]",
              "focus-visible:ring-white/80",
              activeLeaf
                ? "border-l-white bg-[var(--color-sidebar-active)]"
                : null,
            )
          : cn(
              !isDrawer && "min-h-[var(--layout-sidebar-page-row-height)]",
              "border-l-[3px] border-transparent bg-[var(--color-sidebar-page-bg)] font-normal text-black",
              "focus-visible:ring-black/35",
              activeLeaf
                ? "border-l-black bg-[var(--color-sidebar-page-active-bg)] font-semibold text-black"
                : "hover:bg-[var(--color-sidebar-page-hover)] hover:text-black",
            ),
      )}
      data-sidebar-level={isRootLeaf ? "section-leaf" : "page"}
      data-sidebar-page-active={activeLeaf ? "true" : undefined}
      href={node.href}
      style={{
        paddingLeft: pagePad,
        fontSize: isRootLeaf ? SIDEBAR_SECTION_FONT_PX : SIDEBAR_PAGE_FONT_PX,
      }}
      title={label}
      onClick={onNavigate}
    >
      {showIcons ? (
        <IconBox>
          <NavItemIcon
            className={cn(
              "h-[17px] w-[17px] shrink-0",
              !isRootLeaf && "text-[var(--color-sidebar-page-icon)]",
            )}
            labelKey={leafIconKey}
            surface={isRootLeaf ? "navy" : "light"}
          />
        </IconBox>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
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
  const treeRootRef = useRef<HTMLDivElement | null>(null);
  const { isExpanded, toggleExpanded, expandedIds } = useNavTreeExpansion(
    nodes,
    activeHref,
    storageScope,
    role,
    forceOpenIds,
  );

  useLayoutEffect(() => {
    const root = treeRootRef.current;
    if (!root) {
      return;
    }
    const active = root.querySelector<HTMLElement>('[aria-current="page"]');
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeHref, expandedIds, variant]);

  if (nodes.length === 0) {
    return null;
  }

  return (
    <div className="space-y-0" data-nav-tree={variant} ref={treeRootRef}>
      {nodes.map((node) => (
        <div
          className={
            variant === "sidebar"
              ? "border-b border-white/20 last:border-b-0"
              : "border-b border-neutral-300 last:border-b-0"
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
            showGuides
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
