"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "../../components/ui";
import { clearAllTimiqOfflineData } from "../../features/offline/db";
import { logout } from "./api";

export function LogoutButton() {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);

    try {
      await logout();
      await clearAllTimiqOfflineData();
      router.replace("/login");
      router.refresh();
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <Button disabled={isLoggingOut} onClick={handleLogout} type="button" variant="secondary">
      {isLoggingOut ? "Logging out..." : "Logout"}
    </Button>
  );
}