import { formatEuro } from "@haben/core";
import { useState, type PointerEvent } from "react";
import { euroAxis, niceTicks, useChartWidth } from "../lib/chart.ts";
import { formatDate } from "../lib/format.ts";

const H = 200;
const M = { top: 12, right: 12, bottom: 24, left: 72 };
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

export interface BalancePoint {
  date: string;
  /** Saldo nach der Buchung, aus Sicht des Kontos (Erlöse positiv) */
  value: number;
  label: string;
}

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/**
 * Saldoverlauf eines Kontos als Stufenlinie: zwischen zwei Buchungen bleibt der Saldo gleich.
 * Eine Reihe, daher keine Legende; Titel und Tabelle darunter benennen sie.
 */
export function BalanceChart({ from, to, start, points, title }: { from: string; to: string; start: number; points: BalancePoint[]; title: string }) {
  const [active, setActive] = useState<number | null>(null);
  const [chartRef, W] = useChartWidth();
  const first = day(from);
  const last = Math.max(day(to) - 1, first + 1);
  const values = [start, ...points.map((p) => p.value)];
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const x = (iso: string) => M.left + ((day(iso) - first) / (last - first)) * plotW;
  const y = (v: number) => M.top + plotH - ((v - lo) / (hi - lo)) * plotH;

  let d = `M${M.left},${y(start)}`;
  let current = start;
  for (const p of points) {
    d += `H${x(p.date)}V${y(p.value)}`;
    current = p.value;
  }
  d += `H${W - M.right}`;

  // Monatsanfänge im Zeitraum als Achsenbeschriftung
  const monthTicks: { iso: string; label: string }[] = [];
  for (let m = new Date(`${from}T00:00:00Z`); day(m.toISOString().slice(0, 10)) <= last; m.setUTCMonth(m.getUTCMonth() + 1)) {
    const iso = m.toISOString().slice(0, 10);
    monthTicks.push({ iso, label: MONTHS[m.getUTCMonth()]! });
  }

  function onMove(event: PointerEvent<SVGSVGElement>) {
    if (points.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.date) - px) < Math.abs(x(points[best]!.date) - px)) best = i;
    });
    setActive(best);
  }

  const point = active !== null ? points[active] : null;
  return (
    <div className="chart" ref={chartRef} onPointerLeave={() => setActive(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: Saldo von ${formatEuro(start)} auf ${formatEuro(current)}`} onPointerMove={onMove}>
        <g aria-hidden="true">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} className={t === 0 ? "axis-base" : "grid"} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tick">
                {euroAxis.format(t / 100)} €
              </text>
            </g>
          ))}
          {monthTicks.length <= 12 &&
            monthTicks.map((m, i) =>
              // Schmale Diagramme: nur jeden zweiten Monat beschriften
              i % (W < 520 ? 2 : 1) === 0 ? (
                <text key={m.iso} x={x(m.iso)} y={H - 6} textAnchor="start" className="tick">
                  {m.label}
                </text>
              ) : null,
            )}
        </g>
        <path d={d} className="line-series" />
        {point && (
          <g aria-hidden="true">
            <line x1={x(point.date)} x2={x(point.date)} y1={M.top} y2={M.top + plotH} className="crosshair" />
            <circle cx={x(point.date)} cy={y(point.value)} r={5} className="marker" />
          </g>
        )}
      </svg>
      {point && (
        <div
          className="chart-tooltip"
          role="presentation"
          style={{
            left: `${(x(point.date) / W) * 100}%`,
            transform: x(point.date) < W * 0.2 ? "translateX(-10%)" : x(point.date) > W * 0.8 ? "translateX(-90%)" : "translateX(-50%)",
          }}
        >
          <div className="tt-title">{formatDate(point.date)}</div>
          <div className="tt-row">
            <strong>{formatEuro(point.value)}</strong>
            <span className="muted">Saldo</span>
          </div>
          <div className="small muted" style={{ maxWidth: 260, whiteSpace: "normal" }}>
            {point.label}
          </div>
        </div>
      )}
    </div>
  );
}
