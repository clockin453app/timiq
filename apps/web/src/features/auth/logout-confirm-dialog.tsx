"use client";

import { useEffect, useId, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";

import { Button } from "../../components/ui";
import { useT } from "../../lib/i18n";

type LogoutConfirmDialogProps = {
  open: boolean;
  isLoggingOut: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
};

export function LogoutConfirmDialog({
  open,
  isLoggingOut,
  onCancel,
  onConfirm,
  returnFocusRef,
}: LogoutConfirmDialogProps) {
  const t = useT();
  const titleId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const cancelHandlerRef = useRef(onCancel);
  const loggingOutRef = useRef(isLoggingOut);

  cancelHandlerRef.current = onCancel;
  loggingOutRef.current = isLoggingOut;

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const focusCancel = window.requestAnimationFrame(() => cancelRef.current?.focus());
    const backgroundElements = Array.from(document.body.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && !element.contains(overlayRef.current),
    );
    const previousInert = backgroundElements.map((element) => [element, element.inert] as const);
    backgroundElements.forEach((element) => {
      element.inert = true;
    });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loggingOutRef.current) {
        event.preventDefault();
        cancelHandlerRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.tabIndex !== -1);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialogRef.current.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    const keepFocusInside = (event: FocusEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(event.target as Node)) {
        cancelRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    document.addEventListener("focusin", keepFocusInside);
    return () => {
      window.cancelAnimationFrame(focusCancel);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", keepFocusInside);
      previousInert.forEach(([element, inert]) => {
        element.inert = inert;
      });
      window.requestAnimationFrame(() => {
        if (returnFocusRef.current?.isConnected) {
          returnFocusRef.current.focus();
        }
      });
    };
  }, [open, returnFocusRef]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      aria-labelledby={titleId}
      aria-describedby={descId}
      aria-modal="true"
      className="fixed inset-0 z-[1200] flex items-center justify-center p-4"
      ref={overlayRef}
      role="dialog"
    >
      <button
        aria-label={t("common.logout_confirm_cancel", "Cancel")}
        className="absolute inset-0 cursor-default bg-black/30"
        disabled={isLoggingOut}
        tabIndex={-1}
        type="button"
        onClick={onCancel}
      />
      <div
        className="relative z-[1] w-full max-w-sm rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-4 shadow-[0_10px_28px_rgba(15,23,42,0.16)]"
        ref={dialogRef}
        tabIndex={-1}
      >
        <h2 className="text-base font-semibold text-[var(--color-text)]" id={titleId}>
          {t("common.logout_confirm_title", "Log out?")}
        </h2>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]" id={descId}>
          {t(
            "common.logout_confirm_message",
            "You will need to sign in again to access TimIQ.",
          )}
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button
            ref={cancelRef}
            disabled={isLoggingOut}
            onClick={onCancel}
            type="button"
            variant="secondary"
          >
            {t("common.logout_confirm_cancel", "Cancel")}
          </Button>
          <Button disabled={isLoggingOut} onClick={onConfirm} type="button" variant="primary">
            {t("common.logout_confirm_action", "Log out")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
