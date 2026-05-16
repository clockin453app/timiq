"use client";

import { useEffect, useMemo, useState } from "react";

import { fetchFaceReferenceImage } from "./api";

function initialsFromIdentity(name: string | null | undefined, email: string | null | undefined): string {
  const cleanedName = (name || "").trim();
  if (cleanedName) {
    const parts = cleanedName.split(/\s+/).filter(Boolean);
    const chars = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0].slice(0, 2);
    return chars.toUpperCase();
  }
  const cleanedEmail = (email || "").trim();
  if (cleanedEmail) {
    return cleanedEmail.slice(0, 2).toUpperCase();
  }
  return "EE";
}

export function FaceReferenceAvatar({
  userId,
  employeeName,
  employeeEmail,
  sizeClassName = "h-9 w-9",
}: {
  userId: string;
  employeeName?: string | null;
  employeeEmail?: string | null;
  sizeClassName?: string;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const initials = useMemo(
    () => initialsFromIdentity(employeeName, employeeEmail),
    [employeeName, employeeEmail],
  );

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setImageUrl(null);

    async function load() {
      try {
        const blob = await fetchFaceReferenceImage(userId);
        if (cancelled) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      } catch {
        if (!cancelled) {
          setImageUrl(null);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [userId]);

  if (imageUrl) {
    return (
      <img
        alt=""
        className={`${sizeClassName} shrink-0 rounded-full border border-[var(--color-border-dark)] object-cover`}
        src={imageUrl}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${sizeClassName} inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--color-border-dark)] bg-slate-100 text-xs font-bold text-slate-700`}
    >
      {initials}
    </span>
  );
}
