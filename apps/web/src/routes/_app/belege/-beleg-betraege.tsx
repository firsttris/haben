import { formatDecimal, formatEuro, isKapitalgesellschaft } from "@haben/core";
import { BelegUmsatzsteuer } from "../../../components/BelegUmsatzsteuer.tsx";
import { betragszeileAus } from "../../../lib/betragszeile.ts";
import { Field } from "../../../components/Field.tsx";
import { VorsteuerAnteil, steuerSpalte } from "../../../components/VorsteuerAnteil.tsx";
import { type DocumentFormState, type Rate, nextRowKey } from "./-beleg-zustand.ts";
import type { Detail } from "./-beleg-vorschau.tsx";

/** Karte „Beträge je Steuersatz“ mit § 13b, Summe, Vorsteueranteil und Privatanteil */
export function Betraege({ f, data }: { f: DocumentFormState; data: Detail }) {
  const {
    readOnly,
    running,
    category,
    privateShare,
    setPrivateShare,
    setVorsteuerAnteil,
    reverseCharge,
    rows,
    setRows,
    splitting,
    setDirty,
    parsed,
    privateShareValue,
    vorsteuerBeleg,
    currencyCode,
    foreign,
    error,
    gross,
    euroRows,
    euroGross,
    looksLikeReverseCharge,
    chooseReverseCharge,
    touch,
    updateRow,
  } = f;
  return (
    <fieldset className="card" disabled={readOnly || running} style={{ margin: 0 }}>
      <legend style={{ fontWeight: 600, fontSize: 16, padding: 0, marginBottom: 4 }}>Beträge je Steuersatz</legend>
      <BelegUmsatzsteuer value={reverseCharge} onChange={chooseReverseCharge} looksLikeReverseCharge={looksLikeReverseCharge} />
      {rows.map((row, index) => (
        <div className={reverseCharge ? "amount-row" : "amount-row with-gross"} key={row.key}>
          <Field label="Satz" error={error(`satz-${row.key}`)}>
            {(control) => (
              <select {...control} value={row.taxRate} onChange={(e) => updateRow(row.key, { taxRate: Number(e.target.value) as Rate })}>
                <option value={1900}>19 %</option>
                <option value={700}>7 %</option>
                {!reverseCharge && <option value={0}>0 %</option>}
              </select>
            )}
          </Field>
          <Field label={foreign ? `Netto ${currencyCode}` : "Netto"} error={error(`netto-${row.key}`)}>
            {(control) => (
              <input
                {...control}
                className="mono"
                inputMode="decimal"
                value={row.net}
                placeholder="0,00"
                onChange={(e) => updateRow(row.key, { net: e.target.value })}
              />
            )}
          </Field>
          <Field
            label={
              <>
                {steuerSpalte(reverseCharge, vorsteuerBeleg, [row])}
                {foreign ? ` ${currencyCode}` : ""}
                {reverseCharge ? " (automatisch)" : ""}
              </>
            }
            describedBy={reverseCharge ? "self-assessed-tax-hint" : undefined}
            error={error(`steuer-${row.key}`)}
          >
            {(control) => (
              <input
                {...control}
                className="mono"
                inputMode="decimal"
                value={row.tax}
                placeholder="0,00"
                readOnly={Boolean(reverseCharge)}
                onChange={(e) => updateRow(row.key, { tax: e.target.value, taxTouched: true })}
              />
            )}
          </Field>
          {/* Brutto laut Beleg (#917): Eingabe rechnet Netto und Vorsteuer vor; bei § 13b gezahlt wird netto, also kein Brutto */}
          {!reverseCharge && (
            <Field label={foreign ? `Brutto ${currencyCode}` : "Brutto"} error={error(`brutto-${row.key}`)}>
              {(control) => (
                <input
                  {...control}
                  className="mono"
                  inputMode="decimal"
                  value={row.gross}
                  placeholder="0,00"
                  onChange={(e) => updateRow(row.key, { gross: e.target.value })}
                />
              )}
            </Field>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-label={`Zeile ${index + 1} entfernen`}
            disabled={rows.length === 1}
            onClick={() => {
              setRows((prev) => prev.filter((r) => r.key !== row.key));
              setDirty(true);
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      ))}
      {reverseCharge && (
        <p id="self-assessed-tax-hint" className="small">
          Haben berechnet die Steuer automatisch aus Netto und Satz. Änderungen am Netto oder am Satz aktualisieren den schreibgeschützten Steuerbetrag.
        </p>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-dashed"
          disabled={rows.length >= 3}
          onClick={() => {
            const used = new Set(rows.map((r) => r.taxRate));
            const rate = ([1900, 700, 0] as Rate[]).find((r) => !used.has(r)) ?? 0;
            setRows((prev) => [...prev, { ...betragszeileAus(nextRowKey(), rate, 0, 0, true, false), vorsteuerAnteil: "" }]);
            setDirty(true);
          }}
        >
          + Steuersatz
        </button>
        <div style={{ textAlign: "right" }}>
          <span className="muted small">{reverseCharge ? "Zu zahlen (netto) " : "Gesamt "}</span>
          <span className="amount" style={{ fontWeight: 600 }}>
            {gross === null ? "–" : foreign ? `${formatDecimal(gross)} ${currencyCode}` : formatEuro(gross)}
          </span>
          {foreign && (
            <div className="small" aria-live="polite">
              {euroRows ? (
                <>
                  in Euro{" "}
                  <span className="amount" style={{ fontWeight: 600 }}>
                    {formatEuro(euroGross!)}
                  </span>
                  {euroRows.length > 0 && (
                    <span className="muted">
                      {" "}
                      ({euroRows.map((e) => `${e.taxRate / 100} %: ${formatDecimal(e.net)} + ${formatDecimal(e.tax)}`).join(" · ")})
                    </span>
                  )}
                </>
              ) : (
                <span className="muted">in Euro erst mit Kurs</span>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Gutschriften mit Minus eingeben.
      </p>
      <VorsteuerAnteil
        {...vorsteuerBeleg}
        privateShare={privateShareValue}
        asset={category === "anlage"}
        importVat={category === "einfuhrumsatzsteuer"}
        onChange={touch(setVorsteuerAnteil)}
        onRateChange={(key, value) => updateRow(key, { vorsteuerAnteil: value })}
        rows={rows.map((row, index) => ({
          key: row.key,
          taxRate: row.taxRate,
          vorsteuerAnteil: row.vorsteuerAnteil,
          net: foreign ? (euroRows?.[index]?.net ?? null) : parsed[index]!.net,
          tax: foreign ? (euroRows?.[index]?.tax ?? null) : parsed[index]!.tax,
        }))}
      />
      {/* Privatanteil nur im Einzelunternehmen; in GmbH und UG wäre er Arbeitslohn oder verdeckte Gewinnausschüttung */}
      {category !== "anlage" && !splitting && !isKapitalgesellschaft(data.rechtsform) && (
        <Field
          label="Privatanteil in %"
          hint="Z. B. beim Handyvertrag: nur der betriebliche Teil wird Ausgabe und Vorsteuer."
          error={error("privatanteil")}
          style={{ maxWidth: 220 }}
        >
          {(control) => (
            <input {...control} inputMode="numeric" value={privateShare} placeholder="0" onChange={(e) => touch(setPrivateShare)(e.target.value)} />
          )}
        </Field>
      )}
    </fieldset>
  );
}
