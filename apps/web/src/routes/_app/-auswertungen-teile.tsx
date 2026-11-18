import { MONTHS, formatEuro, type EuerLine } from "@haben/core";
import { useState } from "react";
import { barPath, euroAxis, niceTicks, useChartWidth } from "../../lib/chart.ts";
import { ScrollTable } from "../../components/ScrollTable.tsx";
import type { Data } from "./-auswertungen-offen.tsx";

export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

/** Die EÜR des Jahres nach § 4 Abs. 3 EStG, nur im Einzelunternehmen */
export function EuerCard({ euer, versteuerung }: { euer: Data["euer"]; versteuerung: Data["versteuerung"] }) {
  const year = euer.year;
  return (
    <section className="card" aria-labelledby="euer-heading">
      <div>
        <h2 id="euer-heading">Einnahmen-Überschuss-Rechnung {year}</h2>
        <p className="small muted" style={{ margin: "4px 0 0" }}>
          Bruttomethode wie in der Anlage EÜR: vereinnahmte Umsatzsteuer ist Einnahme, gezahlte Vorsteuer und die Umsatzsteuer an das Finanzamt sind Ausgaben (
          {versteuerung === "ist" ? "Ist" : "Soll"}-Versteuerung ändert daran nichts).
        </p>
      </div>
      <ScrollTable className="report-table euer-table">
        <caption className="visually-hidden">Einnahmen-Überschuss-Rechnung {year}</caption>
        <thead>
          <tr>
            <th scope="col">Position</th>
            <th scope="col" className="num">
              Betrag
            </th>
          </tr>
        </thead>
        <EuerSection title="Betriebseinnahmen" lines={euer.einnahmen} total={euer.totalEinnahmen} />
        <EuerSection title="Betriebsausgaben" lines={euer.ausgaben} total={euer.totalAusgaben} />
        <tbody>
          <tr className="euer-result">
            <th scope="row">{euer.gewinn >= 0 ? "Gewinn" : "Verlust"}</th>
            <td className="num">{formatEuro(euer.gewinn)}</td>
          </tr>
          {euer.gewerbesteuerNichtAbziehbar !== 0 && (
            <tr>
              <th scope="row" className="muted">
                Nachrichtlich: Gewerbesteuer und Nebenleistungen darauf, Hinterziehungszinsen; keine Betriebsausgaben (§ 4 Abs. 5b, Abs. 5 Satz 1 Nr. 8a EStG)
              </th>
              <td className="num muted">{formatEuro(euer.gewerbesteuerNichtAbziehbar)}</td>
            </tr>
          )}
        </tbody>
      </ScrollTable>
    </section>
  );
}

export function EuerSection({ title, lines, total }: { title: string; lines: EuerLine[]; total: number }) {
  return (
    <tbody>
      <tr className="euer-section">
        <th scope="rowgroup" colSpan={2}>
          {title}
        </th>
      </tr>
      {lines.map((line) => (
        <tr key={line.key} className={line.amount === 0 ? "euer-zero" : undefined}>
          <th scope="row" className="euer-label">
            {line.label}
            {line.note && <span className="small muted"> · {line.note}</span>}
          </th>
          <td className="num">{formatEuro(line.amount)}</td>
        </tr>
      ))}
      <tr className="euer-total">
        <th scope="row">Summe {title}</th>
        <td className="num">{formatEuro(total)}</td>
      </tr>
    </tbody>
  );
}

export const H = 260;

export const M = { top: 12, right: 8, bottom: 28, left: 72 };

export const GAP = 2;

export function MonthlyChart({ year, einnahmen, ausgaben }: { year: number; einnahmen: number[]; ausgaben: number[] }) {
  const [active, setActive] = useState<number | null>(null);
  const [chartRef, W] = useChartWidth();
  const values = [...einnahmen, ...ausgaben];
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const y = (v: number) => M.top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const slot = plotW / 12;
  const BAR = Math.min(18, Math.floor(slot * 0.38));
  // Schmale Diagramme: nur jeden zweiten Monat beschriften
  const labelEvery = slot < 34 ? 2 : 1;
  const base = y(0);
  const empty = values.every((v) => v === 0);

  return (
    <div className="chart" ref={chartRef} onPointerLeave={() => setActive(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Säulendiagramm: Einnahmen und Ausgaben je Monat ${year}, netto in Euro`}>
        <g aria-hidden="true">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} className={t === 0 ? "axis-base" : "grid"} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" style={{ textAnchor: "end" }} className="tick">
                {euroAxis.format(t / 100)} €
              </text>
            </g>
          ))}
          {MONTHS_SHORT.map((m, i) =>
            i % labelEvery === 0 ? (
              <text key={m} x={M.left + slot * i + slot / 2} y={H - 8} style={{ textAnchor: "middle" }} className="tick">
                {m}
              </text>
            ) : null,
          )}
        </g>
        {MONTHS.map((m, i) => {
          const cx = M.left + slot * i + slot / 2;
          const inV = einnahmen[i]!;
          const outV = ausgaben[i]!;
          return (
            <g
              key={m}
              className={active === i ? "month active" : "month"}
              tabIndex={0}
              role="img"
              aria-label={`${m}: Einnahmen ${formatEuro(inV)}, Ausgaben ${formatEuro(outV)}`}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <rect x={M.left + slot * i} y={M.top} width={slot} height={plotH} className="hit" />
              <path d={barPath(cx - BAR - GAP / 2, base, y(inV), BAR)} className="bar bar-in" />
              <path d={barPath(cx + GAP / 2, base, y(outV), BAR)} className="bar bar-out" />
            </g>
          );
        })}
      </svg>
      {empty && <p className="chart-empty small muted">Keine Zahlungen in {year}.</p>}
      {active !== null && (
        <div
          className="chart-tooltip"
          role="presentation"
          style={{
            left: `${((M.left + slot * active + slot / 2) / W) * 100}%`,
            // am Rand nicht über die Karte hinausragen
            transform: active < 2 ? "translateX(-20%)" : active > 9 ? "translateX(-80%)" : "translateX(-50%)",
          }}
        >
          <div className="tt-title">
            {MONTHS[active]} {year}
          </div>
          <div className="tt-row">
            <span className="tt-key tt-in" />
            <strong>{formatEuro(einnahmen[active]!)}</strong>
            <span className="muted">Einnahmen</span>
          </div>
          <div className="tt-row">
            <span className="tt-key tt-out" />
            <strong>{formatEuro(ausgaben[active]!)}</strong>
            <span className="muted">Ausgaben</span>
          </div>
        </div>
      )}
    </div>
  );
}
