"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { Button } from "../../components/ui";
import { cn } from "../../lib/cn";
import { clearAllTimiqOfflineData } from "../../features/offline/db";
import { useI18n } from "../../lib/i18n";
import { logout } from "./api";

type LogoutButtonProps = {
  className?: string;
  size?: "md" | "sm";
  iconOnly?: boolean;
};

export function LogoutButton({
  className,
  size = "md",
  iconOnly = false,
}: LogoutButtonProps = {}) {
  const router = useRouter();
  const { setLocale, t } = useI18n();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

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
    }
  }

  const label = isLoggingOut ? t("common.logging_out", "Logging out...") : t("common.logout", "Logout");

  if (iconOnly) {
    return (
      <button
        aria-label={label}
        className={cn(
          "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] text-[var(--color-text-muted)] hover:bg-[var(--color-btn-default-hover)] hover:text-[var(--color-text)] disabled:pointer-events-none disabled:opacity-60",
          className,
        )}
        disabled={isLoggingOut}
        onClick={() => void handleLogout()}
        title={label}
        type="button"
      >
        <LogOut aria-hidden className="h-4 w-4" />
      </button>
    );
  }

  return (
    <Button
      className={className}
      disabled={isLoggingOut}
      onClick={() => void handleLogout()}
      size={size}
      type="button"
      variant="secondary"
    >
      {label}
    </Button>
  );
}