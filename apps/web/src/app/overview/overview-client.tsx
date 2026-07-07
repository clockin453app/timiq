"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Info,
  MapPin,
  Users,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  Badge,
  Button,
  PageHeader,
  Sheet,
  SheetBody,
  StatusBadge,
} from "../../components/ui";
import { isAdministrator, useCurrentUser } from "../../features/auth";
import {
  fetchManagementOverview,
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
import { uiClasses } from "../../lib/ui-classes";

function toneForPayrollStatus(status: string): "success" | "warning" | "muted" {
  if (status === "paid") {
    return "success";
  }
  if (status === "approved") {
    return "success";
  }
  if (status === "not_calculated") {
    return "muted";
  }
  return "warning";
}

function badgeToneFromPayroll(tone: "success" | "warning" | "muted"): "success" | "warning" | "default" {
  if (tone === "success") {
    return "success";
  }
  if (tone === "warning") {
    return "warning";
  }
  return "default";
}

type OverviewSectionTone =
  | "attendance"
  | "live"
  | "payroll"
  | "readiness"
  | "health"
  | "activity"
  | "actions"
  | "trends";

const OVERVIEW_SECTION_TONE: Record<
  OverviewSectionTone,
  { header: string; title: string; card?: string }
> = {
  attendance: {
    header:
      "border-b border-[var(--color-overview-section-attendance-border)] bg-[var(--color-overview-section-attendance-bg)]",
    title: "text-[var(--color-overview-section-attendance-fg)]",
    card: "border-[var(--color-overview-section-attendance-border)]",
  },
  live: {
    header:
      "border-b border-[var(--color-overview-section-live-border)] bg-[var(--color-overview-section-live-bg)]",
    title: "text-[var(--color-overview-section-live-fg)]",
    card: "border-[var(--color-overview-section-live-border)]",
  },
  payroll: {
    header:
      "border-b border-[var(--color-overview-section-payroll-border)] bg-[var(--color-overview-section-payroll-bg)]",
    title: "text-[var(--color-overview-section-payroll-fg)]",
    card: "border-[var(--color-overview-section-payroll-border)]",
  },
  readiness: {
    header:
      "border-b border-[var(--color-overview-section-readiness-border)] bg-[var(--color-overview-section-readiness-bg)]",
    title: "text-[var(--color-overview-section-readiness-fg)]",
    card: "border-[var(--color-overview-section-readiness-border)]",
  },
  health: {
    header:
      "border-b border-[var(--color-overview-section-health-border)] bg-[var(--color-overview-section-health-bg)]",
    title: "text-[var(--color-overview-section-health-fg)]",
    card: "border-[var(--color-overview-section-health-border)]",
  },
  activity: {
    header:
      "border-b border-[var(--color-overview-section-activity-border)] bg-[var(--color-overview-section-activity-bg)]",
    title: "text-[var(--color-overview-section-activity-fg)]",
    card: "border-[var(--color-overview-section-activity-border)]",
  },
  actions: {
    header:
      "border-b border-[var(--color-overview-section-actions-border)] bg-[var(--color-overview-section-actions-bg)]",
    title: "text-[var(--color-overview-section-actions-fg)]",
    card: "border-[var(--color-overview-section-actions-border)]",
  },
  trends: {
    header:
      "border-b border-[var(--color-overview-section-trends-border)] bg-[var(--color-overview-section-trends-bg)]",
    title: "text-[var(--color-overview-section-trends-fg)]",
    card: "border-[var(--color-overview-section-trends-border)]",
  },
};

const OVERVIEW_CHART_VIEW_WIDTH = 480;
const OVERVIEW_CHART_VIEW_HEIGHT = 130;
const OVERVIEW_CHART_DISPLAY_CLASS = "h-[120px] w-full max-w-full sm:h-[140px]";
const OVERVIEW_CHART_PADDING = {
  line: { top: 8, right: 8, bottom: 20, left: 28 },
  bar: { top: 8, right: 8, bottom: 24, left: 32 },
} as const;

function OverviewTintedSection(props: {
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  compactBody?: boolean;
  denseHeader?: boolean;
  description?: string;
  title: string;
  tone: OverviewSectionTone;
}) {
  const toneStyle = OVERVIEW_SECTION_TONE[props.tone];

  return (
    <section
      className={cn(
        uiClasses.card,
        "overflow-hidden shadow-[var(--shadow-soft)] ring-1 ring-black/5",
        toneStyle.card,
        props.className,
      )}
    >
      <div
        className={cn(
          "flex flex-col gap-1.5 px-[var(--space-card)] sm:flex-row sm:items-start sm:justify-between",
          props.denseHeader ? "py-2" : "py-3",
          toneStyle.header,
        )}
      >
        <div className="min-w-0 flex-1">
          <h2 className={cn("timiq-title-md", toneStyle.title)}>{props.title}</h2>
          {props.description ? (
            <p className="timiq-caption mt-0.5 text-[var(--color-text-muted)]">{props.description}</p>
          ) : null}
        </div>
        {props.action ? <div className="flex shrink-0 flex-wrap gap-2">{props.action}</div> : null}
      </div>
      <div
        className={cn(
          props.compactBody
            ? "bg-[var(--color-sheet)] px-3 py-3 sm:px-[var(--space-card)]"
            : cn(uiClasses.cardBody, "bg-[var(--color-sheet)]"),
        )}
      >
        {props.children}
      </div>
    </section>
  );
}

function OverviewChartWidget(props: {
  caption: string;
  children: ReactNode;
  summary?: string;
  title: string;
}) {
  return (
    <div className="min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-3 shadow-[var(--shadow-xs)] sm:p-3.5">
      <div className="mb-1.5 flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <h3 className="text-sm font-semibold tracking-tight text-[var(--color-text)]">{props.title}</h3>
        {props.summary ? (
          <p className="text-xs font-semibold tabular-nums text-[var(--color-text-muted)] sm:text-sm">
            {props.summary}
          </p>
        ) : null}
      </div>
      {props.children}
      <p className="mt-1 text-[11px] leading-snug text-[var(--color-text-soft)]">{props.caption}</p>
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

function OverviewSparkline(props: { values: number[]; tone?: "brand" | "success" }) {
  const { values, tone = "brand" } = props;
  if (values.length < 2) {
    return null;
  }

  const width = 72;
  const height = 28;
  const { linePath } = buildLineGeometry(values, width, height, {
    top: 2,
    right: 2,
    bottom: 2,
    left: 2,
  });
  const stroke =
    tone === "success" ? "var(--color-success-700)" : "var(--color-brand)";

  return (
    <svg
      aria-hidden
      className="mt-2 opacity-80"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
    >
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
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
        <path d={areaPath} fill="var(--color-brand)" fillOpacity="0.1" />
        <path
          d={linePath}
          fill="none"
          stroke="var(--color-brand)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
        {coords.map((point, index) => (
          <g key={props.points[index]?.key ?? index}>
            <circle cx={point.x} cy={point.y} fill="var(--color-brand)" r="3" />
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
                fill={isCurrent ? "var(--color-brand)" : "var(--color-brand-muted)"}
                height={point.value === 0 ? 2 : barHeight}
                rx="3"
                stroke={isCurrent ? "var(--color-brand-hover)" : "var(--color-border)"}
                strokeWidth={isCurrent ? 1.5 : 1}
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

function OverviewMetricCard(props: {
  href: string;
  title: string;
  primary: string;
  secondary?: string;
  badge?: string;
  badgeTone?: "success" | "warning" | "muted";
  icon: LucideIcon;
  sparklineValues?: number[];
  sparklineTone?: "brand" | "success";
}) {
  const Icon = props.icon;
  const badgeTone = props.badgeTone ?? "muted";

  return (
    <Link
      className={cn(
        "group block min-w-0 rounded-none border-0 bg-transparent px-4 py-4 transition-[background-color,color,box-shadow,transform]",
        "duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-standard)]",
        "hover:bg-[var(--color-header)]/70",
      )}
      href={props.href}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-brand)]/20 bg-[var(--color-brand-muted)] text-[var(--color-brand)] shadow-[var(--shadow-xs)]">
            <Icon aria-hidden className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">
              {props.title}
            </p>
            <p className="mt-1 text-[2rem] font-semibold tabular-nums leading-none tracking-tight text-[var(--color-text)] lg:text-[2.45rem]">
              {props.primary}
            </p>
            {props.secondary ? (
              <p className="mt-1.5 text-sm leading-snug text-[var(--color-text-muted)]">{props.secondary}</p>
            ) : null}
            {props.sparklineValues && props.sparklineValues.length >= 2 ? (
              <OverviewSparkline tone={props.sparklineTone} values={props.sparklineValues} />
            ) : null}
          </div>
        </div>
        {props.badge ? (
          <Badge className="shrink-0" tone={badgeToneFromPayroll(badgeTone)}>
            {props.badge}
          </Badge>
        ) : null}
      </div>
    </Link>
  );
}

function ReadinessStatChip(props: {
  label: string;
  value: ReactNode;
  tone?: "default" | "warning" | "success";
}) {
  const toneClass =
    props.tone === "warning"
      ? "border-[var(--color-warning-700)]/20 bg-[var(--color-warning-50)]"
      : props.tone === "success"
        ? "border-[var(--color-success-700)]/20 bg-[var(--color-success-50)]"
        : "border-[var(--color-border)] bg-[var(--color-header)]";

  return (
    <div className={cn("rounded-[var(--radius-md)] border px-2.5 py-2", toneClass)}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">
        {props.label}
      </p>
      <p className="mt-0.5 text-base font-semibold tabular-nums text-[var(--color-text)]">{props.value}</p>
    </div>
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
        compactBody
        denseHeader
        title={t("overview.payroll_readiness", "Payroll readiness")}
        tone="readiness"
      >
        <p className="text-sm text-[var(--color-text-muted)]">{props.unavailableLabel}</p>
      </OverviewTintedSection>
    );
  }

  const yesNo = (value: boolean) => (value ? t("common.yes", "Yes") : t("common.no", "No"));

  return (
    <OverviewTintedSection
      action={
        <Link
          className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-brand)] hover:text-[var(--color-brand-hover)]"
          href={readiness.href}
        >
          {t("overview.open_payroll_report")}
          <ArrowRight aria-hidden className="h-3.5 w-3.5" />
        </Link>
      }
      compactBody
      denseHeader
      description={readiness.scope_note ?? undefined}
      title={t("overview.payroll_readiness", "Payroll readiness")}
      tone="readiness"
    >
      <div className="space-y-3">
        <StatusBadge status={readiness.payroll_status}>
          {payrollStatusLabel(t, readiness.payroll_status)}
        </StatusBadge>

        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">
            {t("overview.readiness_approval_group", "Approval status")}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <ReadinessStatChip label={t("overview.readiness_items", "Items")} value={readiness.total_items} />
            <ReadinessStatChip
              label={t("overview.readiness_pending", "Pending")}
              tone={readiness.pending_count > 0 ? "warning" : "default"}
              value={readiness.pending_count}
            />
            <ReadinessStatChip
              label={t("overview.readiness_approved", "Approved")}
              tone="success"
              value={readiness.approved_count}
            />
            <ReadinessStatChip label={t("overview.readiness_paid", "Paid")} tone="success" value={readiness.paid_count} />
          </div>
        </div>

        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">
            {t("overview.readiness_blockers_group", "Blockers & shifts")}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <ReadinessStatChip
              label={t("overview.readiness_rate_missing", "Rate missing")}
              tone={readiness.rate_missing_count > 0 ? "warning" : "default"}
              value={readiness.rate_missing_count}
            />
            <ReadinessStatChip
              label={t("overview.readiness_open_shifts_week", "Open shifts (week)")}
              tone={readiness.open_shifts_started_in_week_count > 0 ? "warning" : "default"}
              value={readiness.open_shifts_started_in_week_count}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge tone={readiness.payroll_period_not_calculated ? "warning" : "success"}>
            {t("overview.readiness_not_calculated", "Not calculated")}: {yesNo(readiness.payroll_period_not_calculated)}
          </Badge>
          <Badge tone={readiness.payroll_needs_recalculation ? "warning" : "success"}>
            {t("overview.readiness_needs_recalc", "Needs recalc")}: {yesNo(readiness.payroll_needs_recalculation)}
          </Badge>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-brand)]/15 bg-[var(--color-brand-muted)] px-2.5 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">
            {t("overview.readiness_gross_hours", "Gross / hours")}
          </p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--color-text)]">
            {readiness.total_gross != null ? formatMoneyGBP(String(readiness.total_gross)) : "—"} ·{" "}
            {formatDurationSeconds(readiness.total_hours_seconds)}
          </p>
        </div>
      </div>
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
  const iconClass =
    props.status === "ok"
      ? "text-[var(--color-success-700)]"
      : props.status === "warn"
        ? "text-[var(--color-warning-700)]"
        : "text-[var(--color-text-soft)]";

  return (
    <li
      className={cn(
        "flex items-center justify-between gap-3 rounded-[var(--radius-md)] px-2 py-2.5 text-sm",
        props.bordered ? "mt-1 border-t border-[var(--color-border)] pt-3" : undefined,
      )}
    >
      <span className="flex min-w-0 items-center gap-2 text-[var(--color-text-muted)]">
        {props.status ? <StatusIcon aria-hidden className={cn("h-4 w-4 shrink-0", iconClass)} /> : null}
        <span>{props.label}</span>
      </span>
      {valueNode}
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
      compactBody
      denseHeader
      description={health.scope_note ?? undefined}
      title={t("overview.setup_health", "Setup health")}
      tone="health"
    >
      <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-header)]/50 px-2">
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
      <p className="mt-2 text-xs leading-snug text-[var(--color-text-soft)]">{props.thresholdNote}</p>
    </OverviewTintedSection>
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
  return (
    <OverviewTintedSection
      action={
        <Link
          className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-brand)] hover:text-[var(--color-brand-hover)]"
          href="/live-attendance"
        >
          {props.viewAllLabel}
          <ArrowRight aria-hidden className="h-3.5 w-3.5" />
        </Link>
      }
      compactBody
      denseHeader
      title={props.title}
      tone="live"
    >
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-brand)]/15 bg-[var(--color-brand-muted)] px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">
            Open now
          </p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums text-[var(--color-text)]">{props.openShifts}</p>
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--color-success-700)]/15 bg-[var(--color-success-50)] px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">
            Present today
          </p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums text-[var(--color-text)]">
            {props.presentToday}
            <span className="text-sm font-medium text-[var(--color-text-muted)]"> / {props.totalEmployees}</span>
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-success-700)]">{props.attendanceRate}</p>
        </div>
      </div>

      {props.rows.length === 0 ? (
        <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-dark)] bg-[var(--color-header)]/45 px-3 py-3">
          <p className="text-sm text-[var(--color-text-muted)]">{props.emptyLabel}</p>
        </div>
      ) : (
        <ul className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
          {props.rows.map((row, idx) => (
            <li key={`${row.display_name}-${row.clock_in_at}-${idx}`}>
              <Link
                className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-transparent bg-[var(--color-header)]/35 px-3 py-2.5 text-sm transition-colors hover:border-[var(--color-border)] hover:bg-[var(--color-header)]"
                href={row.href}
              >
                <div className="min-w-0">
                  <p className="font-medium text-[var(--color-text)]">{row.display_name}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {row.location_name ?? "—"}
                  </p>
                </div>
                <p className="text-xs tabular-nums text-[var(--color-text-muted)]">
                  {formatDurationSeconds(row.running_seconds)} · {new Date(row.clock_in_at).toLocaleTimeString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </OverviewTintedSection>
  );
}

function OverviewListLink(props: { href: string; label: string }) {
  return (
    <Link
      className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-transparent px-3 py-2.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border)] hover:bg-[var(--color-header)]"
      href={props.href}
    >
      <span className="min-w-0">{props.label}</span>
      <ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-[var(--color-text-soft)]" />
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

  const attendanceSparkline = useMemo(
    () => data?.attendance_trend.map((d) => d.present_count) ?? [],
    [data],
  );

  const payrollSparkline = useMemo(
    () => data?.payroll_trend.map((d) => d.total_gross) ?? [],
    [data],
  );

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

  return (
    <Sheet>
      <PageHeader
        action={
          <div className="flex flex-wrap items-center gap-2">
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
          </div>
        }
        description={t("overview.page_description")}
        title={t("overview.page_title")}
      />

      <SheetBody className="min-w-0 space-y-5 lg:space-y-6 lg:p-6">
        {loading ? (
          <p className="text-sm text-[var(--color-text-muted)]">{t("overview.loading", "Loading overview…")}</p>
        ) : null}
        {error ? <p className="text-sm text-[var(--color-danger-700)]">{error}</p> : null}

        {adminAll && companyScope.needsCompanySelection && !loading ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
            {t("overview.select_company_dashboard", "Select a company to view its dashboard.")}
          </div>
        ) : null}

        {data && !loading ? (
          <>
            <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-dark)] bg-[var(--color-header)] shadow-[var(--shadow-soft)]">
              <div className="border-b border-[var(--color-border)] px-4 py-4">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-soft)]">
                    Operations Command Center
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-muted)]">
                    {t("overview.page_description")}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-[var(--radius-full)] border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs text-[var(--color-text-muted)]">
                      {t("overview.last_updated", "Last updated {{time}}", {
                        time: new Date(data.generated_at).toLocaleString(),
                      })}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-[var(--radius-full)] border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs text-[var(--color-text-muted)]">
                      {t(
                        "overview.auto_refresh_note",
                        "Auto-refreshes every 45 seconds when this tab is visible.",
                      )}
                    </span>
                  </div>
                  {companyScope.scopeLabel ? (
                    <p className="mt-2 text-xs text-[var(--color-text-muted)]">{companyScope.scopeLabel}</p>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-1 divide-y divide-[var(--color-border)] sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
                <OverviewMetricCard
                  badge={t("overview.badge_active", "Active")}
                  badgeTone="muted"
                  href="/employees"
                  icon={Users}
                  primary={String(data.active_employee_count)}
                  secondary={t("overview.employees_subline")}
                  title={t("overview.employees", "Employees")}
                />
                <OverviewMetricCard
                  badge={t("overview.badge_sites", "Sites")}
                  badgeTone="muted"
                  href="/locations"
                  icon={MapPin}
                  primary={String(data.active_location_count)}
                  secondary={t("overview.locations_sites_sub", "Operational sites for clocking and access")}
                  title={t("overview.active_locations", "Active locations")}
                />
                <OverviewMetricCard
                  badge={formatPercent(data.live_attendance_rate)}
                  badgeTone="success"
                  href="/live-attendance"
                  icon={Activity}
                  primary={`${data.live_present_today} / ${data.live_total_employees}`}
                  secondary={t("overview.attendance_now_sub", "{{open}} open shift(s) now · attendance today", {
                    open: data.live_open_shifts,
                  })}
                  sparklineTone="success"
                  sparklineValues={attendanceSparkline}
                  title={t("overview.attendance_today", "Attendance today")}
                />
                <OverviewMetricCard
                  badge={payrollStatusLabel(t, data.payroll_status)}
                  badgeTone={toneForPayrollStatus(data.payroll_status)}
                  href="/payroll-report"
                  icon={Wallet}
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
                  sparklineValues={payrollSparkline}
                  title={t("overview.payroll_this_week")}
                />
              </div>
            </section>

            <OverviewTintedSection
              compactBody
              denseHeader
              description={t(
                "overview.operational_trends_sub",
                "Compact attendance and payroll trends for the current scope.",
              )}
              title={t("overview.operational_trends", "Operational trends")}
              tone="trends"
            >
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
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
              </div>
            </OverviewTintedSection>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
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

              <OverviewReadinessPanel
                readiness={data.payroll_readiness}
                t={t}
                unavailableLabel={t("overview.payroll_readiness_unavailable")}
              />

              <OverviewHealthPanel
                health={data.setup_health}
                noScopeLabel={t("overview.no_company_scope")}
                t={t}
                thresholdNote={thresholdNote}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <OverviewTintedSection
                action={
                  user.system_role === "administrator" ? (
                    <Link
                      className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-brand)] hover:text-[var(--color-brand-hover)]"
                      href="/system/audit-log"
                    >
                      {t("overview.view_all_activity")}
                      <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                    </Link>
                  ) : (
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {t("overview.company_scoped_events")}
                    </span>
                  )
                }
                compactBody
                denseHeader
                title={t("overview.recent_activity")}
                tone="activity"
              >
                {data.recent_activity.length === 0 ? (
                  <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-dark)] bg-[var(--color-header)]/45 px-3 py-3">
                    <p className="text-sm text-[var(--color-text-muted)]">{t("overview.no_recent_events")}</p>
                  </div>
                ) : (
                  <ul className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                    {data.recent_activity.map((row, idx) => (
                      <li
                        className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2.5 text-sm shadow-[var(--shadow-xs)]"
                        key={`${row.occurred_at}-${idx}`}
                      >
                        <p className="font-medium text-[var(--color-text)]">{row.summary}</p>
                        {row.detail ? (
                          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{row.detail}</p>
                        ) : null}
                        <p className="mt-0.5 text-[10px] text-[var(--color-text-soft)]">
                          {new Date(row.occurred_at).toLocaleString()}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </OverviewTintedSection>

              <OverviewTintedSection
                compactBody
                denseHeader
                title={t("overview.quick_actions")}
                tone="actions"
              >
                <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {[
                    { key: "emp", label: t("overview.quick_add_employee"), href: "/employees" },
                    { key: "loc", label: t("overview.quick_add_location"), href: "/locations" },
                    { key: "live", label: t("overview.link_live_attendance"), href: "/live-attendance" },
                    { key: "pay", label: t("overview.quick_run_payroll"), href: "/payroll-report" },
                    { key: "week", label: t("overview.link_week_report"), href: "/week-report" },
                    { key: "site", label: t("overview.link_site_progress"), href: "/work-progress-review" },
                  ].map((item) => (
                    <li key={item.key}>
                      <OverviewListLink href={item.href} label={item.label} />
                    </li>
                  ))}
                </ul>
              </OverviewTintedSection>
            </div>
          </>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
