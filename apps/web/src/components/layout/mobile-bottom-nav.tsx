import Link from "next/link";

type MobileBottomNavProps = {
  activeHref?: string;
};

const mobilePrimaryLinks = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Clock", href: "/clock" },
  { label: "Sheets", href: "/timesheets" },
  { label: "Week", href: "/week-report" },
  { label: "More", href: "/profile" },
];

export function MobileBottomNav({ activeHref = "/dashboard" }: MobileBottomNavProps) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-[var(--color-border-dark)] bg-[var(--color-header)] text-[11px] leading-tight md:hidden">
      {mobilePrimaryLinks.map((item) => (
        <Link
          className={
            item.href === activeHref
              ? "min-w-0 border-r border-[var(--color-border)] bg-[var(--color-btn-active-bg)] px-1.5 py-2 text-center font-bold text-[var(--color-text)]"
              : "min-w-0 border-r border-[var(--color-border)] px-1.5 py-2 text-center text-[var(--color-text-muted)] hover:bg-[var(--color-cell)]"
          }
          href={item.href}
          key={item.href}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}