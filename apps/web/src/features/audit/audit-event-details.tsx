"use client";

import { useState } from "react";

import { isAdministrator, useCurrentUser } from "../auth";
import {
  auditDetailRows,
  formatAuditDetailsJson,
} from "./audit-format";
import type { AuditEventListItem } from "./api";

type AuditEventDetailsProps = {
  event: AuditEventListItem;
};

export function AuditEventDetails({ event }: AuditEventDetailsProps) {
  const user = useCurrentUser();
  const showTechnical = isAdministrator(user);
  const [open, setOpen] = useState(false);
  const [showJson, setShowJson] = useState(false);

  const rows = auditDetailRows(event.details ?? {});
  const hasDetails = rows.length > 0;

  return (
    <div className="min-w-[5.5rem]">
      <button
        className="text-xs font-medium text-[var(--color-accent)] hover:underline disabled:text-[var(--color-text-muted)] disabled:no-underline"
        disabled={!hasDetails}
        type="button"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide details" : "View details"}
      </button>
      {open && hasDetails ? (
        <div className="mt-2 max-w-[min(28rem,calc(100vw-2rem))] rounded border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-2 text-xs shadow-sm">
          <dl className="max-h-48 space-y-1.5 overflow-y-auto">
            {rows.map((row) => (
              <div key={row.key} className="grid grid-cols-[minmax(6rem,38%)_1fr] gap-x-2 gap-y-0.5">
                <dt
                  className={`font-medium ${row.muted ? "text-[var(--color-text-soft)]" : "text-[var(--color-text-muted)]"}`}
                >
                  {row.label}
                </dt>
                <dd
                  className={`break-words ${row.muted ? "font-mono text-[10px] text-[var(--color-text-soft)]" : "text-[var(--color-text)]"}`}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          {showTechnical ? (
            <div className="mt-2 border-t border-[var(--color-border)] pt-2">
              <button
                className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                type="button"
                onClick={() => setShowJson((v) => !v)}
              >
                {showJson ? "Hide technical JSON" : "Technical JSON"}
              </button>
              {showJson ? (
                <pre className="mt-1 max-h-40 overflow-auto rounded border border-[var(--color-border)] bg-white p-2 font-mono text-[10px] leading-relaxed text-[var(--color-text-muted)]">
                  {formatAuditDetailsJson(event.details ?? {})}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
