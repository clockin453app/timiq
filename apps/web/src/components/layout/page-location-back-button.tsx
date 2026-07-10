"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { cn } from "../../lib/cn";
import { useT } from "../../lib/i18n";

const APP_HOME_FALLBACK = "/overview";

type PageLocationBackButtonProps = {
  className?: string;
};

export function canSafelyNavigateBack(): boolean {
  if (typeof window === "undefined" || window.history.length <= 1) {
    return false;
  }

  const referrer = document.referrer;
  if (!referrer) {
    // Client-side in-app navigation often leaves referrer empty while history is valid.
    return true;
  }

  try {
    return new URL(referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function PageLocationBackButton({ className }: PageLocationBackButtonProps) {
  const router = useRouter();
  const t = useT();

  const handleBack = useCallback(() => {
    if (canSafelyNavigateBack()) {
      router.back();
      return;
    }
    router.push(APP_HOME_FALLBACK);
  }, [router]);

  return (
    <button
      className={cn(
        "shrink-0 rounded-md border-0 bg-transparent px-0 py-0.5 text-xs font-semibold text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/30",
        className,
      )}
      onClick={handleBack}
      type="button"
    >
      {t("shell.back", "← Back")}
    </button>
  );
}
