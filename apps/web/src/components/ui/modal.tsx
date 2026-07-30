"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "../../lib/cn";

type ModalProps = {
  title: string;
  /** Secondary line under the title, e.g. the employee being edited. */
  subtitle?: ReactNode;
  children: ReactNode;
  /** Action row pinned below the scrolling body. */
  footer?: ReactNode;
  onClose: () => void;
  /** Tailwind max-width for the panel on `sm` and up. */
  widthClassName?: string;
  labelledById?: string;
};

/**
 * Viewport-safe modal shell: never wider than the viewport minus safe margins,
 * height capped against `100dvh`, and only the body scrolls so the title and
 * action row stay reachable when the mobile keyboard is open.
 */
export function Modal({
  children,
  footer,
  labelledById = "timiq-modal-title",
  onClose,
  subtitle,
  title,
  widthClassName = "sm:max-w-[min(40rem,calc(100vw-3rem))]",
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-start justify-center overflow-x-hidden overflow-y-auto bg-black/45 p-2 sm:p-4 md:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        aria-labelledby={labelledById}
        aria-modal="true"
        className={cn(
          "mx-auto mt-3 flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] shadow-[var(--shadow-modal)] sm:mt-8",
          "max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-4rem)]",
          widthClassName,
        )}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-sheet)] px-[var(--space-modal)] py-2.5 sm:py-3">
          <h2 className="timiq-title-dialog" id={labelledById}>
            {title}
          </h2>
          {subtitle ? <p className="timiq-caption mt-0.5 break-words">{subtitle}</p> : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-[var(--space-modal)] py-[var(--space-modal)] [-webkit-overflow-scrolling:touch]">
          {children}
        </div>

        {footer ? (
          <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-header)] px-[var(--space-modal)] py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom,0px))]">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
