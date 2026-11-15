import { lexDate } from "../lexoffice/map.ts";
import { mapSevVoucher, sevNumber } from "./map.ts";
import type { SevVoucher, SevVoucherPos } from "./types.ts";

/*
 * Vorlage wiederkehrender Belege aus sevDesk (Voucher mit voucherType RV) als Dauerbeleg von Haben (#472). Die Bedeutung der
 * Status ist aus echten Antworten der Buchhaltungsversion 1.0 abgeleitet, sevDesk beschreibt sie nicht: 50 ohne nächsten
 * Termin, 100 mit nächstem Termin (recurringNextVoucher), 1000 mit Enddatum und ohne nächsten Termin. Haben übernimmt jede
 * Vorlage angehalten, bis der Nutzer sie geprüft hat; was sich nicht sicher übertragen lässt, steht in den Hinweisen.
 */

/** Felder eines Dauerbelegs aus der Vorlage; Kategorie und Bezahlung kennt sevDesk nicht */
export interface SevDauerbeleg {
  sevdeskId: string;
  status: "pausiert" | "beendet";
  name: string;
  supplierName: string;
  supplierUstId: string;
  supplierSevdeskId: string | null;
  reference: string;
  category: "sonstiges";
  payment: "bank";
  amounts: { taxRate: 1900 | 700 | 0; net: number; tax: number }[];
  taxShown: boolean;
  intervalMonths: 1 | 3 | 6 | 12;
  anchorDay: number;
  startDate: string;
  nextDate: string;
  endDate: string | null;
  dueDays: number;
  documentId: string | null;
}

export type SevDauerbelegErgebnis = { ok: true; dauerbeleg: SevDauerbeleg; hinweise: string[] } | { ok: false; grund: string };

const INTERVALLE = new Set([1, 3, 6, 12]);
const SAETZE = new Set([1900, 700, 0]);

/** P0Y1M → 1, P1Y → 12; null bei Wochen, Tagen oder unlesbarem Wert */
export function sevIntervalMonths(iso: string | null | undefined): number | null {
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?$/.exec((iso ?? "").trim());
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  return Number(m[1] ?? 0) * 12 + Number(m[2] ?? 0);
}

const deutsch = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Übersetzt eine Vorlage; `heute` entscheidet, ob eine Vorlage mit abgelaufenem Ende als beendet ankommt. */
export function mapSevRecurringVoucher(v: SevVoucher, positions: SevVoucherPos[], heute: string): SevDauerbelegErgebnis {
  const id = String(v.id);
  if ((v.voucherType ?? "").toUpperCase() !== "RV") return { ok: false, grund: "Keine Vorlage wiederkehrender Belege." };
  if ((v.creditDebit ?? "C").toUpperCase() === "D") return { ok: false, grund: "Einnahme: Dauerbelege in Haben sind Ausgaben." };
  const currency = v.currency?.trim() || "EUR";
  if (currency !== "EUR") return { ok: false, grund: `Währung ${currency}: Dauerbelege in Haben sind in Euro.` };

  const months = sevIntervalMonths(v.recurringInterval);
  const intervall = v.recurringIntervall == null || v.recurringIntervall === "" ? null : sevNumber(v.recurringIntervall);
  if (months === null || !INTERVALLE.has(months))
    return { ok: false, grund: `Intervall ${v.recurringInterval ?? "–"} (${intervall ?? "–"}): Haben kennt 1, 3, 6 und 12 Monate.` };

  const { voucher } = mapSevVoucher(v, positions);
  if (voucher.gross < 0) return { ok: false, grund: "Negative Summe: Dauerbelege sind Ausgaben, keine Gutschriften." };
  const fremd = voucher.taxes.find((t) => !SAETZE.has(t.rate));
  if (fremd) return { ok: false, grund: `Steuersatz ${fremd.rate / 100} %: Dauerbelege kennen 19, 7 und 0 %.` };
  if (voucher.taxes.some((t) => t.net < 0 || t.tax < 0)) return { ok: false, grund: "Negative Position: Dauerbelege sind Ausgaben." };

  const status = sevNumber(v.status);
  const start = lexDate(v.recurringStartDate);
  const next = lexDate(v.recurringNextVoucher);
  const end = lexDate(v.recurringEndDate);
  const hinweise: string[] = [];
  // Maßgeblich ist die ISO-Dauer; recurringIntervall stimmte im echten Konto mit ihr überein, in den Testdaten nicht
  if (intervall !== null && intervall !== months)
    hinweise.push(`Intervall in sevDesk widersprüchlich (${v.recurringInterval}, ${intervall}); ${months} Monate übernommen.`);
  const nextDate = next ?? start;
  if (!nextDate) return { ok: false, grund: "Weder nächster Termin noch Start angegeben." };
  if (!next) hinweise.push(`In sevDesk kein nächster Termin (Status ${v.status ?? "–"}); der nächste Beleg steht auf dem Start ${deutsch(nextDate)}.`);
  if (status !== 50 && status !== 100 && status !== 1000) hinweise.push(`Status ${v.status ?? "–"} in sevDesk unbekannt.`);
  const beendet = end !== null && end < heute;
  if (end && !beendet) hinweise.push(`In sevDesk endet die Vorlage am ${deutsch(end)}.`);

  const supplierName = v.supplierName?.trim() || v.supplierNameAtSave?.trim() || "";
  const reference = v.description?.trim() ?? "";
  if (!supplierName) hinweise.push("In sevDesk ohne Lieferantennamen.");
  hinweise.push("Kategorie und Bezahlung kennt sevDesk nicht: „Sonstiger Aufwand“ und Geschäftskonto gesetzt.");
  if ((v.taxType ?? "default") !== "default") hinweise.push(`Steuerart „${v.taxType}“ in sevDesk; Steuersatz und Vorsteuer prüfen.`);
  if (voucher.gross === 0) hinweise.push("In sevDesk ohne Betrag.");
  const documentId = v.document?.id == null ? null : String(v.document.id);
  if (!documentId) hinweise.push("In sevDesk ohne Datei: Vor dem Fortsetzen den Vertrag oder die Dauerrechnung hochladen.");

  const voucherDate = lexDate(v.voucherDate);
  const deadline = lexDate(v.paymentDeadline);
  const dueDays = voucherDate && deadline ? Math.min(120, Math.max(0, daysBetween(voucherDate, deadline))) : 0;
  const amounts = voucher.taxes.map((t) => ({ taxRate: t.rate as 1900 | 700 | 0, net: t.net, tax: t.tax }));

  return {
    ok: true,
    hinweise,
    dauerbeleg: {
      sevdeskId: id,
      status: beendet ? "beendet" : "pausiert",
      name: (supplierName || reference || `Vorlage ${id} aus sevDesk`).slice(0, 200),
      supplierName: (supplierName || "Unbekannt (aus sevDesk)").slice(0, 200),
      supplierUstId: (v.vatNumber ?? "").replace(/\s/g, "").toUpperCase().slice(0, 20),
      supplierSevdeskId: v.supplier?.id == null ? null : String(v.supplier.id),
      reference: reference.slice(0, 100),
      category: "sonstiges",
      payment: "bank",
      amounts,
      taxShown: amounts.some((a) => a.tax > 0),
      intervalMonths: months as 1 | 3 | 6 | 12,
      anchorDay: Number(nextDate.slice(8, 10)),
      startDate: start ?? nextDate,
      nextDate,
      endDate: end,
      dueDays,
      documentId,
    },
  };
}
