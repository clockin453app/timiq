"use client";

import { useEffect } from "react";

import { useCurrentUser } from "../../features/auth";
import { syncExistingPushSubscriptionForCurrentSession } from "../../features/notifications/push";

export function PushSubscriptionSync() {
  const user = useCurrentUser();

  useEffect(() => {
    if (!user.id) {
      return undefined;
    }

    const sync = () => {
      void syncExistingPushSubscriptionForCurrentSession(user.id);
    };

    sync();

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        sync();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [user.id]);

  return null;
}
