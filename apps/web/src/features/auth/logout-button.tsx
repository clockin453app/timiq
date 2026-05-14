"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "../../components/ui";
import { clearAllTimiqOfflineData } from "../../features/offline/db";
import { useI18n } from "../../lib/i18n";
import { logout } from "./api";

export function LogoutButton() {
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

  return (
    <Button disabled={isLoggingOut} onClick={handleLogout} type="button" variant="secondary">
      {isLoggingOut ? t("common.logging_out", "Logging out...") : t("common.logout", "Logout")}
    </Button>
  );
}