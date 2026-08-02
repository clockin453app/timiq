"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Filter, Search, X } from "lucide-react";

import { cn } from "../../lib/cn";
import { Button } from "./button";

const FILTER_PANEL_Z = 1300;

type PopoverPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

/** Viewport-safe fixed position for the desktop Filters popover (portaled). */
function computeFilterPopoverPosition(anchor: HTMLElement): PopoverPosition {
  const rect = anchor.getBoundingClientRect();
  const viewportPad = 16;
  const gap = 8;
  const preferredWidth = 448;
  const width = Math.min(preferredWidth, Math.max(280, window.innerWidth - viewportPad * 2));
  const maxAllowed = Math.min(window.innerHeight - 32, window.innerHeight - viewportPad * 2);

  const spaceBelow = window.innerHeight - rect.bottom - gap - viewportPad;
  const spaceAbove = rect.top - gap - viewportPad;
  const placeBelow = spaceBelow >= 240 || spaceBelow >= spaceAbove;

  let top: number;
  let maxHeight: number;
  if (placeBelow) {
    top = rect.bottom + gap;
    maxHeight = Math.min(maxAllowed, Math.max(160, window.innerHeight - top - viewportPad));
  } else {
    maxHeight = Math.min(maxAllowed, Math.max(160, spaceAbove));
    top = Math.max(viewportPad, rect.top - gap - maxHeight);
  }

  let left = rect.right - width;
  left = Math.max(viewportPad, Math.min(left, window.innerWidth - viewportPad - width));

  return { top, left, width, maxHeight };
}

export type FilterActionRowProps = {
  applyLabel: string;
  onApply?: () => void;
  /** Use `submit` when the row sits inside a `<form>`. */
  applyType?: "button" | "submit";
  applyDisabled?: boolean;
  applyVariant?: "primary" | "secondary";
  refreshLabel?: string;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
  className?: string;
  /**
   * `dense` (default): desktop compact (`md` ~32px) for older toolbars.
   * `comfortable`: keep ≥44px controls on all breakpoints (payroll workbench).
   */
  density?: "dense" | "comfortable";
};

/**
 * Apply (+ optional Refresh) for filter toolbars.
 * Mobile: ≥44px, full/flex width, labelled controls.
 * Desktop (`md+`): compact inline density unless `density="comfortable"`.
 */
export function FilterActionRow({
  applyLabel,
  onApply,
  applyType = "button",
  applyDisabled = false,
  applyVariant = "primary",
  refreshLabel,
  onRefresh,
  refreshDisabled = false,
  className,
  density = "dense",
}: FilterActionRowProps) {
  const showRefresh = Boolean(refreshLabel && onRefresh);
  const buttonSizeClass =
    density === "comfortable"
      ? "min-h-11 w-full touch-manipulation min-[360px]:min-w-0 min-[360px]:flex-1 md:w-auto md:flex-none"
      : cn(
          "min-h-11 w-full touch-manipulation min-[360px]:min-w-0 min-[360px]:flex-1",
          "md:h-8 md:min-h-8 md:w-auto md:flex-none",
        );
  return (
    <div
      className={cn(
        "flex w-full min-w-0 max-w-full flex-col gap-2",
        "min-[360px]:flex-row min-[360px]:items-stretch",
        "md:w-auto md:flex-nowrap md:items-end",
        className,
      )}
      data-testid="filter-action-row"
    >
      <Button
        className={buttonSizeClass}
        disabled={applyDisabled}
        onClick={applyType === "button" ? onApply : undefined}
        size="md"
        type={applyType}
        variant={applyVariant}
      >
        {applyLabel}
      </Button>
      {showRefresh ? (
        <Button
          className={buttonSizeClass}
          disabled={refreshDisabled}
          onClick={onRefresh}
          size="md"
          type="button"
          variant="secondary"
        >
          {refreshLabel}
        </Button>
      ) : null}
    </div>
  );
}

export type ResponsiveFilterGridProps = {
  dates?: ReactNode;
  company?: ReactNode;
  employee?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Optional extra rows (hints, checkboxes) after the core filter fields. */
  footer?: ReactNode;
};

/**
 * Layout-only filter grid. Stacks on narrow phones; compact row from `md`.
 * Order on mobile: dates → company → employee → actions.
 */
export function ResponsiveFilterGrid({
  dates,
  company,
  employee,
  actions,
  className,
  footer,
}: ResponsiveFilterGridProps) {
  return (
    <div
      className={cn("flex w-full min-w-0 max-w-full flex-col gap-3", className)}
      data-testid="responsive-filter-grid"
    >
      <div
        className={cn(
          "flex w-full min-w-0 flex-col gap-3",
          "md:flex-row md:flex-wrap md:items-end md:gap-2",
        )}
      >
        {dates ? <div className="w-full min-w-0 md:min-w-[16rem] md:flex-[1.2]">{dates}</div> : null}
        {company ? <div className="w-full min-w-0 md:w-44 md:flex-none">{company}</div> : null}
        {employee ? (
          <div className="w-full min-w-0 md:min-w-[12rem] md:flex-1">{employee}</div>
        ) : null}
        {actions ? <div className="w-full min-w-0 md:w-auto md:flex-none">{actions}</div> : null}
      </div>
      {footer ? <div className="min-w-0">{footer}</div> : null}
    </div>
  );
}

const controlHeight = "h-11 min-h-11";

/** Compact filter toolbar shell — subtle surface, not a large card. */
export function FilterToolbar({
  children,
  className,
  "aria-label": ariaLabel = "Filters",
}: {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        "w-full min-w-0 max-w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-3",
        className,
      )}
      data-testid="filter-toolbar"
      role="search"
    >
      {children}
    </div>
  );
}

export type FilterSearchProps = {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "id" | "type" | "className">;

/**
 * Search field with leading Search icon.
 * Icon sits in a flex gutter (not overlaid) so placeholder/text never collide,
 * and native search clear controls keep right padding.
 */
export function FilterSearch({
  id,
  label = "Search",
  value,
  onChange,
  placeholder = "Search…",
  className,
  ...rest
}: FilterSearchProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={cn("w-full min-w-0", className)}>
      <label className="sr-only" htmlFor={inputId}>
        {label}
      </label>
      <div
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-3",
          controlHeight,
          "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-btn-primary-border)]",
        )}
        data-testid="filter-search"
      >
        <Search
          aria-hidden
          className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]"
          data-testid="filter-search-icon"
        />
        <input
          className={cn(
            "min-h-0 min-w-0 flex-1 border-0 bg-transparent py-2 text-sm text-[var(--color-text)] outline-none",
            "placeholder:text-[var(--color-text-muted)]",
            // Native search clear (WebKit) must not collide with typed text.
            "[&::-webkit-search-cancel-button]:me-0.5",
          )}
          id={inputId}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          type="search"
          value={value}
          {...rest}
        />
      </div>
    </div>
  );
}

export type FilterButtonProps = {
  activeCount?: number;
  open?: boolean;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>;

/** Funnel Filters control with optional active-count badge. */
export const FilterButton = forwardRef<HTMLButtonElement, FilterButtonProps>(function FilterButton(
  { activeCount = 0, open = false, className, children = "Filters", ...props },
  ref,
) {
  const countLabel = activeCount > 0 ? `Filters, ${activeCount} active` : "Filters";
  return (
    <Button
      aria-expanded={open}
      aria-label={countLabel}
      className={cn(controlHeight, "shrink-0 gap-1.5 px-3", className)}
      data-testid="filter-button"
      ref={ref}
      type="button"
      variant="secondary"
      {...props}
    >
      <Filter aria-hidden className="h-4 w-4 shrink-0" />
      <span>{children}</span>
      {activeCount > 0 ? (
        <span
          aria-hidden
          className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-[var(--color-btn-primary-bg)] px-1.5 py-0.5 text-[11px] font-bold leading-none text-[var(--color-btn-primary-fg)]"
        >
          {activeCount}
        </span>
      ) : null}
    </Button>
  );
});

export function FilterClearAction({
  onClick,
  className,
  disabled,
}: {
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Button
      className={cn(controlHeight, "shrink-0 gap-1 px-2.5", className)}
      data-testid="filter-clear"
      disabled={disabled}
      onClick={onClick}
      type="button"
      variant="ghost"
    >
      <X aria-hidden className="h-4 w-4 shrink-0" />
      Clear
    </Button>
  );
}

/**
 * Desktop Filters popover — portaled to `document.body` with fixed positioning,
 * flip-above collision, and max-height so ancestors (`overflow-auto` / `overflow-hidden`
 * in AppShell) cannot clip the panel.
 */
export function FilterPopover({
  open,
  onClose,
  anchorRef,
  title = "Filters",
  activeCount,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  /** Filters button ref used for anchor + focus return. */
  anchorRef: RefObject<HTMLElement | null>;
  title?: string;
  activeCount?: number;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  useLayoutEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) {
        setPosition(null);
        return;
      }
      setPosition(computeFilterPopoverPosition(anchor));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (panelRef.current && target && !panelRef.current.contains(target)) {
        if (anchor && (anchor === target || anchor.contains(target as Node))) return;
        const trigger = (target as HTMLElement).closest?.("[data-testid='filter-button']");
        if (trigger) return;
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    const t = window.setTimeout(() => {
      const firstField = panelRef.current?.querySelector<HTMLElement>(
        "input, select, button, textarea",
      );
      (firstField ?? panelRef.current)?.focus();
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      if (anchor && typeof anchor.focus === "function") {
        anchor.focus();
      }
    };
  }, [open, anchorRef]);

  if (!open || !mounted || !position || typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] shadow-[var(--shadow-dropdown)]",
        className,
      )}
      data-collision-padding="16"
      data-testid="filter-popover"
      ref={panelRef}
      role="dialog"
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        width: position.width,
        maxWidth: "calc(100vw - 24px)",
        maxHeight: position.maxHeight,
        zIndex: FILTER_PANEL_Z,
      }}
      tabIndex={-1}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <h3 className="min-w-0 text-sm font-semibold text-[var(--color-text)]" id={titleId}>
          {title}
          {activeCount != null && activeCount > 0 ? (
            <span className="ml-2 text-xs font-medium text-[var(--color-text-muted)]">({activeCount} active)</span>
          ) : null}
        </h3>
        <Button
          aria-label="Close filters"
          className="min-h-11 shrink-0 md:min-h-9"
          onClick={onClose}
          size="sm"
          type="button"
          variant="ghost"
        >
          Close
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-3">
        {children}
      </div>
      {footer ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-header)] px-4 py-3">
          {footer}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

/**
 * Mobile Filters bottom sheet — portaled, viewport-fixed, sticky header/footer,
 * scrollable body, backdrop, and body scroll lock.
 */
export function MobileFilterSheet({
  open,
  onClose,
  title = "Filters",
  activeCount,
  children,
  footer,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  activeCount?: number;
  children: ReactNode;
  footer?: ReactNode;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [mounted, setMounted] = useState(false);

  useLayoutEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => {
      const firstField = panelRef.current?.querySelector<HTMLElement>(
        "input, select, button, textarea",
      );
      (firstField ?? panelRef.current)?.focus();
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      const el = returnFocusRef?.current;
      if (el && typeof el.focus === "function") {
        el.focus();
      }
    };
  }, [open, returnFocusRef]);

  if (!open || !mounted || typeof document === "undefined") return null;

  return createPortal(
    <div className="contents" data-testid="mobile-filter-sheet-root">
      <div
        aria-hidden
        className="fixed inset-0 bg-black/45"
        data-testid="mobile-filter-sheet-backdrop"
        onMouseDown={() => onClose()}
        style={{ zIndex: FILTER_PANEL_Z }}
      />
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="fixed inset-x-0 bottom-0 flex max-h-[90dvh] w-full min-w-0 max-w-full flex-col overflow-hidden rounded-t-[var(--radius-lg)] border border-b-0 border-[var(--color-border-dark)] bg-[var(--color-cell)] shadow-[var(--shadow-modal)]"
        data-testid="mobile-filter-sheet"
        onMouseDown={(event) => event.stopPropagation()}
        ref={panelRef}
        role="dialog"
        style={{ zIndex: FILTER_PANEL_Z + 1 }}
        tabIndex={-1}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
          <h3 className="min-w-0 text-sm font-semibold text-[var(--color-text)]" id={titleId}>
            {title}
            {activeCount != null && activeCount > 0 ? (
              <span className="ml-2 text-xs font-medium text-[var(--color-text-muted)]">({activeCount} active)</span>
            ) : null}
          </h3>
          <Button
            aria-label="Close filters"
            className="min-h-11 shrink-0"
            onClick={onClose}
            size="sm"
            type="button"
            variant="ghost"
          >
            Close
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-3 pb-4">
          {children}
        </div>
        {footer ? (
          <div className="flex shrink-0 flex-col gap-2 border-t border-[var(--color-border)] bg-[var(--color-header)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:flex-row sm:justify-end">
            {footer}
          </div>
        ) : (
          <div className="flex shrink-0 border-t border-[var(--color-border)] bg-[var(--color-header)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
            <Button className="min-h-11 w-full" onClick={onClose} type="button" variant="secondary">
              Done
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Convenience type for open panel mode. */
export type FilterPanelMode = "closed" | "desktop" | "mobile";

export { controlHeight as filterControlHeightClass };
