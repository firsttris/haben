import { formatDecimal, formatHundredths, type SkontoStufe } from "@haben/core";
import { useState } from "react";
import { FORMAT_LABEL, FORMATS, type InvoiceFormat } from "../lib/invoice.ts";
import type { ContactInput } from "../server/modules/stammdaten/index.ts";
import { Field } from "./Field.tsx";
import { parseSkontoRows, SkontoFields, type SkontoRow } from "./SkontoFields.tsx";
import { WeitereAngaben } from "./WeitereAngaben.tsx";

export interface KontaktWeitereWerte {
  debitorNr: string;
  kreditorNr: string;
  hourlyRate: string;
  leitwegId: string;
  defaultFormat: InvoiceFormat | "";
  /** Skonto: false = wie in den Einstellungen, true = eigene Stufen (leer = ohne Skonto) */
  ownSkonto: boolean;
  skonto: readonly SkontoStufe[];
}

/** Was in „Weitere Angaben“ gesetzt ist, für die Überschrift des zugeklappten Bereichs: „Leitweg-ID gesetzt · Skonto 2 % in 10 Tagen“ */
export function kontaktWeitereKurz(werte: KontaktWeitereWerte): string {
  const skonto = werte.ownSkonto
    ? werte.skonto.length > 0
      ? `Skonto ${werte.skonto.map((s) => `${formatHundredths(s.percent).replace(/,00$/, "")} % in ${s.days} Tagen`).join(", ")}`
      : "ohne Skonto"
    : "";
  const gesetzt = [
    werte.debitorNr.trim() && `DATEV-Debitor ${werte.debitorNr.trim()}`,
    werte.kreditorNr.trim() && `DATEV-Kreditor ${werte.kreditorNr.trim()}`,
    werte.hourlyRate.trim() && `Stundensatz ${werte.hourlyRate.trim()} €`,
    werte.leitwegId.trim() && "Leitweg-ID gesetzt",
    werte.defaultFormat && `Format ${FORMAT_LABEL[werte.defaultFormat].split(" · ")[0]}`,
    skonto,
  ]
    .filter(Boolean)
    .join(" · ");
  return gesetzt || "optional: DATEV-Konten, Skonto, Stundensatz, Leitweg-ID, Rechnungsformat";
}

/**
 * Das Feld (Name im Formular), das eine Meldung des Formulars oder des Servers nennt; undefined bei jeder anderen Meldung. Zod-Meldungen des Servers tragen keine `felder` (nur `UserError`), darum
 * nennen die Schranken im Schema das Feld im Text (`contactSchema`).
 */
const MELDUNG_FELD = [
  [/Debitor/i, "debitorNr"],
  [/Kreditor/i, "kreditorNr"],
  [/Stundensatz/i, "hourlyRateCents"],
  [/Leitweg/i, "leitwegId"],
  [/Skonto/i, "skonto"],
] as const;
export const weitereAngabenFeld = (meldung: string): string | undefined => MELDUNG_FELD.find(([muster]) => muster.test(meldung))?.[1];
export const betrifftWeitereAngaben = (meldung: string) => weitereAngabenFeld(meldung) !== undefined;

/**
 * Das Seltene am Kontakt eingeklappt (#1253): DATEV-Konten, Stundensatz, Leitweg-ID, Rechnungsformat und Skonto. Die Felder
 * bleiben im Formular, auch zugeklappt, und gehen wie zuvor mit dem Speichern an den Server. Den Skonto-Zustand hält die
 * Seite, weil sie ihn beim Speichern prüft; `offen` auch, damit sie den Bereich bei einem Fehler darin aufklappen kann.
 */
export function ContactWeitereAngaben({
  initial,
  ownSkonto,
  onOwnSkonto,
  skontoRows,
  onSkontoRows,
  offen,
  onOffen,
}: {
  initial: ContactInput;
  ownSkonto: boolean;
  onOwnSkonto: (own: boolean) => void;
  skontoRows: SkontoRow[];
  onSkontoRows: (rows: SkontoRow[]) => void;
  offen: boolean;
  onOffen: (offen: boolean) => void;
}) {
  const [debitorNr, setDebitorNr] = useState(String(initial.debitorNr ?? ""));
  const [kreditorNr, setKreditorNr] = useState(String(initial.kreditorNr ?? ""));
  const [hourlyRate, setHourlyRate] = useState(initial.hourlyRateCents == null ? "" : formatDecimal(initial.hourlyRateCents));
  const [leitwegId, setLeitwegId] = useState(initial.leitwegId);
  const [defaultFormat, setDefaultFormat] = useState<InvoiceFormat | "">(initial.defaultFormat ?? "");
  const kurz = kontaktWeitereKurz({ debitorNr, kreditorNr, hourlyRate, leitwegId, defaultFormat, ownSkonto, skonto: parseSkontoRows(skontoRows).stufen });
  return (
    <div className="form-section">
      <WeitereAngaben kurz={kurz} offen={offen} onOffen={onOffen}>
        <Field label="DATEV-Debitor" describedBy="personenkonten-hint">
          {(control) => (
            <input
              {...control}
              name="debitorNr"
              value={debitorNr}
              onChange={(e) => setDebitorNr(e.target.value)}
              inputMode="numeric"
              placeholder="optional, 10000 bis 69999"
              className="mono"
            />
          )}
        </Field>
        <Field label="DATEV-Kreditor" describedBy="personenkonten-hint">
          {(control) => (
            <input
              {...control}
              name="kreditorNr"
              value={kreditorNr}
              onChange={(e) => setKreditorNr(e.target.value)}
              inputMode="numeric"
              placeholder="optional, 70000 bis 99999"
              className="mono"
            />
          )}
        </Field>
        <p id="personenkonten-hint" className="field-hint" style={{ gridColumn: "1 / -1", margin: 0 }}>
          Personenkonten für den DATEV-Export an die Steuerberatung, getrennt von Kunden- und Lieferantennummer.
        </p>
        <Field label="Stundensatz (€, optional)" hint="Vorgabe für neue Leistungseinträge dieses Kunden; jeder Eintrag behält den Satz vom Anlegen.">
          {(control) => (
            <input
              {...control}
              name="hourlyRateCents"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              inputMode="decimal"
              placeholder="95,00"
            />
          )}
        </Field>
        <Field label="Leitweg-ID (öffentliche Auftraggeber)" hint="Nur bei Rechnungen an Behörden nötig; steht in deren Auftrag.">
          {(control) => <input {...control} name="leitwegId" value={leitwegId} onChange={(e) => setLeitwegId(e.target.value)} className="mono" />}
        </Field>
        <Field label="Standardformat für Rechnungen">
          {(control) => (
            <select {...control} name="defaultFormat" value={defaultFormat} onChange={(e) => setDefaultFormat(e.target.value as InvoiceFormat | "")}>
              <option value="">wie in den Einstellungen</option>
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_LABEL[f]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Skonto">
          {(control) => (
            <select {...control} name="skonto" value={ownSkonto ? "eigen" : "vorgabe"} onChange={(e) => onOwnSkonto(e.target.value === "eigen")}>
              <option value="vorgabe">wie in den Einstellungen</option>
              <option value="eigen">eigenes für diesen Kunden</option>
            </select>
          )}
        </Field>
        {ownSkonto && (
          <SkontoFields
            id="contact-skonto"
            rows={skontoRows}
            onChange={onSkontoRows}
            hint="Ohne Stufe bekommt dieser Kunde kein Skonto. Eine Frist, die länger ist als das Zahlungsziel der Rechnung, entfällt dort."
          />
        )}
      </WeitereAngaben>
    </div>
  );
}
