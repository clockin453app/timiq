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

function barHeight(minor: bigint | null, max: bigint): number {
  if (minor === null || max <= 0n) return 0;
  const abs = minor < 0n ? -minor : minor;
  const pct = Number((abs * 10000n) / max) / 10000;
  return Math.max(pct * 100, abs > 0n ? 4 : 0);
}

/** Snapshot commercial chart from validated Finance Core figures only — never invents months. */
export function CommercialPerformanceChart({
  title = "Commercial performance",
  subtitle = "Live Finance Core snapshot. Not a monthly history.",
  bars,
}: {
  title?: string;
  subtitle?: string;
  bars: CommercialBar[];
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
      <section className="fv-chart empty-state" aria-label={title}>
        <h3>{title}</h3>
        <p className="sub">{subtitle}</p>
        <div className="empty">No commercial figures are available yet for this view.</div>
      </section>
    );
  }

  if (!known.length) {
    return (
      <section className="fv-chart empty-state" aria-label={title}>
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

  return (
    <section className="fv-chart" aria-label={title}>
      <div className="fv-chart-head">
        <div>
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
        <svg viewBox="0 0 640 260" role="img" aria-label={`${title} bar chart`}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#eff6ff" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="640" height="260" fill={`url(#${gradientId})`} />
          {[0, 1, 2, 3, 4].map((step) => {
            const y = 30 + step * 40;
            return <line key={step} x1="48" x2="620" y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />;
          })}
          {prepared.map((bar, index) => {
            const slot = 560 / prepared.length;
            const x = 56 + index * slot + slot * 0.18;
            const width = slot * 0.64;
            const height = barHeight(bar.minor, max);
            const y = 210 - height * 1.6;
            const isLoss = bar.minor !== null && bar.minor < 0n;
            const fill = isLoss ? "#dc2626" : KIND_COLOR[bar.kind];
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
                <rect
                  x={x}
                  y={Number.isFinite(y) ? y : 210}
                  width={width}
                  height={Math.max(height * 1.6, bar.known ? 3 : 0)}
                  rx="6"
                  fill={fill}
                  opacity={active && active !== bar.id ? 0.45 : 0.95}
                />
                <text x={x + width / 2} y="232" textAnchor="middle" className="fv-chart-axis">
                  {bar.label.length > 14 ? `${bar.label.slice(0, 12)}…` : bar.label}
                </text>
              </g>
            );
          })}
        </svg>
        {activeBar ? (
          <div className="fv-chart-tooltip" role="status">
            <strong>{activeBar.label}</strong>
            <span>{activeBar.display}</span>
          </div>
        ) : null}
      </div>
      <div className="fv-chart-fallback" role="table" aria-label={`${title} values`}>
        {prepared.map((bar) => (
          <div className="fv-chart-fallback-row" role="row" key={`t-${bar.id}`}>
            <span role="cell">{bar.label}</span>
            <span role="cell" className={`amt${bar.minor !== null && bar.minor < 0n ? " loss" : ""}`}>{bar.display}</span>
          </div>
        ))}
      </div>
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
