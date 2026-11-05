import { formatDecimal, formatEuro, formatPercent, parseEuro, skontoGezogen, type Cents, type SkontoZahlfrist } from "@haben/core";
import { useState } from "react";
import { formatDate } from "../lib/format.ts";

export interface CashInvoiceOption {
  id: string;
  number: string;
  date: string;
  customer: string;
  open: Cents;
  skonto: SkontoZahlfrist[];
}

/**
 * Felder für eine Bareinnahme auf eine offene Ausgangsrechnung im Formular des Kassenbuchs: Rechnung, Betrag (vorbelegt
 * mit dem offenen Betrag) und, wenn ein Rest bleibt, „Rest als Skonto ausbuchen“. Zahlt der Kunde in der Frist den
 * Betrag mit Skonto, ist das Häkchen gesetzt, wie der Vorschlag im Bankabgleich. Gelesen wird per FormData.
 */
export function CashInvoiceFields({ invoices, preselected, date }: { invoices: CashInvoiceOption[]; preselected?: string; date: string }) {
  const initial = invoices.find((i) => i.id === preselected) ?? invoices[0];
  const [invoiceId, setInvoiceId] = useState(initial?.id ?? "");
  const [amount, setAmount] = useState(initial ? formatDecimal(initial.open) : "");
  /** null: automatisch, gesetzt, wenn der Betrag einer Skontostufe in der Frist entspricht */
  const [skontoChoice, setSkontoChoice] = useState<boolean | null>(null);
  const invoice = invoices.find((i) => i.id === invoiceId);

  if (!invoice) {
    return (
      <p className="small muted" style={{ margin: 0, gridColumn: "1 / -1" }}>
        Keine offene Rechnung in Euro. Bar kassieren lässt sich eine festgeschriebene Rechnung, solange noch etwas offen ist.
      </p>
    );
  }

  const parsed = parseEuro(amount);
  const rest = parsed === null ? 0 : invoice.open - parsed;
  const taken = parsed === null ? undefined : skontoGezogen(invoice.skonto, date, parsed);
  const skonto = rest > 0 && (skontoChoice ?? taken !== undefined);
  const running = invoice.skonto.filter((s) => date <= s.paidBy);

  function choose(id: string) {
    const next = invoices.find((i) => i.id === id);
    setInvoiceId(id);
    setAmount(next ? formatDecimal(next.open) : "");
    setSkontoChoice(null);
  }

  return (
    <>
      <label className="field" style={{ gridColumn: "1 / -1" }}>
        Rechnung
        <select name="invoiceId" value={invoiceId} onChange={(e) => choose(e.target.value)} required>
          {invoices.map((i) => (
            <option key={i.id} value={i.id}>
              {i.number} · {i.customer} · offen {formatEuro(i.open)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Betrag (€)
        <input
          name="amount"
          inputMode="decimal"
          placeholder="0,00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={parsed === null || parsed <= 0 || parsed > invoice.open}
          aria-describedby="cash-invoice-open"
          required
        />
      </label>
      <p id="cash-invoice-open" className="small muted" style={{ margin: 0, alignSelf: "end" }}>
        Rechnung vom {formatDate(invoice.date)}, offen {formatEuro(invoice.open)}.
        {rest > 0 && parsed !== null && parsed > 0 && ` Danach bleiben ${formatEuro(rest)} offen.`}
        {parsed !== null && rest < 0 && " Mehr als offen lässt sich nicht bar kassieren."}
      </p>
      {running.length > 0 && (
        <div className="small" style={{ gridColumn: "1 / -1", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {running.map((s) => (
            <span key={s.days}>
              {formatPercent(s.percent)} Skonto bis {formatDate(s.paidBy)}: zu zahlen {formatEuro(s.payable)}{" "}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setAmount(formatDecimal(s.payable));
                  setSkontoChoice(null);
                }}
              >
                Betrag mit Skonto übernehmen
              </button>
            </span>
          ))}
        </div>
      )}
      {rest > 0 && parsed !== null && parsed > 0 && (
        <label className="checkbox" style={{ gridColumn: "1 / -1" }}>
          <input type="checkbox" name="skonto" checked={skonto} onChange={(e) => setSkontoChoice(e.target.checked)} />
          <span>Rest von {formatEuro(rest)} als Skonto ausbuchen</span>
        </label>
      )}
    </>
  );
}
