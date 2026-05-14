"use client";

import { useEffect, useState } from "react";

import { useT } from "../../lib/i18n";

export function OfflineBanner() {
  const t = useT();
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);
    return () => {
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
    };
  }, []);

  if (online) {
    return null;
  }

  return (
    <div
      className="sticky top-0 z-[100] border-b border-[var(--color-warning-700)] bg-[var(--color-warning-50)] px-3 py-2 text-center text-sm font-medium text-[var(--color-warning-700)]"
      role="status"
    >
      {t(
        "offline.banner",
        "You are offline. Sign-in, clocking, and payroll need a connection.",
      )}
    </div>
  );
}
