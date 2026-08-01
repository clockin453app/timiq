"use client";

import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import { Button } from "./button";

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
};

/**
 * Apply (+ optional Refresh) for filter toolbars.
 * Mobile: ≥44px, full/flex width, labelled controls.
 * Desktop (`md+`): compact inline density.
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
}: FilterActionRowProps) {
  const showRefresh = Boolean(refreshLabel && onRefresh);
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
        className={cn(
          "min-h-11 w-full touch-manipulation min-[360px]:min-w-0 min-[360px]:flex-1",
          "md:h-8 md:min-h-8 md:w-auto md:flex-none",
        )}
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
          className={cn(
            "min-h-11 w-full touch-manipulation min-[360px]:min-w-0 min-[360px]:flex-1",
            "md:h-8 md:min-h-8 md:w-auto md:flex-none",
          )}
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
