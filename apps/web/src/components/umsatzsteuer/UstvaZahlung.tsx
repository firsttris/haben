import { formatEuro, type VatPostenStand } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { formatDate } from "../../lib/format.ts";

/**
 * Zahllast bzw. Erstattung der abgegebenen Voranmeldung als offener Posten: Betrag, Fälligkeit, Zahlungen aus dem
 * Bankabgleich und was offen ist; eine berichtigte Anmeldung als eigener Posten über die Differenz.
 */
export function UstvaZahlung({ posten }: { posten: VatPostenStand[] }) {
  const headingId = useId();
  if (posten.length === 0) return null;
  return (
    <section className="card" aria-labelledby={headingId}>
      <h2 id={headingId}>Zahlung an das Finanzamt</h2>
      {posten.map((p) => (
        <div key={p.vatReturnId} className="stack" style={{ gap: 4 }}>
          <div className="history-row">
            <span style={{ fontWeight: 500 }}>
              {p.berichtigt ? "Berichtigung: " : ""}
              {p.betrag >= 0 ? "Zahllast" : "Erstattung"} {formatEuro(Math.abs(p.betrag))}
            </span>
            <span className={`pill ${p.offen === 0 ? "pill-ok" : "pill-info"}`}>
              {p.offen === 0 ? "ausgeglichen" : `offen ${formatEuro(Math.abs(p.offen))}`}
            </span>
          </div>
          <span className="small muted">
            {p.betrag >= 0 ? "fällig" : "Erstattung ab Zustimmung des Finanzamts, frühestens"} {formatDate(p.faellig)}
            {p.verrechnet !== 0 ? ` · ${formatEuro(Math.abs(p.verrechnet))} mit der Berichtigung verrechnet` : ""}
          </span>
          {p.zahlungen.map((z) => (
            <span key={z.id} className="small">
              {formatDate(z.bookingDate)} · {z.amount < 0 ? "Lastschrift" : "Erstattung"} {formatEuro(Math.abs(z.amount))}
              {z.ohneBezug ? " (ohne Bezug zugeordnet, Betrag passt)" : ""}
            </span>
          ))}
        </div>
      ))}
      {posten.some((p) => p.offen !== 0) && (
        <p className="small muted" style={{ margin: 0 }}>
          Die Lastschrift oder Erstattung des Finanzamts ordnest du im <Link to="/bank">Bankabgleich</Link> dieser Voranmeldung zu. Säumniszuschläge sind keine
          Umsatzsteuer: Sie gehören als Beleg in die Betriebsausgaben.
        </p>
      )}
    </section>
  );
}
