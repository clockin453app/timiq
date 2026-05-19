/**
 * Shared Tailwind class fragments for TimIQ UI primitives.
 * Use with `cn()` so pages can adopt premium styling incrementally in later batches.
 */
export const uiClasses = {
  card: [
    "box-border w-full min-w-0 max-w-full",
    "rounded-[var(--radius-lg)] border border-[var(--color-border-dark)]",
    "bg-[var(--color-sheet)] shadow-[var(--shadow-card)]",
  ].join(" "),

  cardPadding: "p-[var(--space-card)]",

  cardHeader: [
    "border-b border-[var(--color-border)]",
    "bg-[var(--color-header)] px-[var(--space-card)] py-3",
  ].join(" "),

  cardBody: "px-[var(--space-card)] py-[var(--space-card)]",

  sectionGap: "space-y-[var(--space-section)]",

  pageHeader: [
    "flex w-full min-w-0 flex-col items-stretch gap-3",
    "border-b border-[var(--color-border)] bg-[var(--color-sheet)]",
    "px-[var(--space-card)] py-3 sm:flex-row sm:items-start sm:justify-between",
    "sm:px-5 sm:py-4",
  ].join(" "),

  tableWrap: [
    "max-w-full min-w-0 w-full overflow-x-auto",
    "rounded-[var(--radius-md)] border border-[var(--color-border-dark)]",
    "[-webkit-overflow-scrolling:touch]",
  ].join(" "),

  toolbar: [
    "flex flex-wrap items-center gap-2",
    "rounded-[var(--radius-md)] border border-[var(--color-border-dark)]",
    "bg-[var(--color-toolbar-well)] p-3",
  ].join(" "),

  focusRing: "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",

  transitionColors: "transition-colors duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-standard)]",

  touchTarget: "min-h-[44px] min-w-[44px] touch-manipulation",
} as const;

export type UiClassKey = keyof typeof uiClasses;
