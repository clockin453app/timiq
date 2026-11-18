"use client";

import type { ReactNode } from "react";

export type FinanceFieldKind =
  | "missing-required"
  | "calculated"
  | "source-linked"
  | "unverified"
  | "warning"
  | "error"
  | "verified"
  | "plain";

type Props = {
  kind: FinanceFieldKind;
  children?: ReactNode;
  label?: string;
  /** READ-ONLY pilot: never looks like an editable input. */
  readOnly?: boolean;
  onActivate?: () => void;
  title?: string;
};

/** Visual field semantics only — does not change money values or open write paths. */
export function FinanceFieldState({
  kind,
  children,
  label,
  readOnly = true,
  onActivate,
  title,
}: Props) {
  const text = label ?? children;
  const className = ["ff-field", `ff-${kind}`, readOnly ? "ff-readonly" : ""].filter(Boolean).join(" ");

  if (onActivate) {
    return (
      <button type="button" className={className} onClick={onActivate} title={title}>
        {kind === "missing-required" ? <span className="ff-missing-label">Not provided</span> : text}
        {kind === "calculated" ? <span className="ff-icon" aria-hidden>∑</span> : null}
        {kind === "source-linked" ? <span className="ff-icon" aria-hidden>⧉</span> : null}
      </button>
    );
  }

  return (
    <span className={className} title={title}>
      {kind === "missing-required" ? <span className="ff-missing-label">Not provided</span> : text}
      {kind === "calculated" ? <span className="ff-icon" aria-hidden>∑</span> : null}
      {kind === "source-linked" ? <span className="ff-icon" aria-hidden>⧉</span> : null}
    </span>
  );
}

export function FinanceStatusChip({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "amber" | "red" | "green" | "blue";
  children: ReactNode;
}) {
  return <span className={`ff-chip ff-chip-${tone}`}>{children}</span>;
}