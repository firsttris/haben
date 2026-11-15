import { lexToCents } from "../lexoffice/map.ts";
import { sevNumber } from "./map.ts";
import type { SevVatReport } from "./types.ts";

/*
 * Übermittelte Umsatzsteuer-Voranmeldungen aus sevDesk (GET /VatReport), nur fürs Archiv: Haben rechnet sie nicht neu
 * und sendet sie nicht. Aufbau laut Testdaten (test-fixtures/sevdesk, Version 1.0 und 2.0):
 *
 * - reportingYear und reportingPeriod als Text, reportingPeriodCode "monthly" (Monat 1–12) oder "quarterly" (1–4).
 * - reportingValues ist JSON als Text: Kennzahl → Wert, Bemessungsgrundlagen als ganze Euro (Zahl), Steuerbeträge als
 *   Text mit zwei Nachkommastellen ("83": "123.45"). Welche Kennzahlen vorkommen, hängt vom Jahr des Formulars ab.
 * - reportDate ist der Zeitpunkt der Übermittlung, financeAuthorityTicketNumber das Transferticket, document das
 *   Protokoll als PDF, actualTaxation "1" bei Ist-Versteuerung, corrected "1" bei einer berichtigten Anmeldung,
 *   testCase "1" bei einer Testübermittlung.
 *
 * Die Felder stehen nicht im Schema (types.ts): Eine unerwartete Form soll den Abruf nicht scheitern lassen.
 */

export interface SevMappedVatReport {
  /** "vatreport/<id>" */
  externalId: string;
  year: number;
  /** Zeitraum wie vat_returns.month: 1–12 für Monate, 41–44 für Quartale; null bei unbekanntem reportingPeriodCode */
  month: number | null;
  /** reportingPeriodCode und reportingPeriod unverändert, z. B. "quarterly 2" */
  periodText: string;
  /** Zeitpunkt der Übermittlung (reportDate) mit Zeitzone; null, wenn er fehlt */
  submittedAt: string | null;
  /** true bei Ist-, false bei Soll-Versteuerung; null, wenn nicht angegeben */
  actualTaxation: boolean | null;
  corrected: boolean;
  ticket: string | null;
  /** ID des Protokolls (Document) in sevDesk */
  documentId: string | null;
  /** Kennzahlen in Cent, auch die in ganzen Euro gemeldeten Bemessungsgrundlagen; nach Kennzahl aufsteigend */
  kennzahlen: { kz: string; cents: number }[];
  /** Kz 83 in Cent; null, wenn sie fehlt */
  kz83: number | null;
}

type Loose = Record<string, unknown>;

function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

const isOne = (value: unknown) => text(value) === "1";

/** Testübermittlungen sind kein Nachweis einer Abgabe und bleiben draußen. */
export function isSevVatReportArchivable(report: SevVatReport): boolean {
  return !isOne((report as Loose).testCase);
}

function month(code: string | null, period: number): number | null {
  if (code === "monthly" && period >= 1 && period <= 12) return period;
  if (code === "quarterly" && period >= 1 && period <= 4) return 40 + period;
  return null;
}

/** reportingValues: JSON als Text, Werte als Zahl oder Text; was keine Zahl ist, fehlt */
function kennzahlen(value: unknown): { kz: string; cents: number }[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  return Object.entries(parsed as Loose)
    .flatMap(([kz, raw]) => {
      const t = text(raw);
      if (!/^\d+$/.test(kz) || t == null || !Number.isFinite(Number(t.replace(",", ".")))) return [];
      return [{ kz, cents: lexToCents(sevNumber(t)) }];
    })
    .sort((a, b) => Number(a.kz) - Number(b.kz));
}

export function mapSevVatReport(report: SevVatReport): SevMappedVatReport {
  const raw = report as Loose;
  const id = String(report.id);
  const year = Number(text(raw.reportingYear));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error(`sevDesk-Voranmeldung ${id} hat kein lesbares Jahr`);
  const code = text(raw.reportingPeriodCode);
  const period = Number(text(raw.reportingPeriod));
  const values = kennzahlen(raw.reportingValues);
  const document = raw.document && typeof raw.document === "object" ? (raw.document as Loose) : null;
  const taxation = text(raw.actualTaxation);
  return {
    externalId: `vatreport/${id}`,
    year,
    month: Number.isInteger(period) ? month(code, period) : null,
    periodText: [code, text(raw.reportingPeriod)].filter(Boolean).join(" "),
    submittedAt: text(raw.reportDate),
    actualTaxation: taxation === "1" ? true : taxation === "0" ? false : null,
    corrected: isOne(raw.corrected),
    ticket: text(raw.financeAuthorityTicketNumber),
    documentId: document ? text(document.id) : null,
    kennzahlen: values,
    kz83: values.find((v) => v.kz === "83")?.cents ?? null,
  };
}
