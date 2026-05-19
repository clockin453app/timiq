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

  shellTopBar: [
    "border-b border-[var(--color-border)] bg-[var(--color-sheet)]",
    "shadow-[var(--shadow-card)]",
  ].join(" "),

  shellMain: "px-[var(--space-page-x)] py-[var(--space-page-y)]",

  navLinkBase:
    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border px-2.5 text-sm font-medium whitespace-nowrap",

  navLinkIdle: [
    "border-transparent text-[var(--color-text-muted)]",
    "hover:border-[var(--color-border)] hover:bg-[var(--color-header)] hover:text-[var(--color-text)]",
  ].join(" "),

  navLinkActive: [
    "border-[var(--color-brand)]/30 bg-[var(--color-brand-muted)] text-[var(--color-brand-hover)]",
  ].join(" "),

  navTriggerBase:
    "inline-flex h-9 items-center gap-1 rounded-[var(--radius-md)] border px-2.5 text-sm font-medium whitespace-nowrap",

  navTriggerIdle: [
    "border-transparent text-[var(--color-text-muted)]",
    "hover:border-[var(--color-border)] hover:bg-[var(--color-header)] hover:text-[var(--color-text)]",
  ].join(" "),

  navTriggerOpen: [
    "border-[var(--color-brand)]/25 bg-[var(--color-brand-muted)] text-[var(--color-text)]",
  ].join(" "),

  navDropdownPanel: [
    "rounded-[var(--radius-lg)] border border-[var(--color-border-dark)]",
    "bg-[var(--color-sheet)] py-1 shadow-[var(--shadow-dropdown)]",
  ].join(" "),

  navDropdownItem: [
    "mx-1 flex items-center gap-2 rounded-[var(--radius-md)] border border-transparent px-2.5 py-2",
    "text-sm font-medium break-words text-[var(--color-text)]",
    "outline-none transition-colors",
    "hover:border-[var(--color-border)] hover:bg-[var(--color-header)]",
    "focus-visible:shadow-[var(--focus-ring)]",
  ].join(" "),

  navDropdownItemActive: [
    "border-[var(--color-brand)]/30 bg-[var(--color-brand-muted)] text-[var(--color-brand-hover)]",
    "hover:bg-[var(--color-brand-muted)]",
  ].join(" "),

  navDrawerLinkBase:
    "flex min-h-[44px] min-w-0 max-w-full items-center gap-2.5 break-words rounded-[var(--radius-md)] border px-3 py-2.5 text-sm font-medium",

  navDrawerLinkIdle: [
    "border-transparent text-[var(--color-text-muted)]",
    "hover:border-[var(--color-border)] hover:bg-[var(--color-header)] hover:text-[var(--color-text)]",
  ].join(" "),

  navDrawerLinkActive: [
    "border-[var(--color-brand)]/30 bg-[var(--color-brand-muted)] font-semibold text-[var(--color-brand-hover)]",
  ].join(" "),

  navAccordionHeader: [
    "flex w-full min-w-0 items-center justify-between gap-2 rounded-[var(--radius-md)] border px-2 py-1.5",
    "text-left text-sm font-medium transition-colors",
  ].join(" "),

  navAccordionHeaderIdle: [
    "border-transparent text-[var(--color-text-muted)]",
    "hover:border-[var(--color-border)] hover:bg-[var(--color-header)] hover:text-[var(--color-text)]",
  ].join(" "),

  navAccordionHeaderOpen: [
    "border-[var(--color-brand)]/30 bg-[var(--color-brand-muted)] text-[var(--color-brand-hover)]",
  ].join(" "),

  bottomNavBar: [
    "border-t border-[var(--color-border)] bg-[var(--color-sheet)]",
    "shadow-[0_-1px_3px_rgba(15,23,42,0.06)]",
  ].join(" "),

  bottomNavItemBase:
    "flex min-h-[44px] min-w-0 flex-col items-center justify-center gap-0.5 px-1 py-1 text-center text-[11px] leading-tight",

  bottomNavItemIdle: "text-[var(--color-text-muted)] hover:bg-[var(--color-header)]",

  bottomNavItemActive:
    "bg-[var(--color-brand-muted)] font-semibold text-[var(--color-brand-hover)]",

  headerIconButton: [
    "inline-flex h-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border",
    "border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)]",
    "text-[var(--color-text-muted)] hover:bg-[var(--color-btn-default-hover)] hover:text-[var(--color-text)]",
  ].join(" "),

  headerIconButtonActive: [
    "border-[var(--color-brand)]/30 bg-[var(--color-brand-muted)] text-[var(--color-brand-hover)]",
  ].join(" "),

  payeFilterLabel: "timiq-label block text-[10px] uppercase tracking-wide text-[var(--color-text-soft)]",

  payeFilterSelect:
    "timiq-select mt-1 h-10 w-full max-w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm text-[var(--color-text)]",

  payeFilterInput:
    "timiq-input mt-1 h-10 w-full max-w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm text-[var(--color-text)]",

  payeStatLabel: "timiq-caption font-semibold uppercase tracking-wide text-[var(--color-text-soft)]",

  payeStatValue: "timiq-money mt-1 block text-[var(--color-text)]",

  payeStatValueLg: "timiq-money-lg mt-1 block text-[var(--color-text)]",

  payeLinkButton:
    "text-xs font-semibold text-[var(--color-accent)] underline hover:text-[var(--color-brand-hover)]",

  payeTableMeta: "mt-1 space-y-0.5 text-xs leading-snug text-[var(--color-text-muted)]",

  payeActionToolbar: "flex flex-wrap items-center gap-2",
} as const;

export type UiClassKey = keyof typeof uiClasses;
