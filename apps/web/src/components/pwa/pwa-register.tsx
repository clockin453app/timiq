"use client";

import { useEffect } from "react";

/**
 * Registers the service worker in production only.
 * SW caches only /offline.html, manifest, and local SVG icons — never /api/* or app HTML.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* ignore registration errors */
    });
  }, []);

  return null;
}
