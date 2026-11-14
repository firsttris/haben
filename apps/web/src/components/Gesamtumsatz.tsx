import { formatEuro } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { formatDate } from "../lib/format.ts";
import type { GesamtumsatzResult } from "../server/modules/auswertungen/index.ts";
import { Field } from "./Field.tsx";
import { ScrollTable } from "./ScrollTable.tsx";

const DECISIONS = { included: "Einbezogen", excluded: "Ausgenommen", unknown: "Ungeklärt" } as const;

/** Bekannte Entgelte und offene Zuordnungen getrennt anzeigen; Unbekanntes ist kein Umsatz von null Euro. */
export function Gesamtumsatz({ result }: { result: GesamtumsatzResult }) {
  const [filter, setFilter] = useState<"all" | keyof typeof DECISIONS>(result.complete ? "all" : "unknown");
  const unknown = result.items.filter((item) => item.decision === "unknown").length;
  const rows = result.items.filter((item) => filter === "all" || item.decision === filter);
  return (
    <section className="card" aria-labelledby="gesamtumsatz-heading">
      <div className="chart-head">
        <div>
          <h2 id="gesamtumsatz-heading">Gesamtumsatz nach § 19 UStG</h2>
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            Vereinnahmte Nettoentgelte {result.year} nach den verfügbaren Zahlungsnachweisen, unabhängig von Ist- oder Soll-Versteuerung.
          </p>
        </div>
        <div>
          <div className="kpi-label">{result.complete ? "Ermittelter Betrag" : "Bekannter Teilbetrag"}</div>
          <div className="kpi-value">{formatEuro(result.included)}</div>
        </div>
      </div>
      {!result.complete && (
        <p className="banner banner-warn">
          {unknown} {unknown === 1 ? "Zuordnung ist" : "Zuordnungen sind"} ungeklärt. Diese Werte sind im Teilbetrag noch nicht enthalten.
        </p>
      )}
      <details>
        <summary>Berechnungsgrundlage und ungeklärte Zuordnungen</summary>
        <Field label="Einordnung" style={{ maxWidth: 280, margin: "12px 0" }}>
          {(control) => (
            <select {...control} value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
              <option value="all">Alle Quellen</option>
              {Object.entries(DECISIONS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <ScrollTable className="report-table">
          <caption className="visually-hidden">Quellen des Gesamtumsatzes {result.year}</caption>
          <thead>
            <tr>
              <th scope="col">Quelle</th>
              <th scope="col">Zahlungstag</th>
              <th scope="col" className="num">
                Nettoentgelt
              </th>
              <th scope="col">Einordnung</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={`${item.source}:${item.sourceId}`}>
                <td>
                  {item.invoiceId ? (
                    <Link to="/rechnungen/$id" params={{ id: item.invoiceId }}>
                      {item.label}
                    </Link>
                  ) : (
                    item.label
                  )}
                </td>
                <td>{item.occurredOn ? formatDate(item.occurredOn) : "Ungeklärt"}</td>
                <td className="num mono">{item.net === null ? "Ungeklärt" : formatEuro(item.net)}</td>
                <td>
                  {DECISIONS[item.decision]}
                  <div className="small muted">{item.reason}</div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4}>Keine Quellen mit dieser Einordnung.</td>
              </tr>
            )}
          </tbody>
        </ScrollTable>
      </details>
    </section>
  );
}
