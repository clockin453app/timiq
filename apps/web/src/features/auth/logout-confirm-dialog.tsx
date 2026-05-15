"use client";

import { useEffect, useId, useRef } from "react";

import { Button } from "../../components/ui";
import { useT } from "../../lib/i18n";

type LogoutConfirmDialogProps = {
  open: boolean;
  isLoggingOut: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function LogoutConfirmDialog({
  open,
  isLoggingOut,
  onCancel,
  onConfirm,
}: LogoutConfirmDialogProps) {
  const t = useT();
  const titleId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isLoggingOut) {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isLoggingOut, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <div
      aria-labelledby={titleId}
      aria-describedby={descId}
      aria-modal="true"
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="dialog"
    >
      <button
        aria-label={t("common.logout_confirm_cancel", "Cancel")}
        className="absolute inset-0 cursor-default bg-black/30"
        disabled={isLoggingOut}
        type="button"
        onClick={onCancel}
      />
      <div className="relative z-[1] w-full max-w-sm rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-4 shadow-[0_10px_28px_rgba(15,23,42,0.16)]">
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
    </div>
  );
}
