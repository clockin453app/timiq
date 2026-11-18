"use client";

import { type ReactNode, useEffect, useState } from "react";

import { FinanceFieldState, FinanceStatusChip, type FinanceFieldKind } from "./finance-field-state";
import { formatMoneyCell } from "./finance-reconcile";
import "./finance-grid.css";
import "./finance-ui.css";

export type FinanceGridColumn = {
  id: string;
  label: string;
  align?: "left" | "right";
  width?: string;
  money?: boolean;
  /** Hide from compact phone summary; still in Full table. */
  compactHide?: boolean;
};

export type FinanceMoneyCell = {
  value: string | number | null | undefined;
  kind?: FinanceFieldKind;
  status?: string;
  statusTone?: "neutral" | "amber" | "red" | "green" | "blue";
};

export type FinanceGridRow = {
  id: string;
  cells: Record<string, ReactNode | string | number | null | undefined | FinanceMoneyCell>;
  depth?: number;
  expandable?: boolean;
  expanded?: boolean;
  subtotal?: boolean;
  child?: boolean;
  incomplete?: boolean;
  rowKind?: "project" | "code" | "subtotal" | "total" | "child";
  selected?: boolean;
  metricId?: string;
  amountColumnIds?: string[];
  meta?: Record<string, unknown>;
  /** Compact phone summary values (label, display). */
  compactMetrics?: Array<{ label: string; value: string; columnId?: string }>;
};

type Props = {
  columns: FinanceGridColumn[];
  rows: FinanceGridRow[];
  emptyTitle?: string;
  emptyText?: string;
  onToggle?: (row: FinanceGridRow) => void;
  onAmountClick?: (metricId: string, row: FinanceGridRow, columnId: string) => void;
  onRowSelect?: (row: FinanceGridRow) => void;
  /** Key columns shown in phone compact cards. */
  compactMetricColumnIds?: string[];
};

function isMoneyCellObject(value: unknown): value is FinanceMoneyCell {
  return Boolean(value) && typeof value === "object" && value !== null && "value" in (value as object);
}

function moneyKind(raw: string | number | null | undefined, incomplete?: boolean): FinanceFieldKind {
  if (raw === "missing" || raw === null || raw === undefined || String(raw).trim() === "") {
    return "missing-required";
  }
  if (incomplete) return "unverified";
  return "calculated";
}

export function FinanceDataGrid({
  columns,
  rows,
  emptyTitle = "No rows",
  emptyText = "No finance rows match this view.",
  onToggle,
  onAmountClick,
  onRowSelect,
  compactMetricColumnIds,
}: Props) {
  const [mode, setMode] = useState<"compact" | "full">("compact");
  const [isPhone, setIsPhone] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 430px)");
    const apply = () => setIsPhone(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

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

  const metricIds =
    compactMetricColumnIds ??
    columns.filter((column) => column.money).slice(0, 3).map((column) => column.id);

  function renderMoney(
    row: FinanceGridRow,
    column: FinanceGridColumn,
    raw: ReactNode | string | number | null | undefined | FinanceMoneyCell,
  ): ReactNode {
    const cell = isMoneyCellObject(raw) ? raw : null;
    const value = cell ? cell.value : (raw as string | number | null | undefined);
    const kind = cell?.kind ?? moneyKind(value, row.incomplete);
    const clickable = Boolean(row.metricId && onAmountClick);
    const text = kind === "missing-required" ? undefined : formatMoneyCell(value);

    return (
      <FinanceFieldState
        kind={kind}
        readOnly
        title={kind === "missing-required" ? "Missing value — not treated as £0.00" : "Open formula and source checks"}
        onActivate={clickable ? () => onAmountClick?.(String(row.metricId), row, column.id) : undefined}
      >
        {text}
      </FinanceFieldState>
    );
  }

  return (
    <div className="fdg-shell" data-finance-grid="true" data-mode={isPhone ? mode : "full"}>
      <div className="fdg-toolbar">
        <span className="sub">{rows.length} row{rows.length === 1 ? "" : "s"}</span>
        <div className="fdg-mode" role="group" aria-label="Table display mode">
          <button type="button" className={`btn${mode === "compact" ? " mainbtn" : ""}`} onClick={() => setMode("compact")}>
            Compact
          </button>
          <button type="button" className={`btn${mode === "full" ? " mainbtn" : ""}`} onClick={() => setMode("full")}>
            Full table
          </button>
        </div>
      </div>

      <div className="fdg-compact" aria-label="Compact finance table">
        {rows.map((row) => {
          const title = String(
            (isMoneyCellObject(row.cells[columns[0]?.id]) ? "" : row.cells[columns[0]?.id]) ||
              row.cells.code ||
              row.cells.project ||
              row.id,
          );
          const description = String(row.cells.description || row.cells.reference || "");
          const metrics =
            row.compactMetrics ??
            metricIds.map((id) => {
              const column = columns.find((item) => item.id === id);
              const raw = row.cells[id];
              const value = isMoneyCellObject(raw) ? raw.value : (raw as string | number | null | undefined);
              return {
                label: column?.label || id,
                value: formatMoneyCell(value),
                columnId: id,
              };
            });
          return (
            <div
              key={row.id}
              className={`fdg-compact-row${row.selected ? " selected" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => onRowSelect?.(row)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onRowSelect?.(row);
                }
              }}
            >
              <div className="fdg-compact-head">
                <div>
                  <div className="fdg-compact-title">
                    {row.expandable ? (
                      <button
                        type="button"
                        className="fdg-toggle"
                        aria-expanded={Boolean(row.expanded)}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggle?.(row);
                        }}
                      >
                        {row.expanded ? "▼" : "▶"}
                      </button>
                    ) : null}{" "}
                    {title}
                  </div>
                  {description ? <div className="sub">{description}</div> : null}
                </div>
                {row.incomplete ? <FinanceStatusChip tone="neutral">Incomplete</FinanceStatusChip> : null}
              </div>
              <div className="fdg-compact-metrics">
                {metrics.map((metric) => (
                  <div key={`${row.id}-${metric.label}`}>
                    <span className="cap">{metric.label}</span>
                    <button
                      type="button"
                      className="val linkbtn"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (row.metricId && metric.columnId) {
                          onAmountClick?.(String(row.metricId), row, metric.columnId);
                        } else {
                          onRowSelect?.(row);
                        }
                      }}
                    >
                      {metric.value}
                    </button>
                  </div>
                ))}
              </div>
              <div className="fdg-compact-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMode("full");
                  }}
                >
                  View full table
                </button>
                {row.metricId ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAmountClick?.(String(row.metricId), row, metricIds[0] || "actual");
                    }}
                  >
                    Source drawer
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="fdg-wrap">
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
                    row.subtotal || row.rowKind === "subtotal" ? "fdg-subtotal" : "",
                    row.rowKind === "project" ? "fdg-project" : "",
                    row.rowKind === "total" ? "fdg-total" : "",
                    row.rowKind === "code" ? "fdg-code" : "",
                    row.child || row.rowKind === "child" ? "fdg-child" : "",
                    row.incomplete ? "fdg-incomplete" : "",
                    row.selected ? "fdg-selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined}
                  onClick={() => onRowSelect?.(row)}
                >
                  {columns.map((column, index) => {
                    const raw = row.cells[column.id];
                    const isMoney = Boolean(column.money) || amountCols.has(column.id);
                    let content: ReactNode = raw as ReactNode;
                    if (isMoney && (typeof raw === "string" || typeof raw === "number" || raw == null || isMoneyCellObject(raw))) {
                      content = renderMoney(row, column, raw);
                    } else if (column.id === "status") {
                      if (raw !== null && raw !== undefined && typeof raw === "object") {
                        content = raw as ReactNode;
                      } else {
                        const tone = row.incomplete ? "neutral" : "blue";
                        content = (
                          <FinanceStatusChip tone={tone}>
                            {String(raw || (row.incomplete ? "Incomplete" : "—"))}
                          </FinanceStatusChip>
                        );
                      }
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
                              onClick={(event) => {
                                event.stopPropagation();
                                onToggle?.(row);
                              }}
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
    </div>
  );
}