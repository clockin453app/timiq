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
    "border-b border-[var(--color-topbar-border)] bg-[var(--color-topbar-bg)]",
    "text-[var(--color-topbar-fg-muted)] shadow-[0_1px_3px_rgba(15,23,42,0.08)]",
  ].join(" "),

  topBarFocusRing: "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring-topbar)]",

  topBarBrandTitle: "m-0 text-base font-semibold leading-snug tracking-tight text-[var(--color-topbar-fg)]",

  topBarBrandSubtitle: "m-0 text-xs leading-tight text-[var(--color-topbar-fg-subtle)]",

  topBarNavLinkIdle: [
    "border-transparent text-[var(--color-topbar-fg-muted)]",
    "hover:border-[var(--color-topbar-hover-border)] hover:bg-[var(--color-topbar-hover-bg)] hover:text-[var(--color-topbar-fg)]",
  ].join(" "),

  topBarNavLinkActive: [
    "border-[var(--color-topbar-active-border)] bg-[var(--color-topbar-active-bg)] text-[var(--color-topbar-active-fg)]",
    "shadow-[var(--shadow-topbar-active)]",
    "hover:bg-[var(--color-topbar-active-bg)] hover:text-[var(--color-topbar-active-fg)]",
  ].join(" "),

  topBarNavTriggerIdle: [
    "border-transparent text-[var(--color-topbar-fg-muted)]",
    "hover:border-[var(--color-topbar-hover-border)] hover:bg-[var(--color-topbar-hover-bg)] hover:text-[var(--color-topbar-fg)]",
  ].join(" "),

  topBarNavTriggerOpen: [
    "border-[var(--color-topbar-active-border)] bg-[var(--color-topbar-active-bg)] text-[var(--color-topbar-active-fg)]",
    "shadow-[var(--shadow-topbar-active)]",
    "hover:bg-[var(--color-topbar-active-bg)] hover:text-[var(--color-topbar-active-fg)]",
  ].join(" "),

  topBarChromeButton: [
    "inline-flex min-h-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] border",
    "border-[var(--color-topbar-chrome-btn-border)] bg-[var(--color-topbar-chrome-btn-bg)]",
    "text-[var(--color-topbar-chrome-btn-fg)]",
    "hover:bg-[var(--color-topbar-chrome-btn-hover)] hover:text-[var(--color-topbar-chrome-btn-fg)]",
  ].join(" "),

  topBarNavTransition: [
    "transition-[color,background-color,border-color,box-shadow]",
    "duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-standard)]",
  ].join(" "),

  topBarNavLinkBase:
    "inline-flex h-[2.625rem] shrink-0 items-center gap-2.5 rounded-[var(--radius-md)] border px-3 text-sm font-semibold whitespace-nowrap",

  topBarNavTriggerBase:
    "inline-flex h-[2.625rem] shrink-0 items-center gap-2.5 rounded-[var(--radius-md)] border px-3 text-sm font-semibold whitespace-nowrap",

  shellMain: "px-[var(--space-page-x)] py-[var(--space-page-y)]",

  navLinkBase:
    "inline-flex h-9 shrink-0 items-center gap-2 rounded-[var(--radius-md)] border px-2.5 text-sm font-semibold whitespace-nowrap",

  navLinkIdle: [
    "border-transparent text-[var(--color-text-muted)]",
    "hover:border-[var(--color-border)] hover:bg-[var(--color-header)] hover:text-[var(--color-text)]",
  ].join(" "),

  navLinkActive: [
    "border-[var(--color-brand)]/30 bg-[var(--color-brand-muted)] text-[var(--color-brand-hover)]",
  ].join(" "),

  navTriggerBase:
    "inline-flex h-9 shrink-0 items-center gap-2 rounded-[var(--radius-md)] border px-2.5 text-sm font-semibold whitespace-nowrap",

  navTriggerIdle: [
    "border-transparent text-[var(--color-text-muted)]",
    "hover:border-[var(--color-border)] hover:bg-[var(--color-header)] hover:text-[var(--color-text)]",
  ].join(" "),

  navTriggerOpen: [
    "border-[var(--color-brand)]/25 bg-[var(--color-brand-muted)] text-[var(--color-text)]",
  ].join(" "),

  /** White dropdown panels (mobile drawer, legacy). */
  navDropdownPanel: [
    "rounded-[var(--radius-lg)] border border-[var(--color-border-dark)]",
    "bg-[var(--color-sheet)] py-1 shadow-[var(--shadow-dropdown)]",
  ].join(" "),

  navDropdownItem: [
    "mx-1 flex items-center gap-2.5 rounded-[var(--radius-md)] border border-transparent px-2.5 py-2",
    "text-sm font-medium break-words text-[var(--color-text)]",
    "outline-none transition-colors",
    "hover:border-[var(--color-border)] hover:bg-[var(--color-header)]",
    "focus-visible:shadow-[var(--focus-ring)]",
  ].join(" "),

  navDropdownItemActive: [
    "border-[var(--color-brand)]/30 bg-[var(--color-brand-muted)] text-[var(--color-brand-hover)]",
    "hover:bg-[var(--color-brand-muted)]",
  ].join(" "),

  /** Navy-themed desktop top-bar dropdown (matches chrome). */
  topBarDropdownPanel: [
    "rounded-[var(--radius-lg)] border border-[var(--color-topbar-hover-border)]",
    "bg-[var(--color-topbar-bg)] py-2 shadow-[var(--shadow-dropdown)]",
  ].join(" "),

  topBarDropdownItem: [
    "mx-1.5 flex items-center gap-3 rounded-[var(--radius-md)] border border-transparent px-3 py-2.5",
    "text-sm font-medium break-words text-[var(--color-topbar-fg-muted)]",
    "outline-none transition-[color,background-color,border-color]",
    "duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-standard)]",
    "hover:border-[var(--color-topbar-hover-border)] hover:bg-[var(--color-topbar-hover-bg)] hover:text-[var(--color-topbar-fg)]",
    "focus-visible:shadow-[var(--focus-ring-topbar)]",
  ].join(" "),

  topBarDropdownItemActive: [
    "border-[var(--color-topbar-active-border)] bg-[var(--color-topbar-active-bg)] font-semibold text-[var(--color-topbar-active-fg)]",
    "shadow-[var(--shadow-topbar-active)]",
    "hover:border-[var(--color-topbar-active-border)] hover:bg-[var(--color-topbar-active-bg)] hover:text-[var(--color-topbar-active-fg)]",
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

  publicPage: "timiq-public-page flex min-h-dvh w-full min-w-0 flex-col",

  publicMain: "mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10",

  publicHeroTitle: "m-0 text-2xl font-bold leading-tight tracking-tight text-[var(--color-public-on-dark-fg)] sm:text-3xl lg:text-4xl",

  publicHeroSubtitle: "mt-3 max-w-2xl text-sm leading-relaxed text-[var(--color-public-on-dark-muted)] sm:text-base",

  publicMutedOnDark: "text-[var(--color-public-on-dark-soft)]",

  publicLinkOnDark:
    "font-semibold text-[var(--color-public-on-dark-link)] underline decoration-white/40 underline-offset-2 hover:decoration-white",

  publicLoginGrid:
    "grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] lg:gap-10 lg:items-start xl:gap-12",

  publicLoginIntroSlot: "order-1 min-w-0 lg:col-start-1 lg:row-start-1",

  publicLoginFormSlot: "order-2 min-w-0 w-full lg:col-start-2 lg:row-start-1 lg:row-span-4 lg:pt-1",

  publicLoginDemoSlot: "order-3 min-w-0 lg:col-start-1 lg:row-start-2",

  publicLoginBenefitsSlot: "order-4 min-w-0 lg:col-start-1 lg:row-start-3",

  publicLoginFooterSlot: "order-5 min-w-0 lg:col-start-1 lg:row-start-4",

  publicSignInTarget: "scroll-mt-[calc(var(--layout-topbar-height)+1rem)]",

  publicLoginCard: [
    "w-full min-w-0 max-w-[28rem] rounded-[var(--radius-lg)] border border-[var(--color-border-dark)]",
    "bg-[var(--color-sheet)] shadow-[var(--shadow-card)] lg:mx-0 lg:max-w-none",
  ].join(" "),

  publicFeatureCard: [
    "rounded-[var(--radius-lg)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)]",
    "p-4 shadow-[var(--shadow-card)] sm:p-5",
  ].join(" "),

  publicFeatureCardOnDark: [
    "rounded-[var(--radius-lg)] border border-white/15 bg-white/5 p-4 backdrop-blur-sm sm:p-5",
  ].join(" "),

  /** Readable compliance / info card on pale gradient areas. */
  publicComplianceSheet: [
    "border-[var(--color-border-dark)] bg-[var(--color-sheet)] text-[var(--color-text-muted)]",
    "shadow-[var(--shadow-card)]",
  ].join(" "),

  publicExploreText: "text-sm text-[var(--color-text-muted)]",

  publicExploreLink:
    "font-semibold text-[var(--color-brand)] underline decoration-[var(--color-brand)]/30 underline-offset-2 hover:text-[var(--color-brand-hover)]",

  publicContentCard: [
    "rounded-[var(--radius-lg)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)]",
    "p-5 shadow-[var(--shadow-card)] sm:p-6",
  ].join(" "),

  publicCtaPrimary: [
    "inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)]",
    "border border-[var(--color-topbar-chrome-btn-border)] bg-[var(--color-topbar-chrome-btn-bg)]",
    "px-4 text-sm font-semibold text-[var(--color-topbar-chrome-btn-fg)]",
    "hover:bg-[var(--color-topbar-chrome-btn-hover)]",
  ].join(" "),

  publicCtaSecondary: [
    "inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)]",
    "border border-white/25 bg-white/10 px-4 text-sm font-semibold text-[var(--color-topbar-fg)]",
    "hover:bg-white/15",
  ].join(" "),

  publicNavLink: [
    "rounded-[var(--radius-md)] px-2.5 py-1.5 text-sm font-medium text-[var(--color-topbar-fg-muted)]",
    "hover:bg-[var(--color-topbar-hover-bg)] hover:text-[var(--color-topbar-fg)]",
  ].join(" "),

  publicNavLinkActive: [
    "rounded-[var(--radius-md)] bg-[var(--color-topbar-active-bg)] px-2.5 py-1.5",
    "text-sm font-semibold text-[var(--color-topbar-active-fg)]",
  ].join(" "),

  publicDemoCta: [
    "rounded-[var(--radius-lg)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)]",
    "p-6 shadow-[var(--shadow-card)] sm:p-8",
  ].join(" "),
} as const;

export type UiClassKey = keyof typeof uiClasses;
