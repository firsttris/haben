import { TAX_RATES, type RecurringInterval, type ServicePeriodMode, type TaxTreatment } from "@haben/core";
import { lexDate, lexToBasisPoints, lexToCents } from "../lexoffice/map.ts";
import { sevNumber } from "./map.ts";
import type { SevDocumentPos, SevInvoice } from "./types.ts";

/*
 * Vorlagen wiederkehrender Rechnungen aus sevDesk (invoiceType WKR) als wiederkehrende Rechnungen von Haben (#472).
 *
 * Grundlage sind Antworten der Buchhaltungsversion 1.0 (test-fixtures/sevdesk/buchhaltung-1.0/rechnungsvorlage-wkr.json
 * und rechnungen-aus-vorlage.json); sevDesk beschreibt die Felder nicht. Eine Vorlage kommt immer pausiert an, damit
 * Haben nichts erzeugt, bevor jemand sie geprüft hat.
 */

/** Wie sevDesk abrechnet; nur aus den erzeugten Rechnungen ablesbar, an der Vorlage steht es in keinem Feld. */
export type SevBilling = "nachfaellig" | "vorschuessig" | "unklar";

export interface SevRecurringLine {
  description: string;
  detail: string;
  itemNumber: string;
  /** Tausendstel */
  quantity: number;
  unit: "Stk.";
  /** Cent, netto oder brutto nach priceMode */
  unitPrice: number;
  /** Basispunkte */
  taxRate: (typeof TAX_RATES)[number];
}

export interface SevRecurringTemplate {
  name: string;
  intro: string;
  note: string;
  paymentTermDays: number;
  taxTreatment: TaxTreatment;
  priceMode: "netto" | "brutto";
  lines: SevRecurringLine[];
  intervalMonths: RecurringInterval;
  anchorDay: number;
  nextDate: string;
  endDate: string | null;
  servicePeriod: ServicePeriodMode;
}

export type SevRecurringMapped =
  | {
      ok: true;
      template: SevRecurringTemplate;
      contactSevdeskId: string | null;
      /** Status der Vorlage in sevDesk: 50, 100, 1000 */
      sevStatus: string;
      billing: SevBilling;
      /** Anzahl der erzeugten Rechnungen, aus denen billing stammt */
      billingEvidence: number;
      /** Platzhalter von sevDesk wie [%KONTAKTPERSON%], in der Reihenfolge ihres ersten Vorkommens */
      placeholders: string[];
      /** Was beim Prüfen auffallen soll */
      hints: string[];
    }
  | { ok: false; reason: string };

const PLACEHOLDER = /\[%[^%\]\s]+%\]/g;

/** Alle Platzhalter von sevDesk in den Texten, jeder einmal. */
export function sevPlaceholders(texts: (string | null | undefined)[]): string[] {
  const found = new Set<string>();
  for (const text of texts) for (const match of (text ?? "").matchAll(PLACEHOLDER)) found.add(match[0]);
  return [...found];
}

/**
 * Intervall in Monaten aus der Angabe von sevDesk ("P0Y1M", "P1Y", "P0Y0M1W"); null bei Wochen, Tagen oder
 * einer unlesbaren Angabe. Belegt sind "P0Y1M" und "P0Y0M1W".
 */
export function sevIntervalMonths(value: string | null | undefined): number | null {
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/.exec((value ?? "").trim());
  if (!m || m[0] === "P") return null;
  if (Number(m[3] ?? 0) > 0 || Number(m[4] ?? 0) > 0) return null;
  const months = Number(m[1] ?? 0) * 12 + Number(m[2] ?? 0);
  return months > 0 ? months : null;
}

/**
 * Nachfällig oder vorschüssig, abgelesen an den Rechnungen, die per origin.id auf die Vorlage zeigen: Rechnungsdatum
 * gleich Ende des Leistungszeitraums heißt nachfällig, gleich Anfang vorschüssig. Ohne erzeugte Rechnung oder wenn sie
 * sich widersprechen, bleibt es unklar. Belegt nur für das Monatsintervall in Buchhaltungsversion 1.0.
 */
export function sevBilling(templateId: string, invoices: Iterable<SevInvoice>): { billing: SevBilling; evidence: number } {
  let after = 0;
  let before = 0;
  let other = 0;
  for (const invoice of invoices) {
    if (invoice.origin?.id == null || String(invoice.origin.id) !== templateId) continue;
    if ((invoice.invoiceType ?? "").toUpperCase() === "WKR") continue;
    const date = lexDate(invoice.invoiceDate);
    const from = lexDate(invoice.deliveryDate);
    const to = lexDate(invoice.deliveryDateUntil);
    if (!date || !from || !to || from === to) other += 1;
    else if (date === to) after += 1;
    else if (date === from) before += 1;
    else other += 1;
  }
  if (after > 0 && before === 0 && other === 0) return { billing: "nachfaellig", evidence: after };
  if (before > 0 && after === 0 && other === 0) return { billing: "vorschuessig", evidence: before };
  return { billing: "unklar", evidence: 0 };
}

const BLOCK_TAGS = /<\s*(?:br\s*\/?|\/p|\/div|\/li)\s*>/gi;
const INLINE_TAGS = /<\s*\/?\s*(?:p|div|span|strong|b|em|i|u|ul|ol|li|font)(?:\s[^>]*)?>/gi;
const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/**
 * Text eines Feldes von sevDesk als schlichter Text: Absätze und Zeilenumbrüche werden zu Zeilen, andere bekannte
 * Auszeichnungen fallen weg. Unbekanntes in spitzen Klammern bleibt stehen, Platzhalter ebenso.
 */
export function sevPlainText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(BLOCK_TAGS, "\n")
    .replace(INLINE_TAGS, "")
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]!)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function taxTreatmentOf(raw: SevInvoice): { treatment: TaxTreatment; hint: string | null } | null {
  if (sevNumber(raw.smallSettlement) === 1 || raw.taxType === "ss")
    return {
      treatment: "kleinunternehmer",
      hint: "Umsatzsteuer: in sevDesk Kleinunternehmer, als Kleinunternehmer übernommen. Prüfen.",
    };
  if (!raw.taxType || raw.taxType === "default") return { treatment: "regulaer", hint: null };
  if (raw.taxType === "eu")
    return {
      treatment: "ig_lieferung",
      hint: "Umsatzsteuer: in sevDesk Steuerart „eu“, als innergemeinschaftliche Lieferung übernommen. Prüfen.",
    };
  if (raw.taxType === "noteu")
    return {
      treatment: "drittland",
      hint: "Umsatzsteuer: in sevDesk Steuerart „noteu“, als Leistung ins Drittland übernommen. Prüfen.",
    };
  return null;
}

const lastDayOfMonth = (date: string) => {
  const [y, m] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
  return new Date(Date.UTC(y, m, 0)).getUTCDate() === Number(date.slice(8, 10));
};

const clip = (text: string, max: number, hints: string[], what: string) => {
  if (text.length <= max) return text;
  hints.push(`${what} war länger als ${max} Zeichen und ist gekürzt.`);
  return text.slice(0, max);
};

/**
 * Vorlage von sevDesk → Felder einer wiederkehrenden Rechnung von Haben. invoices sind alle Rechnungen aus GET /Invoice;
 * daraus stammt, ob nachfällig abgerechnet wird. ok: false nennt den Grund, warum Haben die Vorlage nicht abbilden kann.
 */
export function mapSevRecurringInvoice(raw: SevInvoice, positions: SevDocumentPos[], invoices: Iterable<SevInvoice>): SevRecurringMapped {
  const hints: string[] = [];
  const currency = (raw.currency ?? "EUR").toUpperCase();
  if (currency !== "EUR")
    return {
      ok: false,
      reason: `Währung ${currency}: Haben erzeugt wiederkehrende Rechnungen nur in Euro.`,
    };
  const intervalMonths = sevIntervalMonths(raw.accountIntervall);
  if (intervalMonths == null || ![1, 3, 6, 12].includes(intervalMonths))
    return {
      ok: false,
      reason: `Intervall „${raw.accountIntervall ?? ""}“: Haben kennt nur monatlich, vierteljährlich, halbjährlich und jährlich.`,
    };
  const tax = taxTreatmentOf(raw);
  if (!tax)
    return {
      ok: false,
      reason: `Steuerart „${raw.taxType ?? ""}“ ist nicht zugeordnet.`,
    };
  if (tax.hint) hints.push(tax.hint);
  // discount und discountTime am Kopf sind laut OpenAPI Skonto in Prozent und Tagen
  const skonto = raw as {
    discount?: string | number | null;
    discountTime?: string | number | null;
  };
  if (sevNumber(skonto.discount) !== 0) hints.push(`Skonto ${sevNumber(skonto.discount)} % in ${sevNumber(skonto.discountTime)} Tagen ist nicht übernommen.`);
  const nextDate = lexDate(raw.accountNextInvoice) ?? lexDate(raw.accountStartDate) ?? lexDate(raw.invoiceDate);
  if (!nextDate) return { ok: false, reason: "Kein nächster Termin und kein Startdatum." };
  if (!lexDate(raw.accountNextInvoice)) hints.push("Kein nächster Termin in sevDesk, „Nächste Rechnung am“ ist das Startdatum.");
  const priceMode = sevNumber(raw.showNet) === 0 && raw.showNet != null ? "brutto" : "netto";
  if (positions.length === 0) return { ok: false, reason: "Die Vorlage hat keine Positionen." };

  const lines: SevRecurringLine[] = [];
  for (const [i, p] of positions.entries()) {
    const taxRate = lexToBasisPoints(sevNumber(p.taxRate));
    if (!(TAX_RATES as readonly number[]).includes(taxRate))
      return {
        ok: false,
        reason: `Position ${i + 1}: Steuersatz ${sevNumber(p.taxRate)} % gibt es in Haben nicht.`,
      };
    if (sevNumber(p.discount) !== 0)
      return {
        ok: false,
        reason: `Position ${i + 1}: Rabatt, wiederkehrende Rechnungen in Haben kennen keine Rabatte.`,
      };
    const quantity = Math.round(sevNumber(p.quantity) * 1000);
    if (quantity < 1)
      return {
        ok: false,
        reason: `Position ${i + 1}: Menge ${sevNumber(p.quantity)} ist nicht übernehmbar.`,
      };
    const price = priceMode === "brutto" ? (p.priceGross ?? p.price) : (p.priceNet ?? p.price);
    let description = sevPlainText(p.name);
    if (!description) {
      description = "Position";
      hints.push(`Position ${i + 1} hat in sevDesk keine Bezeichnung.`);
    }
    lines.push({
      description: clip(description, 500, hints, `Bezeichnung der Position ${i + 1}`),
      detail: clip(sevPlainText(p.text), 2000, hints, `Text der Position ${i + 1}`),
      itemNumber: "",
      quantity,
      // sevDesk nennt die Einheit nur als ID (Unity); die Bezeichnung ist nicht abgerufen
      unit: "Stk.",
      unitPrice: lexToCents(sevNumber(price)),
      taxRate: taxRate as (typeof TAX_RATES)[number],
    });
  }
  hints.push("Einheiten sind als „Stk.“ übernommen; sevDesk nennt sie nur als Kennung.");

  const { billing, evidence } = sevBilling(String(raw.id), invoices);
  let servicePeriod: ServicePeriodMode = "keiner";
  let anchorDay = Number(nextDate.slice(8, 10));
  if (billing === "vorschuessig") servicePeriod = "laufend";
  else if (billing === "nachfaellig" && intervalMonths === 1) {
    // Rechnung am Ende des Monats, für diesen Monat; der Termin bleibt am Monatsende
    servicePeriod = "laufend";
    if (lastDayOfMonth(nextDate)) anchorDay = 31;
  } else if (billing === "nachfaellig")
    hints.push("Nachfällig über mehrere Monate kann Haben nicht abbilden: Leistungszeitraum ist „Keiner“. Bitte selbst setzen.");
  else
    hints.push("Ob sevDesk nachfällig oder vorschüssig abrechnet, ist ohne erzeugte Rechnung unklar. In sevDesk nachsehen und den Leistungszeitraum setzen.");

  if (raw.sepaMandateReference) hints.push("In sevDesk mit SEPA-Mandat; Zahlungsart ist Überweisung. Bitte prüfen.");

  const name = sevPlainText(raw.header) || "Wiederkehrende Rechnung aus sevDesk";
  const template: SevRecurringTemplate = {
    name: clip(name, 200, hints, "Bezeichnung"),
    intro: clip(sevPlainText(raw.headText), 2000, hints, "Einleitung"),
    note: clip(sevPlainText(raw.footText), 2000, hints, "Hinweis"),
    paymentTermDays: Math.min(120, Math.max(0, Math.round(sevNumber(raw.timeToPay)))),
    taxTreatment: tax.treatment,
    priceMode,
    lines,
    intervalMonths: intervalMonths as RecurringInterval,
    anchorDay,
    nextDate,
    endDate: lexDate(raw.accountEndDate),
    servicePeriod,
  };
  const placeholders = sevPlaceholders([raw.header, raw.headText, raw.footText, ...positions.flatMap((p) => [p.name, p.text])]);
  return {
    ok: true,
    template,
    contactSevdeskId: raw.contact?.id == null ? null : String(raw.contact.id),
    sevStatus: String(raw.status ?? ""),
    billing,
    billingEvidence: evidence,
    placeholders,
    hints,
  };
}
