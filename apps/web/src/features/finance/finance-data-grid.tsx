"use client";

import { type ReactNode } from "react";

import "./finance-grid.css";
import { formatMoneyCell } from "./finance-reconcile";

export type FinanceGridColumn = {
  id: string;
  label: string;
  align?: "left" | "right";
  width?: string;
  money?: boolean;
};

export type FinanceGridRow = {
  id: string;
  cells: Record<string, ReactNode | string | number | null | undefined>;
  depth?: number;
  expandable?: boolean;
  expanded?: boolean;
  subtotal?: boolean;
  child?: boolean;
  incomplete?: boolean;
  metricId?: string;
  amountColumnIds?: string[];
  meta?: Record<string, unknown>;
};

type Props = {
  columns: FinanceGridColumn[];
  rows: FinanceGridRow[];
  emptyTitle?: string;
  emptyText?: string;
  onToggle?: (row: FinanceGridRow) => void;
  onAmountClick?: (metricId: string, row: FinanceGridRow, columnId: string) => void;
};

export function FinanceDataGrid({
  columns,
  rows,
  emptyTitle = "No rows",
  emptyText = "No finance rows match this view.",
  onToggle,
  onAmountClick,
}: Props) {
  if (!rows.length) {
    return (
      <div className="fdg-wrap">
        <div className="fdg-empty">
          <strong>{emptyTitle}</strong>
          <div>{emptyText}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fdg-wrap" data-finance-grid="true">
      <table className="fdg-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                className={column.align === "right" || column.money ? "fdg-num" : undefined}
                style={column.width ? { width: column.width, minWidth: column.width } : undefined}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const depth = row.depth ?? 0;
            const amountCols = new Set(row.amountColumnIds ?? columns.filter((c) => c.money).map((c) => c.id));
            return (
              <tr
                key={row.id}
                className={[
                  row.subtotal ? "fdg-subtotal" : "",
                  row.child ? "fdg-child" : "",
                  row.incomplete ? "fdg-incomplete" : "",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined}
              >
                {columns.map((column, index) => {
                  const raw = row.cells[column.id];
                  const isMoney = Boolean(column.money);
                  const clickable = Boolean(
                    row.metricId && amountCols.has(column.id) && onAmountClick && raw != null && raw !== "" && raw !== "missing",
                  );
                  let content: ReactNode = raw as ReactNode;
                  if (isMoney && (typeof raw === "string" || typeof raw === "number" || raw == null)) {
                    const text = formatMoneyCell(raw as string | number | null | undefined);
                    content = clickable ? (
                      <button
                        type="button"
                        className="fdg-amount-btn"
                        onClick={() => onAmountClick?.(String(row.metricId), row, column.id)}
                      >
                        {text}
                      </button>
                    ) : (
                      text
                    );
                  }
                  if (index === 0) {
                    content = (
                      <span className="fdg-tree">
                        {row.expandable ? (
                          <button
                            type="button"
                            className="fdg-toggle"
                            aria-expanded={Boolean(row.expanded)}
                            aria-label={row.expanded ? "Collapse row" : "Expand row"}
                            title={row.expanded ? "Collapse" : "Expand"}
                            onClick={() => onToggle?.(row)}
                          >
                            {row.expanded ? "▼" : "▶"}
                          </button>
                        ) : (
                          <span className="fdg-toggle-spacer" aria-hidden>
                            {depth >= 2 ? "└" : depth === 1 ? "·" : ""}
                          </span>
                        )}
                        <span className="fdg-label">
                          {content}
                          {row.incomplete ? <span className="fdg-incomplete-tag">Incomplete</span> : null}
                        </span>
                      </span>
                    );
                  }
                  return (
                    <td
                      key={column.id}
                      className={[
                        column.align === "right" || column.money ? "fdg-num" : "",
                        index === 0 && depth === 1 ? "fdg-indent-1" : "",
                        index === 0 && depth >= 2 ? "fdg-indent-2" : "",
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined}
                    >
                      {content}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
