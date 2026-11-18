"use client";

import { useId, useMemo, useState } from "react";

import { formatGbp, toMinor, type MoneyValue } from "./presentation";

export type CommercialBar = {
  id: string;
  label: string;
  value: MoneyValue;
  kind: "contract" | "cost" | "commitment" | "forecast" | "profit";
};

const KIND_COLOR: Record<CommercialBar["kind"], string> = {
  contract: "#2563eb",
  cost: "#64748b",
  commitment: "#0d9488",
  forecast: "#475569",
  profit: "#059669",
};

function axisLabel(minor: bigint): string {
  const pounds = Number(minor) / 10000;
  if (Math.abs(pounds) >= 1_000_000) return `£${(pounds / 1_000_000).toFixed(1)}M`;
  if (Math.abs(pounds) >= 1_000) return `£${(pounds / 1_000).toFixed(pounds >= 10_000 ? 0 : 1)}k`;
  return formatGbp(String((Number(minor) / 10000).toFixed(2))) || "£0";
}

function shortValueLabel(minor: bigint): string {
  const pounds = Number(minor) / 10000;
  if (Math.abs(pounds) >= 1_000_000) return `${(pounds / 1_000_000).toFixed(1)}M`;
  if (Math.abs(pounds) >= 1_000) return `${(pounds / 1_000).toFixed(pounds >= 100_000 ? 0 : 1)}k`;
  return pounds.toFixed(0);
}

/** Snapshot commercial chart from validated Finance Core figures only — never invents months. */
export function CommercialPerformanceChart({
  title = "Commercial performance",
  subtitle = "Live Finance Core snapshot. Not a monthly history.",
  bars,
  showValueTable = false,
  demo = false,
}: {
  title?: string;
  subtitle?: string;
  bars: CommercialBar[];
  showValueTable?: boolean;
  demo?: boolean;
}) {
  const gradientId = useId();
  const [active, setActive] = useState<string | null>(null);
  const prepared = useMemo(() => {
    return bars.map((bar) => {
      const minor = toMinor(bar.value);
      return { ...bar, minor, display: formatGbp(bar.value) || "Not determined", known: minor !== null };
    });
  }, [bars]);
  const known = prepared.filter((bar) => bar.known && bar.minor !== null);
  const max = known.reduce((peak, bar) => {
    const abs = bar.minor! < 0n ? -bar.minor! : bar.minor!;
    return abs > peak ? abs : peak;
  }, 0n);
  const activeBar = prepared.find((bar) => bar.id === active) ?? null;

  if (!prepared.length) {
    return (
      <section className={`fv-chart empty-state${demo ? " demo" : ""}`} aria-label={title}>
        {demo ? <div className="fv-chart-demo-banner">DEMO DATA</div> : null}
        <h3>{title}</h3>
        <p className="sub">{subtitle}</p>
        <div className="empty">No commercial figures are available yet for this view.</div>
      </section>
    );
  }

  if (!known.length) {
    return (
      <section className={`fv-chart empty-state${demo ? " demo" : ""}`} aria-label={title}>
        {demo ? <div className="fv-chart-demo-banner">DEMO DATA</div> : null}
        <h3>{title}</h3>
        <p className="sub">{subtitle}</p>
        <div className="empty">Commercial figures are incomplete. Forecast stays Not determined until CTC and contract are present.</div>
        <div className="fv-chart-fallback" role="table" aria-label="Commercial figures">
          {prepared.map((bar) => (
            <div className="fv-chart-fallback-row" role="row" key={bar.id}>
              <span role="cell">{bar.label}</span>
              <span role="cell" className="amt">{bar.display}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  const plotLeft = 72;
  const plotRight = 700;
  const plotTop = 36;
  const plotBottom = 236;
  const plotHeight = plotBottom - plotTop;
  const plotWidth = plotRight - plotLeft;

  return (
    <section className={`fv-chart${demo ? " demo" : ""}`} aria-label={title}>
      <div className="fv-chart-head">
        <div>
          {demo ? <div className="fv-chart-demo-banner">DEMO DATA</div> : null}
          <h3>{title}</h3>
          <p className="sub">{subtitle}</p>
        </div>
        <ul className="fv-chart-legend">
          {prepared.map((bar) => (
            <li key={bar.id}>
              <span className="swatch" style={{ background: KIND_COLOR[bar.kind] }} />
              {bar.label}
            </li>
          ))}
        </ul>
      </div>
      <div className="fv-chart-plot">
        <svg viewBox="0 0 720 300" role="img" aria-label={`${title} bar chart`}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f8fafc" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="720" height="300" fill={`url(#${gradientId})`} />
          {[0, 1, 2, 3, 4].map((step) => {
            const y = plotTop + (step * plotHeight) / 4;
            const tick = max > 0n ? (max * BigInt(4 - step)) / 4n : 0n;
            return (
              <g key={step}>
                <line x1={plotLeft} x2={plotRight} y1={y} y2={y} stroke="#e5e7eb" strokeWidth="1" />
                <text x={plotLeft - 10} y={y + 3} textAnchor="end" className="fv-chart-y">{axisLabel(tick)}</text>
              </g>
            );
          })}
          {prepared.map((bar, index) => {
            const slot = plotWidth / prepared.length;
            const width = Math.min(slot * 0.52, 68);
            const x = plotLeft + index * slot + (slot - width) / 2;
            const abs = bar.minor === null ? 0n : bar.minor < 0n ? -bar.minor : bar.minor;
            const ratio = max > 0n ? Number((abs * 10000n) / max) / 10000 : 0;
            const height = bar.known ? Math.max(ratio * plotHeight, abs > 0n ? 6 : 0) : 0;
            const y = plotBottom - height;
            const isLoss = bar.minor !== null && bar.minor < 0n;
            const fill = isLoss ? "#dc2626" : KIND_COLOR[bar.kind];
            const label = bar.label.length > 16 ? `${bar.label.slice(0, 14)}…` : bar.label;
            return (
              <g
                key={bar.id}
                onMouseEnter={() => setActive(bar.id)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(bar.id)}
                onBlur={() => setActive(null)}
                tabIndex={0}
                role="listitem"
                aria-label={`${bar.label}: ${bar.display}`}
              >
                {bar.known && bar.minor !== null ? (
                  <text x={x + width / 2} y={y - 8} textAnchor="middle" className="fv-chart-value">
                    {shortValueLabel(bar.minor)}
                  </text>
                ) : null}
                <rect
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  rx="4"
                  fill={fill}
                  opacity={active && active !== bar.id ? 0.35 : 0.96}
                />
                <text x={x + width / 2} y="262" textAnchor="middle" className="fv-chart-axis">
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
        {activeBar ? (
          <div className="fv-chart-tooltip" role="status">
            <strong>{activeBar.label}</strong>
            <span>{activeBar.display}</span>
            {demo ? <span>DEMO DATA</span> : null}
          </div>
        ) : null}
      </div>
      {showValueTable ? (
        <div className="fv-chart-fallback" role="table" aria-label={`${title} values`}>
          {prepared.map((bar) => (
            <div className="fv-chart-fallback-row" role="row" key={`t-${bar.id}`}>
              <span role="cell">{bar.label}</span>
              <span role="cell" className={`amt${bar.minor !== null && bar.minor < 0n ? " loss" : ""}`}>{bar.display}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function buildCommercialBars(input: {
  contract: MoneyValue;
  incurred: MoneyValue;
  commitments: MoneyValue;
  ctc: MoneyValue;
  forecastFinal: MoneyValue;
  forecastProfit: MoneyValue;
}): CommercialBar[] {
  return [
    { id: "contract", label: "Contract value", value: input.contract, kind: "contract" },
    { id: "incurred", label: "Cost to date", value: input.incurred, kind: "cost" },
    { id: "commitments", label: "Open commitments", value: input.commitments, kind: "commitment" },
    { id: "ctc", label: "Cost to complete", value: input.ctc, kind: "forecast" },
    { id: "final", label: "Forecast final cost", value: input.forecastFinal, kind: "forecast" },
    { id: "profit", label: "Forecast profit", value: input.forecastProfit, kind: "profit" },
  ];
}

/** @deprecated Prefer DEMO_CHART_BARS from finance-demo-fixture — kept for chart-preview import stability. */
export const DEMO_COMMERCIAL_BARS = [
  { id: "contract", label: "Contract value", value: "1250000.0000", kind: "contract" as const },
  { id: "incurred", label: "Cost to date", value: "482500.0000", kind: "cost" as const },
  { id: "commitments", label: "Open commitments", value: "165000.0000", kind: "commitment" as const },
  { id: "ctc", label: "Cost to complete", value: "390000.0000", kind: "forecast" as const },
  { id: "final", label: "Forecast final cost", value: "1037500.0000", kind: "forecast" as const },
  { id: "profit", label: "Forecast profit", value: "212500.0000", kind: "profit" as const },
];
