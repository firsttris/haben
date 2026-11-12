import { formatEuro, type ContactYearTotal } from "@haben/core";
import { useState } from "react";
import { barPath, euroAxis, niceTicks, useChartWidth } from "../lib/chart.ts";

const H = 160;
const M = { top: 12, right: 8, bottom: 28, left: 72 };

/**
 * Säulen der Nettosummen je Jahr über der Jahrestabelle der Kontaktseite (#587), das älteste Jahr links. Eine Reihe,
 * daher keine Legende: Die Überschrift benennt sie, die Tabelle darunter trägt dieselben Zahlen. Ein Klick oder Enter
 * wählt das Jahr wie die Zeile der Tabelle; Hover und Fokus zeigen die Werte. Gestaltung wie das Säulendiagramm der
 * Auswertungen (styles/auswertungen.css).
 */
export function YearBars({
  years,
  selected,
  series,
  label,
  onSelect,
}: {
  years: ContactYearTotal[];
  selected: number | null;
  /** Umsatz in der Farbe der Einnahmen, Ausgaben in der der Ausgaben */
  series: "in" | "out";
  label: string;
  onSelect: (year: number) => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [chartRef, W] = useChartWidth();
  const rows = [...years].sort((a, b) => a.year - b.year);
  const values = rows.map((r) => r.net);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 3);
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const y = (v: number) => M.top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const slot = plotW / rows.length;
  const bar = Math.min(24, Math.floor(slot * 0.5));
  // Viele Jahre auf schmalem Bildschirm: nur jedes zweite beschriften
  const labelEvery = slot < 40 ? 2 : 1;
  const base = y(0);
  const shown = active === null ? null : rows[active]!;

  return (
    <div className="chart year-bars" ref={chartRef} onPointerLeave={() => setActive(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Säulendiagramm: ${label}, netto in Euro`}>
        <g aria-hidden="true">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} className={t === 0 ? "axis-base" : "grid"} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" style={{ textAnchor: "end" }} className="tick">
                {euroAxis.format(t / 100)} €
              </text>
            </g>
          ))}
          {rows.map((r, i) =>
            (rows.length - 1 - i) % labelEvery === 0 ? (
              <text key={r.year} x={M.left + slot * i + slot / 2} y={H - 8} style={{ textAnchor: "middle" }} className="tick">
                {r.year}
              </text>
            ) : null,
          )}
        </g>
        {rows.map((r, i) => {
          const cx = M.left + slot * i + slot / 2;
          const classes = ["year", r.year === selected ? "selected" : "", active === i ? "active" : ""].filter(Boolean).join(" ");
          // Rolle „link“ statt <a>: Ein HTML-Link geht im SVG nicht, ein SVG-<a> kennt den Router nicht
          return (
            <g
              key={r.year}
              className={classes}
              role="link"
              tabIndex={0}
              aria-label={`${r.year}: ${formatEuro(r.net)} netto`}
              aria-current={r.year === selected ? "page" : undefined}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => onSelect(r.year)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSelect(r.year);
              }}
            >
              <rect x={M.left + slot * i} y={M.top} width={slot} height={plotH} className="hit" />
              <path d={barPath(cx - bar / 2, base, y(r.net), bar)} className={`bar bar-${series}`} />
            </g>
          );
        })}
      </svg>
      {shown && active !== null && (
        <div
          className="chart-tooltip"
          role="presentation"
          style={
            // Neben der Säule statt darüber: Das Diagramm ist flach, sonst verdeckte der Tooltip die Säule, auf die er zeigt
            active < rows.length / 2
              ? { left: `${((M.left + slot * active + slot / 2 + bar / 2 + 8) / W) * 100}%`, transform: "none" }
              : { left: `${((M.left + slot * active + slot / 2 - bar / 2 - 8) / W) * 100}%`, transform: "translateX(-100%)" }
          }
        >
          <div className="tt-title">{shown.year}</div>
          <div className="tt-row">
            <span className={`tt-key tt-${series}`} />
            <strong>{formatEuro(shown.net)}</strong>
            <span className="muted">netto</span>
          </div>
          <div className="tt-row">
            <strong>{formatEuro(shown.gross)}</strong>
            <span className="muted">brutto</span>
          </div>
          {shown.archiveNet !== 0 && (
            <div className="tt-row">
              <strong>{formatEuro(shown.archiveNet)}</strong>
              <span className="muted">netto aus dem Altbestand</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
