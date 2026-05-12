import type { ReactNode } from "react";

type AuthShellProps = {
  children: ReactNode;
  title: string;
  subtitle?: string;
};

export function AuthShell({ children, subtitle, title }: AuthShellProps) {
  return (
    <main className="timiq-page flex min-h-dvh w-full min-w-0 flex-col items-center justify-center px-4 py-10 sm:px-6">
      <section className="timiq-sheet w-full max-w-[min(30rem,calc(100vw-2rem))] shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
        <div className="timiq-sheet-header px-4 py-3">
          <p className="timiq-caption font-semibold">TimIQ</p>
        </div>

        <div className="border-b border-[var(--color-border)] px-4 py-4">
          <h1 className="timiq-title-lg">{title}</h1>

          {subtitle ? <p className="timiq-body mt-1">{subtitle}</p> : null}
        </div>

        <div className="px-4 py-5">{children}</div>
      </section>
    </main>
  );
}