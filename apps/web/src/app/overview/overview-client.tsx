"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Clock,
  Info,
  MapPin,
  Shield,
  Users,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  Badge,
  Button,
} from "../../components/ui";
import { isAdministrator, useCurrentUser } from "../../features/auth";
import {
  fetchManagementOverview,
  type NeedsAttentionItem,
  type OverviewData,
  type PayrollReadinessPanel,
  type SetupHealthPanel,
  type TodayLiveRow,
} from "../../features/dashboard/api";
import { CompanySelector } from "../../features/companies/company-selector";
import { listCompanies, type Company } from "../../features/companies/api";
import { useAdministratorCompanyScope } from "../../features/companies/selected-company";
import { formatMoneyGBP } from "../../features/payroll/format";
import { formatDurationSeconds } from "../../features/time-records/format-duration";
import { cn } from "../../lib/cn";
import { payrollStatusLabel, useT } from "../../lib/i18n";

type OverviewSectionTone =
  | "attention"
  | "attendance"
  | "live"
  | "payroll"
  | "readiness"
  | "health"
  | "activity"
  | "actions"
  | "trends";

const OVERVIEW_CHART_VIEW_WIDTH = 480;
const OVERVIEW_CHART_VIEW_HEIGHT = 168;
const OVERVIEW_CHART_DISPLAY_CLASS = "h-[148px] w-full max-w-full min-h-[120px]";
const OVERVIEW_CHART_PADDING = {
  line: { top: 6, right: 6, bottom: 18, left: 26 },
  bar: { top: 6, right: 6, bottom: 20, left: 30 },
} as const;

const OVERVIEW_DASH_CARD =
  "rounded-2xl border border-slate-200/70 bg-white shadow-[0_2px_12px_rgba(20,55,102,0.06)]";
const CHART_STROKE = "#2563eb";
const CHART_STROKE_MUTED = "#bfdbfe";
const CHART_BAR_FILL = "#3b82f6";
const CHART_BAR_FILL_MUTED = "#dbeafe";

function OverviewDashboardSection(props: {
  action?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
  title: string;
}) {
  return (
    <section className={cn("flex h-full min-h-0 flex-col overflow-hidden", OVERVIEW_DASH_CARD, props.className)}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{props.title}</h2>
          {props.badge}
        </div>
        {props.action ? <div className="flex shrink-0 flex-wrap items-center gap-1.5">{props.action}</div> : null}
      </div>
      <div className="min-h-0 flex-1 px-4 py-3">{props.children}</div>
    </section>
  );
}

function OverviewTintedSection(props: {
  action?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
  compactBody?: boolean;
  denseHeader?: boolean;
  description?: string;
  title: string;
  tone: OverviewSectionTone;
}) {
  return (
    <OverviewDashboardSection
      action={props.action}
      badge={props.badge}
      className={props.className}
      title={props.title}
    >
      {props.description ? (
        <p className="mb-2 text-[11px] leading-snug text-[var(--color-text-muted)]">{props.description}</p>
      ) : null}
      {props.children}
    </OverviewDashboardSection>
  );
}

function OverviewChartWidget(props: {
  caption: string;
  children: ReactNode;
  summary?: string;
  title: string;
}) {
  return (
    <div className="flex h-full min-h-[200px] min-w-0 flex-col rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_2px_12px_rgba(20,55,102,0.06)]">
      <div className="mb-2 flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{props.title}</h3>
        {props.summary ? (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-600">
            {props.summary}
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">{props.children}</div>
      <p className="mt-0.5 shrink-0 text-[10px] leading-snug text-[var(--color-text-soft)]">{props.caption}</p>
    </div>
  );
}

function OverviewChartEmpty(props: { message: string }) {
  return (
    <div className="flex min-h-[3.25rem] items-center rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-dark)] bg-[var(--color-header)]/55 px-3 py-2.5">
      <p className="text-xs leading-snug text-[var(--color-text-muted)] sm:text-sm">{props.message}</p>
    </div>
  );
}

function formatPercent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) {
    return "—";
  }
  return `${Math.round(rate * 1000) / 10}%`;
}

function formatShortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) {
    return isoDate;
  }
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit" }).format(
    new Date(Date.UTC(y, m - 1, d, 12, 0, 0)),
  );
}

type ChartPoint = {
  key: string;
  label: string;
  value: number;
  tooltip: string;
};

function buildLineGeometry(
  values: number[],
  width: number,
  height: number,
  padding: { top: number; right: number; bottom: number; left: number },
) {
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? innerW / (values.length - 1) : 0;

  const coords = values.map((value, index) => {
    const x = padding.left + index * step;
    const y = padding.top + innerH - (value / max) * innerH;
    return { x, y, value };
  });

  const linePath =
    coords.length > 0
      ? `M ${coords.map((point) => `${point.x} ${point.y}`).join(" L ")}`
      : "";

  const areaPath =
    coords.length > 0
      ? `${linePath} L ${coords[coords.length - 1]?.x ?? padding.left} ${padding.top + innerH} L ${coords[0]?.x ?? padding.left} ${padding.top + innerH} Z`
      : "";

  return { coords, linePath, areaPath, max, innerH, padding };
}

function OverviewLineChart(props: { points: ChartPoint[]; emptyHint: string }) {
  const width = OVERVIEW_CHART_VIEW_WIDTH;
  const height = OVERVIEW_CHART_VIEW_HEIGHT;
  const padding = OVERVIEW_CHART_PADDING.line;
  const values = props.points.map((point) => point.value);

  if (props.points.length === 0) {
    return <OverviewChartEmpty message={props.emptyHint} />;
  }

  const { coords, linePath, areaPath, max, innerH, padding: pad } = buildLineGeometry(
    values,
    width,
    height,
    padding,
  );
  const yTicks = [0, max];

  return (
    <div className="w-full min-w-0">
      <svg
        aria-label="Attendance trend chart"
        className={OVERVIEW_CHART_DISPLAY_CLASS}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        {yTicks.map((tick, index) => {
          const y = pad.top + innerH - (tick / max) * innerH;
          return (
            <g key={`attendance-y-grid-${index}`}>
              <line
                stroke="var(--color-border)"
                strokeDasharray="3 3"
                strokeOpacity="0.55"
                x1={pad.left}
                x2={width - pad.right}
                y1={y}
                y2={y}
              />
              {index === 1 ? (
                <text
                  fill="var(--color-text-soft)"
                  fontSize="9"
                  textAnchor="end"
                  x={pad.left - 4}
                  y={y + 3}
                >
                  {tick}
                </text>
              ) : null}
            </g>
          );
        })}
        <path d={areaPath} fill={CHART_STROKE} fillOpacity="0.12" />
        <path
          d={linePath}
          fill="none"
          stroke={CHART_STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
        />
        {coords.map((point, index) => (
          <g key={props.points[index]?.key ?? index}>
            <circle cx={point.x} cy={point.y} fill={CHART_STROKE} r="3.5" />
            <title>{props.points[index]?.tooltip}</title>
          </g>
        ))}
        {props.points.map((point, index) => {
          const x = coords[index]?.x ?? pad.left;
          return (
            <text
              fill="var(--color-text-muted)"
              fontSize="9"
              key={point.key}
              textAnchor="middle"
              x={x}
              y={height - 6}
            >
              {point.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function OverviewBarChart(props: {
  points: ChartPoint[];
  currentKey?: string | null;
  emptyHint: string;
}) {
  const width = OVERVIEW_CHART_VIEW_WIDTH;
  const height = OVERVIEW_CHART_VIEW_HEIGHT;
  const padding = OVERVIEW_CHART_PADDING.bar;

  if (props.points.length === 0) {
    return <OverviewChartEmpty message={props.emptyHint} />;
  }

  const values = props.points.map((point) => point.value);
  const max = Math.max(1, ...values);
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const barGap = 8;
  const barWidth = Math.max(14, (innerW - barGap * (props.points.length - 1)) / props.points.length);
  const yTicks = [0, max];

  return (
    <div className="w-full min-w-0">
      <svg
        aria-label="Payroll trend chart"
        className={OVERVIEW_CHART_DISPLAY_CLASS}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        {yTicks.map((tick, index) => {
          const y = padding.top + innerH - (tick / max) * innerH;
          return (
            <g key={`payroll-y-grid-${index}`}>
              <line
                stroke="var(--color-border)"
                strokeDasharray="3 3"
                strokeOpacity="0.55"
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
              />
              {index === 1 ? (
                <text
                  fill="var(--color-text-soft)"
                  fontSize="9"
                  textAnchor="end"
                  x={padding.left - 4}
                  y={y + 3}
                >
                  {tick >= 1000 ? `£${Math.round(tick / 1000)}k` : `£${tick}`}
                </text>
              ) : null}
            </g>
          );
        })}
        {props.points.map((point, index) => {
          const barHeight = (point.value / max) * innerH;
          const x = padding.left + index * (barWidth + barGap);
          const y = padding.top + innerH - barHeight;
          const isCurrent = props.currentKey === point.key;
          return (
            <g key={point.key}>
              <rect
                fill={isCurrent ? CHART_BAR_FILL : CHART_BAR_FILL_MUTED}
                height={point.value === 0 ? 2 : barHeight}
                rx="4"
                stroke={isCurrent ? CHART_STROKE : "transparent"}
                strokeWidth={isCurrent ? 1 : 0}
                width={barWidth}
                x={x}
                y={point.value === 0 ? padding.top + innerH - 2 : y}
              >
                <title>{point.tooltip}</title>
              </rect>
              <text
                fill="var(--color-text-muted)"
                fontSize="8"
                textAnchor="middle"
                x={x + barWidth / 2}
                y={height - 6}
              >
                {point.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

type KpiIconTone = "employees" | "locations" | "attendance" | "payroll" | "pending" | "openShifts";

const KPI_ICON_WELL: Record<KpiIconTone, string> = {
  employees: "border-[#bfdbfe] bg-[#eff6ff] text-[#2563eb]",
  locations: "border-[#ddd6fe] bg-[#f5f3ff] text-[#7c3aed]",
  attendance: "border-[#bbf7d0] bg-[#ecfdf5] text-[#16a34a]",
  payroll: "border-[#fde68a] bg-[#fffbeb] text-[#d97706]",
  pending: "border-[#fed7aa] bg-[#fff7ed] text-[#ea580c]",
  openShifts: "border-[#bae6fd] bg-[#f0f9ff] text-[#0284c7]",
};

function OverviewKpiCard(props: {
  href: string;
  title: string;
  primary: string;
  secondary?: string;
  icon: LucideIcon;
  iconTone: KpiIconTone;
}) {
  const Icon = props.icon;

  return (
    <Link
      className={cn(
        "group block min-w-0 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_2px_12px_rgba(20,55,102,0.06)] transition-shadow hover:shadow-[0_4px_16px_rgba(20,55,102,0.1)]",
      )}
      href={props.href}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border",
            KPI_ICON_WELL[props.iconTone],
          )}
        >
          <Icon aria-hidden className="h-5 w-5" strokeWidth={2} />
        </span>
        <Info aria-hidden className="h-3.5 w-3.5 shrink-0 text-slate-300" />
      </div>
      <p className="mt-3 text-2xl font-bold tabular-nums leading-none tracking-tight text-slate-900 sm:text-[1.75rem]">
        {props.primary}
      </p>
      <p className="mt-1.5 text-sm font-medium text-slate-700">{props.title}</p>
      {props.secondary ? (
        <p className="mt-1 line-clamp-2 text-xs leading-snug text-slate-500">{props.secondary}</p>
      ) : null}
    </Link>
  );
}

function OverviewCommandCenterStrip(props: {
  adminControls?: ReactNode;
  generatedAt?: string;
  hasAttentionItems: boolean;
  scopeLabel?: string | null;
  statusLine: string;
  t: ReturnType<typeof useT>;
}) {
  const statusDotClass = props.hasAttentionItems ? "bg-[#f59e0b]" : "bg-[#22c55e]";

  return (
    <div className="rounded-2xl border border-[#bfdbfe]/80 bg-gradient-to-r from-[#eff6ff] via-[#f8fbff] to-[#f0f9ff] px-4 py-4 shadow-[0_2px_12px_rgba(37,99,235,0.08)] sm:px-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3.5 sm:items-center">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#93c5fd]/60 bg-white text-[#2563eb] shadow-sm">
            <Shield aria-hidden className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#2563eb]">
              {props.t("overview.command_center", "Operations command center")}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full", statusDotClass)} />
              <p className="text-sm font-medium text-slate-700">{props.statusLine}</p>
            </div>
            {props.scopeLabel ? (
              <p className="mt-1 text-xs text-slate-500">
                {props.t("overview.showing_data_for", "Showing data for")}{" "}
                <span className="font-medium text-slate-700">{props.scopeLabel}</span>
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {props.adminControls ? (
            <div className="flex flex-wrap items-center gap-2">{props.adminControls}</div>
          ) : null}
          {props.generatedAt ? (
            <>
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                {props.t("overview.last_updated", "Last updated {{time}}", {
                  time: new Date(props.generatedAt).toLocaleString(),
                })}
              </span>
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                {props.t("overview.auto_refresh_short", "Auto-refresh 45s")}
              </span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function attentionSeverityIcon(severity: NeedsAttentionItem["severity"]) {
  if (severity === "critical") {
    return AlertTriangle;
  }
  if (severity === "warning") {
    return AlertTriangle;
  }
  return Info;
}

function NeedsAttentionPanel(props: {
  items: NeedsAttentionItem[];
  scopeNote: string | null;
  t: ReturnType<typeof useT>;
}) {
  const itemCount = props.items.length;

  return (
    <OverviewDashboardSection
      badge={
        itemCount > 0 ? (
          <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
            {itemCount}
          </span>
        ) : null
      }
      className="h-full"
      title={props.t("overview.needs_attention", "Needs attention")}
    >
      {props.items.length === 0 ? (
        <div className="flex items-center gap-2.5 py-1">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 aria-hidden className="h-4 w-4" />
          </span>
          <p className="text-sm text-slate-600">
            {props.t("overview.empty_attention", "No urgent action required.")}
          </p>
        </div>
      ) : (
        <ul className="space-y-1">
          {props.items.map((item) => {
            const ItemIcon = attentionSeverityIcon(item.severity);
            const iconWellClass =
              item.severity === "critical"
                ? "border-red-200 bg-red-50 text-red-600"
                : item.severity === "warning"
                  ? "border-amber-200 bg-amber-50 text-amber-600"
                  : "border-blue-200 bg-blue-50 text-blue-600";

            return (
              <li key={item.code}>
                <Link
                  className="flex items-center gap-3 rounded-xl px-1 py-2 transition-colors hover:bg-slate-50"
                  href={item.href}
                >
                  <span
                    className={cn(
                      "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
                      iconWellClass,
                    )}
                  >
                    <ItemIcon aria-hidden className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{item.label}</p>
                  </span>
                  <span
                    className={cn(
                      "inline-flex h-6 min-w-[1.5rem] shrink-0 items-center justify-center rounded-full px-2 text-xs font-semibold",
                      item.severity === "critical"
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-700",
                    )}
                  >
                    {item.count}
                  </span>
                  <ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-slate-400" />
                </Link>
              </li>
            );
          })}
          {props.items.length === 1 ? (
            <li className="px-1 pt-1">
              <p className="text-xs text-slate-400">
                {props.t("overview.no_other_urgent", "No other urgent action items.")}
              </p>
            </li>
          ) : null}
        </ul>
      )}
      {props.scopeNote ? (
        <p className="mt-2 text-[11px] text-slate-400">{props.scopeNote}</p>
      ) : null}
    </OverviewDashboardSection>
  );
}

function readinessPercent(readiness: PayrollReadinessPanel): number | null {
  if (readiness.total_items <= 0) {
    return null;
  }
  const complete = readiness.approved_count + readiness.paid_count;
  return Math.min(100, Math.max(0, Math.round((complete / readiness.total_items) * 100)));
}

function ReadinessDonut(props: {
  percent: number | null;
  payrollStatus?: string;
  payrollStatusText?: string;
}) {
  const donutSize = "h-[7.5rem] w-[7.5rem]";

  if (props.percent === null) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center rounded-full border-[5px] border-slate-200 bg-slate-50 text-sm font-semibold text-slate-400",
          donutSize,
        )}
      >
        —
      </div>
    );
  }

  const radius = 14.5;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (props.percent / 100) * circumference;
  const progressStroke = props.percent >= 80 ? "#16a34a" : props.percent >= 50 ? "#d97706" : "#dc2626";
  const statusLabel = props.payrollStatusText ?? "Ready";

  return (
    <div className={cn("relative shrink-0", donutSize)}>
      <svg aria-hidden className={cn("-rotate-90", donutSize)} viewBox="0 0 36 36">
        <circle cx="18" cy="18" fill="none" r={radius} stroke="#e2e8f0" strokeWidth="4.5" />
        <circle
          cx="18"
          cy="18"
          fill="none"
          r={radius}
          stroke={progressStroke}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          strokeWidth="4.5"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold tabular-nums leading-none text-slate-900">{props.percent}%</span>
        <span className="mt-1 text-[11px] font-medium text-slate-500">{statusLabel}</span>
      </div>
    </div>
  );
}

function ReadinessChecklistRow(props: { label: string; ok: boolean }) {
  return (
    <li className="flex items-center gap-2.5 py-1 text-sm">
      {props.ok ? (
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
        </span>
      ) : (
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
        </span>
      )}
      <span className={props.ok ? "text-slate-500" : "font-medium text-slate-800"}>{props.label}</span>
    </li>
  );
}

function OverviewReadinessPanel(props: {
  readiness: PayrollReadinessPanel | null;
  unavailableLabel: string;
  t: ReturnType<typeof useT>;
}) {
  const { readiness, t } = props;

  if (!readiness) {
    return (
      <OverviewTintedSection
        className="h-full"
        compactBody
        denseHeader
        title={t("overview.payroll_readiness", "Payroll readiness")}
        tone="readiness"
      >
        <p className="text-sm text-[var(--color-text-muted)]">{props.unavailableLabel}</p>
      </OverviewTintedSection>
    );
  }

  const percent = readinessPercent(readiness);
  const checklist = [
    {
      label: t("overview.readiness_rate_missing", "Rate missing"),
      ok: readiness.rate_missing_count === 0,
    },
    {
      label: t("overview.readiness_not_calculated", "Not calculated"),
      ok: !readiness.payroll_period_not_calculated,
    },
    {
      label: t("overview.readiness_pending", "Pending"),
      ok: readiness.pending_count === 0,
    },
    {
      label: t("overview.readiness_open_shifts_week", "Open shifts (week)"),
      ok: readiness.open_shifts_started_in_week_count === 0,
    },
    {
      label: t("overview.readiness_needs_recalc", "Needs recalc"),
      ok: !readiness.payroll_needs_recalculation,
    },
  ];

  return (
    <OverviewTintedSection
      action={
        <Link
          className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[var(--color-brand)] hover:text-[var(--color-brand-hover)]"
          href={readiness.href}
        >
          {t("overview.open_payroll_report")}
          <ArrowRight aria-hidden className="h-3 w-3" />
        </Link>
      }
      className="h-full"
      compactBody
      denseHeader
      title={t("overview.payroll_readiness", "Payroll readiness")}
      tone="readiness"
    >
      <div className="flex items-center gap-4">
        <ReadinessDonut
          payrollStatus={readiness.payroll_status}
          payrollStatusText={payrollStatusLabel(t, readiness.payroll_status)}
          percent={percent}
        />
        <ul className="min-w-0 flex-1 space-y-0">
          {checklist.map((row) => (
            <ReadinessChecklistRow key={row.label} label={row.label} ok={row.ok} />
          ))}
        </ul>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        {readiness.total_items} {t("overview.readiness_items", "items").toLowerCase()} · {readiness.pending_count}{" "}
        {t("overview.readiness_pending", "pending").toLowerCase()} · {readiness.approved_count}{" "}
        {t("overview.readiness_approved", "approved").toLowerCase()} · {readiness.paid_count}{" "}
        {t("overview.readiness_paid", "paid").toLowerCase()} ·{" "}
        {readiness.total_gross != null ? formatMoneyGBP(String(readiness.total_gross)) : "—"} ·{" "}
        {formatDurationSeconds(readiness.total_hours_seconds)}
      </p>
    </OverviewTintedSection>
  );
}

function HealthCheckRow(props: {
  label: string;
  value: ReactNode;
  href?: string;
  bordered?: boolean;
  status?: "ok" | "warn" | "neutral";
}) {
  const valueNode = props.href ? (
    <Link className="font-semibold text-[var(--color-brand)] hover:text-[var(--color-brand-hover)]" href={props.href}>
      {props.value}
    </Link>
  ) : (
    <span className="font-semibold text-[var(--color-text)]">{props.value}</span>
  );

  const StatusIcon =
    props.status === "ok" ? CheckCircle2 : props.status === "warn" ? AlertTriangle : Info;

  return (
    <li
      className={cn(
        "flex items-center justify-between gap-3 py-2.5",
        props.bordered ? "border-t border-slate-100" : undefined,
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5 text-sm text-slate-600">
        {props.status ? (
          <span
            className={cn(
              "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
              props.status === "ok"
                ? "bg-emerald-50 text-emerald-600"
                : props.status === "warn"
                  ? "bg-amber-50 text-amber-600"
                  : "bg-slate-100 text-slate-400",
            )}
          >
            <StatusIcon aria-hidden className="h-3.5 w-3.5" />
          </span>
        ) : null}
        <span>{props.label}</span>
      </span>
      <span className="shrink-0 text-sm">{valueNode}</span>
    </li>
  );
}

function OverviewHealthPanel(props: {
  health: SetupHealthPanel | null;
  noScopeLabel: string;
  thresholdNote: string;
  t: ReturnType<typeof useT>;
}) {
  const { health, t } = props;

  if (!health) {
    return (
      <OverviewTintedSection
        compactBody
        denseHeader
        title={t("overview.setup_health", "Setup health")}
        tone="health"
      >
        <p className="text-sm text-[var(--color-text-muted)]">{props.noScopeLabel}</p>
      </OverviewTintedSection>
    );
  }

  return (
    <OverviewTintedSection
      className="h-full"
      compactBody
      denseHeader
      title={t("overview.setup_health", "Setup health")}
      tone="health"
    >
      <ul className="divide-y divide-slate-100">
        <HealthCheckRow
          label={t("overview.setup_active_employees")}
          status="ok"
          value={health.active_employee_count}
        />
        <HealthCheckRow
          label={t("overview.setup_active_locations")}
          status="ok"
          value={health.active_location_count}
        />
        <HealthCheckRow
          href="/employees"
          label={t("overview.setup_missing_hourly_rate")}
          status={health.employees_missing_hourly_rate_count > 0 ? "warn" : "ok"}
          value={health.employees_missing_hourly_rate_count}
        />
        <HealthCheckRow
          href="/site-access"
          label={t("overview.setup_no_site_access")}
          status={health.employees_without_site_access_count > 0 ? "warn" : "ok"}
          value={health.employees_without_site_access_count}
        />
        <HealthCheckRow
          bordered
          label={t("overview.setup_time_policy")}
          status={health.time_policy_row_present ? "ok" : "neutral"}
          value={
            health.time_policy_row_present ? (
              <Badge tone="success">{t("overview.legend_present", "Present")}</Badge>
            ) : (
              "—"
            )
          }
        />
        <HealthCheckRow
          label={t("overview.setup_time_policy_config")}
          status={health.time_policy_configured ? "ok" : "neutral"}
          value={
            <Badge tone={health.time_policy_configured ? "success" : "default"}>
              {health.time_policy_configured
                ? t("overview.legend_policy", "Likely yes")
                : t("overview.legend_default", "Default-like")}
            </Badge>
          }
        />
      </ul>
    </OverviewTintedSection>
  );
}

function TodayLiveMetricRow(props: {
  icon: LucideIcon;
  iconClass?: string;
  label: string;
  primary: string;
  secondary?: string;
}) {
  const Icon = props.icon;
  return (
    <div className="flex items-center gap-3 py-2">
      <span
        className={cn(
          "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          props.iconClass ?? "bg-blue-50 text-blue-600",
        )}
      >
        <Icon aria-hidden className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500">{props.label}</p>
        <p className="text-lg font-bold tabular-nums text-slate-900">{props.primary}</p>
      </div>
      {props.secondary ? (
        <p className="shrink-0 text-xs font-medium tabular-nums text-slate-500">{props.secondary}</p>
      ) : null}
    </div>
  );
}

function TodayLivePanel(props: {
  title: string;
  viewAllLabel: string;
  emptyLabel: string;
  rows: TodayLiveRow[];
  openShifts: number;
  presentToday: number;
  totalEmployees: number;
  attendanceRate: string;
}) {
  const visibleRows = props.rows.slice(0, 3);

  return (
    <OverviewTintedSection
      action={
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
            <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            Live
          </span>
          <Link
            className="inline-flex items-center gap-0.5 text-xs font-semibold text-[#2563eb] hover:text-[#1d4ed8]"
            href="/live-attendance"
          >
            {props.viewAllLabel}
            <ArrowRight aria-hidden className="h-3 w-3" />
          </Link>
        </div>
      }
      className="h-full"
      compactBody
      denseHeader
      title={props.title}
      tone="live"
    >
      <div className="divide-y divide-slate-100">
        <TodayLiveMetricRow
          icon={Users}
          iconClass="bg-emerald-50 text-emerald-600"
          label="Present today"
          primary={`${props.presentToday} / ${props.totalEmployees}`}
          secondary={props.attendanceRate}
        />
        <TodayLiveMetricRow
          icon={Clock}
          iconClass="bg-sky-50 text-sky-600"
          label="Open shifts"
          primary={String(props.openShifts)}
        />
        <TodayLiveMetricRow
          icon={Activity}
          iconClass="bg-violet-50 text-violet-600"
          label="On site now"
          primary={String(visibleRows.length)}
          secondary={visibleRows.length > 0 ? "recent" : undefined}
        />
      </div>

      {visibleRows.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">{props.emptyLabel}</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {visibleRows.map((row, idx) => (
            <li key={`${row.display_name}-${row.clock_in_at}-${idx}`}>
              <Link
                className="flex items-center justify-between gap-2 py-2 text-sm transition-colors hover:text-[#2563eb]"
                href={row.href}
              >
                <span className="min-w-0 truncate font-medium text-slate-800">{row.display_name}</span>
                <span className="shrink-0 tabular-nums text-slate-500">
                  {formatDurationSeconds(row.running_seconds)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </OverviewTintedSection>
  );
}

function OverviewQuickAction(props: { href: string; icon: LucideIcon; label: string }) {
  const Icon = props.icon;
  return (
    <Link
      className="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/50 px-2 py-3 text-center text-xs font-medium text-slate-700 transition-colors hover:border-blue-200 hover:bg-blue-50/50 hover:text-slate-900"
      href={props.href}
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-[#2563eb]">
        <Icon aria-hidden className="h-4 w-4" />
      </span>
      <span className="min-w-0 leading-snug">{props.label}</span>
    </Link>
  );
}

export function OverviewClient() {
  const t = useT();
  const user = useCurrentUser();
  const adminAll = isAdministrator(user);
  const [companies, setCompanies] = useState<Company[]>([]);
  const companyScope = useAdministratorCompanyScope(user, companies);
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const companyQuery = useMemo(() => {
    if (!adminAll) {
      return null;
    }
    return companyScope.companyId;
  }, [adminAll, companyScope.companyId]);

  useEffect(() => {
    if (!adminAll) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await listCompanies();
        if (!cancelled) {
          setCompanies(rows.filter((c) => c.is_active));
        }
      } catch {
        if (!cancelled) {
          setCompanies([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminAll]);

  const load = useCallback(
    async (silent: boolean) => {
      if (adminAll && !companyQuery) {
        setData(null);
        setError("");
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (!silent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError("");
      try {
        const payload = await fetchManagementOverview(companyQuery);
        setData(payload);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("overview.load_error", "Could not load overview."));
        if (!silent) {
          setData(null);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [adminAll, companyQuery, t],
  );

  const payrollTrendLabelFn = useCallback(
    (weekStart: string) => t("overview.week_label", "Week {{date}}", { date: weekStart }),
    [t],
  );

  const attendanceTrendDisplayFn = useCallback(
    (present: number, total: number, rate: string) =>
      t("overview.attendance_bar_display", "{{present}}/{{total}} ({{rate}})", {
        present: String(present),
        total: String(total),
        rate,
      }),
    [t],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load(true);
      }
    }, 45_000);
    return () => window.clearInterval(id);
  }, [load]);

  const attendanceChartPoints = useMemo((): ChartPoint[] => {
    if (!data?.attendance_trend.length) {
      return [];
    }
    return data.attendance_trend.map((d) => ({
      key: d.date,
      label: formatShortDate(d.date),
      value: d.present_count,
      tooltip: attendanceTrendDisplayFn(
        d.present_count,
        d.total_employees,
        formatPercent(d.attendance_rate),
      ),
    }));
  }, [data, attendanceTrendDisplayFn]);

  const payrollChartPoints = useMemo((): ChartPoint[] => {
    if (!data?.payroll_trend.length) {
      return [];
    }
    return data.payroll_trend.map((d) => ({
      key: d.week_start,
      label: formatShortDate(d.week_start),
      value: d.total_gross,
      tooltip: `${payrollTrendLabelFn(d.week_start)} · ${formatMoneyGBP(String(d.total_gross))} · ${formatDurationSeconds(d.total_hours_seconds)}`,
    }));
  }, [data, payrollTrendLabelFn]);

  const attendanceTrendSummary = useMemo(() => {
    if (!data?.attendance_trend.length) {
      return undefined;
    }
    const latest = data.attendance_trend[data.attendance_trend.length - 1];
    return `${latest.present_count}/${latest.total_employees} (${formatPercent(latest.attendance_rate)})`;
  }, [data]);

  const payrollTrendSummary = useMemo(() => {
    if (!data) {
      return undefined;
    }
    if (data.payroll_total_gross != null) {
      return `${formatMoneyGBP(String(data.payroll_total_gross))} · ${payrollStatusLabel(t, data.payroll_status)}`;
    }
    return payrollStatusLabel(t, data.payroll_status);
  }, [data, t]);

  const thresholdNote = data
    ? t(
        "overview.long_open_shift_note",
        "Long-open shift threshold on this page: {{hours}}h UTC since clock-in.",
        { hours: data.long_open_shift_threshold_hours },
      )
    : "";

  const commandCenterStatus = useMemo(() => {
    if (!data) {
      return t(
        "overview.command_center_snapshot",
        "Operational snapshot for the selected company.",
      );
    }
    if (data.needs_attention.length === 0) {
      return t("overview.empty_attention", "No urgent action required.");
    }
    return t("overview.command_center_attention", "{{count}} item(s) need attention.", {
      count: data.needs_attention.length,
    });
  }, [data, t]);

  const pendingApprovalsDisplay =
    data?.payroll_readiness != null ? String(data.payroll_readiness.pending_count) : "—";

  const adminControls = (
    <>
      {adminAll && companyScope.companies.length > 0 ? (
        <CompanySelector
          companies={companyScope.companies}
          onChange={companyScope.setCompanyId}
          value={companyScope.companyId}
        />
      ) : null}
      <Button
        disabled={refreshing || loading}
        onClick={() => void load(true)}
        type="button"
        variant="secondary"
      >
        {refreshing ? t("common.refreshing", "Refreshing…") : t("common.refresh", "Refresh")}
      </Button>
    </>
  );

  const stripStatusLine = useMemo(() => {
    if (data) {
      return commandCenterStatus;
    }
    if (adminAll && companyScope.needsCompanySelection) {
      return t("overview.select_company_dashboard", "Select a company to view its dashboard.");
    }
    return t("overview.command_center_snapshot", "Operational snapshot for the selected company.");
  }, [adminAll, commandCenterStatus, companyScope.needsCompanySelection, data, t]);

  return (
    <div className="min-w-0 -mt-2 space-y-3 px-3 pb-5 sm:px-5 lg:space-y-4">
      <h1 className="mb-0.5 text-sm font-semibold text-slate-900 sm:text-base xl:hidden">
        {t("overview.page_title")}
      </h1>

      <OverviewCommandCenterStrip
        adminControls={adminControls}
        generatedAt={data?.generated_at}
        hasAttentionItems={(data?.needs_attention.length ?? 0) > 0}
        scopeLabel={companyScope.scopeLabel}
        statusLine={stripStatusLine}
        t={t}
      />

      {loading ? (
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                className="h-[7.5rem] animate-pulse rounded-2xl border border-slate-200/70 bg-white shadow-sm"
                key={`overview-loading-${index}`}
              />
            ))}
          </div>
        ) : null}
        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {adminAll && companyScope.needsCompanySelection && !loading ? (
          <div className="rounded-2xl border border-slate-200/70 bg-white px-4 py-8 text-center shadow-[0_2px_12px_rgba(20,55,102,0.06)]">
            <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-[#2563eb]">
              <Shield aria-hidden className="h-6 w-6" />
            </span>
            <p className="mt-4 text-sm text-slate-600">
              {t("overview.select_company_dashboard", "Select a company to view its dashboard.")}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              {t(
                "overview.select_company_empty",
                "Select a company from the command center to load the management overview.",
              )}
            </p>
          </div>
        ) : null}

        {data && !loading ? (
          <>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
              <OverviewKpiCard
                href="/employees"
                icon={Users}
                iconTone="employees"
                primary={String(data.active_employee_count)}
                secondary={t("overview.employees_subline")}
                title={t("overview.employees", "Employees")}
              />
              <OverviewKpiCard
                href="/locations"
                icon={MapPin}
                iconTone="locations"
                primary={String(data.active_location_count)}
                secondary={t("overview.locations_sites_sub_short", "Clocking & access sites")}
                title={t("overview.active_locations", "Active locations")}
              />
              <OverviewKpiCard
                href="/live-attendance"
                icon={Activity}
                iconTone="attendance"
                primary={formatPercent(data.live_attendance_rate)}
                secondary={`${data.live_present_today} / ${data.live_total_employees} ${t("overview.present", "Present").toLowerCase()}`}
                title={t("overview.attendance_today", "Attendance today")}
              />
              <OverviewKpiCard
                href="/payroll-report"
                icon={Wallet}
                iconTone="payroll"
                primary={
                  data.payroll_total_gross != null ? formatMoneyGBP(String(data.payroll_total_gross)) : "—"
                }
                secondary={
                  data.payroll_status === "not_calculated"
                    ? data.payroll_message ?? t("overview.payroll_not_calc")
                    : t("overview.payroll_recorded_week", "{{hours}} recorded this week", {
                        hours: formatDurationSeconds(data.payroll_total_hours_seconds),
                      })
                }
                title={t("overview.payroll_this_week")}
              />
              <OverviewKpiCard
                href="/payroll-report"
                icon={ClipboardList}
                iconTone="pending"
                primary={pendingApprovalsDisplay}
                secondary={t("overview.readiness_pending", "Pending")}
                title={t("overview.pending_approvals", "Pending approvals")}
              />
              <OverviewKpiCard
                href="/live-attendance"
                icon={Clock}
                iconTone="openShifts"
                primary={String(data.live_open_shifts)}
                secondary={t("overview.open_shifts_sub", "Shifts currently open")}
                title={t("overview.open_shifts", "Open shifts")}
              />
            </div>

            <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-4">
              <NeedsAttentionPanel
                items={data.needs_attention}
                scopeNote={data.needs_attention_scope_note}
                t={t}
              />

              <OverviewChartWidget
                caption={t(
                  "overview.trend_attendance_sub",
                  "Present employees over the last 7 days.",
                )}
                summary={attendanceTrendSummary}
                title={t("overview.trend_attendance")}
              >
                <OverviewLineChart
                  emptyHint={t("overview.trend_attendance_empty")}
                  points={attendanceChartPoints}
                />
              </OverviewChartWidget>

              <OverviewChartWidget
                caption={t(
                  "overview.trend_payroll_sub",
                  "Weekly gross payroll totals. Current week highlighted.",
                )}
                summary={payrollTrendSummary}
                title={t("overview.trend_payroll")}
              >
                <OverviewBarChart
                  currentKey={data.payroll_week_start}
                  emptyHint={
                    data.payroll_status === "not_calculated"
                      ? t("overview.payroll_not_calc_weeks")
                      : t("overview.trend_payroll_empty_no_history")
                  }
                  points={payrollChartPoints}
                />
              </OverviewChartWidget>

              <OverviewReadinessPanel
                readiness={data.payroll_readiness}
                t={t}
                unavailableLabel={t("overview.payroll_readiness_unavailable")}
              />
            </div>

            <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <OverviewHealthPanel
                health={data.setup_health}
                noScopeLabel={t("overview.no_company_scope")}
                t={t}
                thresholdNote={thresholdNote}
              />

              <OverviewTintedSection
                action={
                  user.system_role === "administrator" ? (
                    <Link
                      className="inline-flex items-center gap-0.5 text-xs font-semibold text-[#2563eb] hover:text-[#1d4ed8]"
                      href="/system/audit-log"
                    >
                      {t("overview.view_all_activity")}
                      <ArrowRight aria-hidden className="h-3 w-3" />
                    </Link>
                  ) : (
                    <span className="text-[10px] text-slate-500">
                      {t("overview.company_scoped_events")}
                    </span>
                  )
                }
                className="h-full"
                title={t("overview.recent_activity")}
                tone="activity"
              >
                {data.recent_activity.length === 0 ? (
                  <p className="text-sm text-slate-500">{t("overview.no_recent_events")}</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {data.recent_activity.slice(0, 4).map((row, idx) => (
                      <li className="flex items-center gap-3 py-2.5" key={`${row.occurred_at}-${idx}`}>
                        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[#2563eb]">
                          <Activity aria-hidden className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800">{row.summary}</p>
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-slate-400">
                          {new Date(row.occurred_at).toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </OverviewTintedSection>

              <OverviewTintedSection className="h-full" title={t("overview.quick_actions")} tone="actions">
                <div className="grid grid-cols-2 gap-2">
                  <OverviewQuickAction href="/employees" icon={Users} label={t("overview.quick_add_employee")} />
                  <OverviewQuickAction href="/locations" icon={MapPin} label={t("overview.quick_add_location")} />
                  <OverviewQuickAction
                    href="/live-attendance"
                    icon={Activity}
                    label={t("overview.link_live_attendance")}
                  />
                  <OverviewQuickAction href="/payroll-report" icon={Wallet} label={t("overview.quick_run_payroll")} />
                  <OverviewQuickAction href="/week-report" icon={ClipboardList} label={t("overview.link_week_report")} />
                  <OverviewQuickAction
                    href="/work-progress-review"
                    icon={MapPin}
                    label={t("overview.link_site_progress")}
                  />
                </div>
              </OverviewTintedSection>

              <TodayLivePanel
                attendanceRate={formatPercent(data.live_attendance_rate)}
                emptyLabel={t("overview.no_open_shifts")}
                openShifts={data.live_open_shifts}
                presentToday={data.live_present_today}
                rows={data.today_live}
                title={t("overview.today_live", "Today live")}
                totalEmployees={data.live_total_employees}
                viewAllLabel={t("common.view_all", "View all")}
              />
            </div>
          </>
        ) : null}
    </div>
  );
}
