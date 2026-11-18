import { formatEuro, periodLabel } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { formatDate } from "../lib/format.ts";
import type { getInvoiceSummary } from "../server/functions/invoices.ts";
import type { getOverview } from "../server/functions/vat.ts";

type Rechnungen = Awaited<ReturnType<typeof getInvoiceSummary>>;
export type UebersichtDaten = Awaited<ReturnType<typeof getOverview>> & { invoices: Rechnungen };

/** Noch nichts erfasst: jede Karte zeigte 0,00 €. Dann entfällt die Reihe, bis es Zahlen gibt (#1253). */
export const ohneKennzahlen = (data: UebersichtDaten) =>
  data.invoices.recent.length === 0 &&
  data.invoices.openCount === 0 &&
  data.invoices.payables.count === 0 &&
  data.invoices.revenuePreviousMonth === 0 &&
  data.computedKz83 === 0 &&
  data.current === null &&
  data.invoices.bank.every((a) => a.balance === null);

interface Props {
  data: UebersichtDaten;
  showVatPeriod: boolean;
  sent: boolean;
  vatRequired: boolean;
  /** Was von der Voranmeldung des Zeitraums noch offen ist (Cent) */
  periodOpen: number;
  zahllast: number;
  zahllastOffen: number;
  taxShortfall: number;
  taxAccount: Rechnungen["bank"][number] | undefined;
}

/** Die Kennzahlenreihe der Übersicht: nur Zahlen, jede Karte mit der Frage, die man beim Draufschauen hat */
export function UebersichtKennzahlen({ data, showVatPeriod, sent, vatRequired, periodOpen, zahllast, zahllastOffen, taxShortfall, taxAccount }: Props) {
  return (
    <div className="grid-4">
      <Link to="/auswertungen" hash="receivables" className="card card-link">
        <div className="kpi-label">Offene Forderungen</div>
        <div className="kpi-value">{formatEuro(data.invoices.openTotal)}</div>
        <div className="small" style={{ color: data.invoices.overdueCount ? "var(--warn-ink)" : "var(--muted)" }}>
          {data.invoices.openCount} {data.invoices.openCount === 1 ? "Rechnung" : "Rechnungen"}
          {data.invoices.overdueCount ? ` · ${data.invoices.overdueCount} überfällig` : ""}
        </div>
      </Link>
      <Link to="/auswertungen" hash="payables" className="card card-link">
        <div className="kpi-label">Offene Verbindlichkeiten</div>
        <div className="kpi-value">{formatEuro(data.invoices.payables.total)}</div>
        <div className="small" style={{ color: data.invoices.payables.overdueCount ? "var(--warn-ink)" : "var(--muted)" }}>
          {data.invoices.payables.count} {data.invoices.payables.count === 1 ? "Beleg" : "Belege"}
          {data.invoices.payables.overdueCount
            ? ` · ${data.invoices.payables.overdueCount} überfällig`
            : data.invoices.payables.nextDue
              ? ` · nächste fällig ${formatDate(data.invoices.payables.nextDue)}`
              : ""}
        </div>
      </Link>
      <div className="card">
        <div className="kpi-label">Umsatz {periodLabel(data.previousMonth).split(" ")[0]} (netto)</div>
        <div className="kpi-value">{formatEuro(data.invoices.revenuePreviousMonth)}</div>
        <div className="small muted">Erlöse nach Buchungsdatum</div>
      </div>
      {showVatPeriod && (
        <div className="card">
          <div className="kpi-label">USt-Zahllast {periodLabel(data.period)}</div>
          <div className="kpi-value">{formatEuro(data.current?.status === "sent" ? data.current.kz83 : data.computedKz83)}</div>
          <div className="small muted">
            {sent
              ? `gesendet ${formatDate(data.current!.sentAt!)} · ${periodOpen === 0 ? "ausgeglichen" : `${periodOpen > 0 ? "offen" : "Erstattung offen"} ${formatEuro(Math.abs(periodOpen))}`}`
              : vatRequired
                ? `Voranmeldung fällig ${formatDate(data.dueDate)}`
                : "keine reguläre Voranmeldung"}
          </div>
        </div>
      )}
      {taxAccount && taxAccount.balance !== null && !data.kleinunternehmer && (
        <div className="card">
          <div className="kpi-label">{taxAccount.name}</div>
          <div className="kpi-value">{formatEuro(taxAccount.balance)}</div>
          <div className="small" style={{ color: taxShortfall > 0 ? "var(--warn-ink)" : "var(--muted)" }}>
            Steuerkonto ·{" "}
            {zahllast <= 0 && zahllastOffen === 0
              ? "keine Zahllast offen"
              : zahllastOffen === 0
                ? `Zahllast ${formatEuro(zahllast)} bezahlt`
                : taxShortfall > 0
                  ? `Zahllast ${formatEuro(zahllastOffen)} – es fehlen ${formatEuro(taxShortfall)}`
                  : `Zahllast ${formatEuro(zahllastOffen)} – gedeckt`}
          </div>
        </div>
      )}
      {[
        ...data.invoices.bank.filter((a) => a.balance !== null && a.purpose === "geschaeft"),
        ...data.invoices.bank.filter((a) => a.balance !== null && a.purpose !== "geschaeft" && a.purpose !== "steuer"),
      ]
        .slice(0, 1)
        .map((a) => (
          <div className="card" key={a.id}>
            <div className="kpi-label">Kontostand {a.name}</div>
            <div className="kpi-value">{formatEuro(a.balance!)}</div>
            <div className="small muted">{a.balanceDate ? `Stand letzter Import ${formatDate(a.balanceDate)}` : "Stand letzter Import"}</div>
          </div>
        ))}
    </div>
  );
}
