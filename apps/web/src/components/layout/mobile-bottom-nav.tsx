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
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-[var(--color-border-dark)] bg-[var(--color-header)] text-[11px] md:hidden">
      {mobilePrimaryLinks.map((item) => (
        <Link
          className={
            item.href === activeHref
              ? "border-r border-[var(--color-border)] bg-[var(--color-cell)] px-2 py-2 text-center font-semibold text-[var(--color-text)]"
              : "border-r border-[var(--color-border)] px-2 py-2 text-center text-[var(--color-text-muted)]"
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