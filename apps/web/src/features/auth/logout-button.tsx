"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { Button } from "../../components/ui";
import { cn } from "../../lib/cn";
import { clearAllTimiqOfflineData } from "../../features/offline/db";
import { useI18n } from "../../lib/i18n";
import { logout } from "./api";
import { LogoutConfirmDialog } from "./logout-confirm-dialog";

type LogoutButtonProps = {
  className?: string;
  size?: "md" | "sm";
  iconOnly?: boolean;
  showIcon?: boolean;
  /** Full-width drawer/menu row (not a boxed secondary button). */
  appearance?: "button" | "menuRow";
};

export function LogoutButton({
  className,
  size = "md",
  iconOnly = false,
  showIcon = false,
  appearance = "button",
}: LogoutButtonProps = {}) {
  const router = useRouter();
  const { setLocale, t } = useI18n();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);

  async function handleLogout() {
    setIsLoggingOut(true);

    try {
      await logout();
      await clearAllTimiqOfflineData();
      setLocale("en-GB");
      router.replace("/login");
      router.refresh();
    } finally {
      setIsLoggingOut(false);
      setConfirmOpen(false);
    }
  }

  function openConfirm() {
    if (!isLoggingOut) {
      setConfirmOpen(true);
    }
  }

  function closeConfirm() {
    if (!isLoggingOut) {
      setConfirmOpen(false);
    }
  }

  const label = isLoggingOut ? t("common.logging_out", "Logging out...") : t("common.logout", "Logout");

  const dialog = (
    <LogoutConfirmDialog
      isLoggingOut={isLoggingOut}
      open={confirmOpen}
      onCancel={closeConfirm}
      onConfirm={() => void handleLogout()}
      returnFocusRef={openerRef}
    />
  );

  if (appearance === "menuRow") {
    return (
      <>
        <button
          ref={openerRef}
          aria-label={label}
          className={cn(
            "flex min-h-10 w-full min-w-0 max-w-full items-center gap-2 rounded-none border border-transparent px-2 py-1.5 text-left text-[length:var(--text-nav-row)] font-medium",
            "text-[var(--color-danger-700)] hover:bg-[var(--color-danger-50)]",
            "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] disabled:pointer-events-none disabled:opacity-60",
            className,
          )}
          disabled={isLoggingOut}
          onClick={openConfirm}
          type="button"
        >
          <LogOut aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </button>
        {dialog}
      </>
    );
  }

  if (iconOnly) {
    return (
      <>
        <button
          ref={openerRef}
          aria-label={label}
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] text-[var(--color-text-muted)] hover:bg-[var(--color-btn-default-hover)] hover:text-[var(--color-text)] disabled:pointer-events-none disabled:opacity-60",
            className,
          )}
          disabled={isLoggingOut}
          onClick={openConfirm}
          title={label}
          type="button"
        >
          <LogOut aria-hidden className="h-4 w-4" />
        </button>
        {dialog}
      </>
    );
  }

  return (
    <>
      <Button
        ref={openerRef}
        className={className}
        disabled={isLoggingOut}
        onClick={openConfirm}
        size={size}
        type="button"
        variant="secondary"
      >
        {showIcon ? <LogOut aria-hidden className="h-4 w-4 shrink-0" /> : null}
        {label}
      </Button>
      {dialog}
    </>
  );
}
