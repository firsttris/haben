import { formatDecimal, formatEuro, formatPercent, parseEuro, skontoGezogen, type BareinnahmeAngabe, type Cents, type SkontoZahlfrist } from "@haben/core";
import { useState } from "react";
import { formatDate } from "../lib/format.ts";
import { BareinnahmeFelder, bareinnahmeWahl } from "./BareinnahmeFelder.tsx";
import { Field } from "./Field.tsx";

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
 * Betrag mit Skonto, ist das Häkchen gesetzt, wie der Vorschlag im Bankabgleich. Gibt der Kunde mehr als offen, etwa
 * Trinkgeld, wird der Rest eine weitere Einnahme mit Umsatzsteuer und Notiz (#455). Gelesen wird per FormData.
 */
export function CashInvoiceFields({
  invoices,
  preselected,
  date,
  kleinunternehmer,
}: {
  invoices: CashInvoiceOption[];
  preselected?: string;
  date: string;
  /** Stand am Ende des Monats der Bareinnahme, für die Steuer der weiteren Einnahme */
  kleinunternehmer: boolean;
}) {
  const initial = invoices.find((i) => i.id === preselected) ?? invoices[0];
  const [invoiceId, setInvoiceId] = useState(initial?.id ?? "");
  const [amount, setAmount] = useState(initial ? formatDecimal(initial.open) : "");
  /** null: automatisch, gesetzt, wenn der Betrag einer Skontostufe in der Frist entspricht */
  const [skontoChoice, setSkontoChoice] = useState<boolean | null>(null);
  const [extraGewaehlt, setExtraSteuer] = useState<BareinnahmeAngabe | null>(null);
  const extraSteuer = bareinnahmeWahl(extraGewaehlt, kleinunternehmer);
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
      <Field label="Rechnung" style={{ gridColumn: "1 / -1" }}>
        {(control) => (
          <select {...control} name="invoiceId" value={invoiceId} onChange={(e) => choose(e.target.value)} required>
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.number} · {i.customer} · offen {formatEuro(i.open)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Betrag (€)" describedBy="cash-invoice-open">
        {(control) => (
          <input
            {...control}
            name="amount"
            inputMode="decimal"
            placeholder="0,00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={parsed === null || parsed <= 0}
            required
          />
        )}
      </Field>
      <p id="cash-invoice-open" className="small muted" style={{ margin: 0, alignSelf: "end" }}>
        Rechnung vom {formatDate(invoice.date)}, offen {formatEuro(invoice.open)}.
        {rest > 0 && parsed !== null && parsed > 0 && ` Danach bleiben ${formatEuro(rest)} offen.`}
        {parsed !== null && rest < 0 && ` Die Rechnung ist damit bezahlt; ${formatEuro(-rest)} darüber werden eine weitere Einnahme.`}
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
      {parsed !== null && rest < 0 && (
        <fieldset className="form-grid" style={{ gridColumn: "1 / -1", border: 0, padding: 0, margin: 0 }}>
          {/* float: Die Legende wird so ein Element des Rasters und steht in einer eigenen Zeile über den Feldern */}
          <legend className="section-label" style={{ float: "left", gridColumn: "1 / -1", padding: 0 }}>
            Weitere Einnahme über {formatEuro(-rest)}, etwa Trinkgeld
          </legend>
          <BareinnahmeFelder kleinunternehmer={kleinunternehmer} value={extraSteuer} onChange={setExtraSteuer} />
          <input type="hidden" name="extraSteuer" value={`${extraSteuer.behandlung}:${extraSteuer.steuersatz}`} />
          <Field label="Notiz zur weiteren Einnahme">{(control) => <input {...control} name="extraText" maxLength={250} placeholder="Trinkgeld" />}</Field>
        </fieldset>
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
