import {
  addDays,
  formatEuro,
  invoicePosting,
  leistungsdatum,
  outgoingTaxIssues,
  TAX_TREATMENT_KEYS,
  TAX_TREATMENTS,
  treatmentIssues,
  type TaxTreatment,
} from "@haben/core";
import { readEInvoice, type IncomingInvoice } from "@haben/einvoice";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import { loadCompany, sellerIssues, type Company, type Contact } from "../stammdaten/index.ts";
import { isUniqueViolation } from "../../errors.ts";
import { openBooks, post } from "../buchhaltung/index.ts";
import { sha256 } from "./invoices.ts";
import { versteuerungIssues } from "./versteuerung-pruefung.ts";
import { invoicePostingMode, invoiceVatDate } from "./invoice-tax.ts";
import { InvoiceError } from "./invoice-error.ts";
import { pruefeUmsatzgrenze } from "./umsatzgrenze.ts";
import { rebuildInvoiceLines } from "./positionen-nachbilden.ts";
import { createTakenOverInvoice } from "./rechnung-uebernehmen.ts";

/*
 * Ausgangsrechnung aus einem Fremdsystem übernehmen (#660): Die Rechnung ist dort geschrieben und verschickt worden und
 * behält Nummer, Datum und PDF. In Haben wird sie wie eine festgeschriebene eigene Rechnung gebucht (Forderung an Erlöse und
 * Umsatzsteuer, bei Ist-Versteuerung auf „nicht fällig“) und läuft danach durch Bankabgleich, Mahnung und Storno wie jede
 * andere. Der eigene Nummernkreis bleibt unberührt; das PDF ist das Original und wird nicht neu erzeugt.
 * Anders als die Übernahme beim Umzug (archiv/legacy-open.ts) gibt es keinen Stichtag und keine Eröffnungsbuchung.
 *
 * Quellen: Entstehung der Steuer nach § 13 Abs. 1 Nr. 1 Buchst. a (Soll, mit Ablauf des Voranmeldungszeitraums der Leistung)
 * und Buchst. b (Ist, mit der Vereinnahmung) UStG, Pflichtangaben und Steuerbefreiung nach § 14 Abs. 4 UStG,
 * Aufbewahrung der Rechnung in der Form, in der sie ausgestellt wurde, nach § 14b UStG und § 147 AO (GoBD Rn. 130 ff.).
 * Steuerkategorien der E-Rechnung: EN 16931, Codeliste UNCL 5305 (S, Z, E, AE, K, G, O), Befreiungsgrund BT-120.
 * https://www.gesetze-im-internet.de/ustg_1980/__13.html, https://www.gesetze-im-internet.de/ustg_1980/__14b.html
 */

/** Herkunft der übernommenen Rechnungen in der externen Referenz (zusammen mit der Nummer eindeutig) */
const SOURCE = "fremdsystem";

/** Nur Rechnungen: Gutschriften sind in Haben keine Rechnung, negative Beträge also ausgeschlossen */
const cents = z.number().int().min(0).max(2_147_483_647);

export const foreignInvoiceSchema = z.object({
  /** Nummer aus dem Fremdsystem; sie bleibt unverändert */
  number: z
    .string()
    .trim()
    .min(1, "Rechnungsnummer fehlt")
    .max(100)
    .regex(/^[^\p{Cc}/\x5c]+$/u, "Rechnungsnummer ohne Steuerzeichen, Schrägstrich und Rückstrich"),
  issueDate: z.iso.date(),
  dueDate: z.iso.date(),
  serviceFrom: z.iso.date().nullable().default(null),
  serviceTo: z.iso.date().nullable().default(null),
  contactId: z.uuid(),
  taxTreatment: z.enum(TAX_TREATMENT_KEYS).default("regulaer"),
  /** Befreiungsvorschrift wie auf der Rechnung, z. B. „Steuerfrei nach § 4 Nr. 14 UStG“; bei steuerfreien Umsätzen Pflicht */
  exemptionReason: z.string().trim().max(500).default(""),
  /** Netto und Steuer je Steuersatz (Basispunkte), wie auf der Rechnung ausgewiesen */
  taxes: z
    .array(z.strictObject({ rate: z.number().int().min(0).max(10_000), net: cents, tax: cents }))
    .min(1)
    .max(20),
  /** Bestätigung der Umsatzgrenze wie beim Festschreiben: gilt nur für die Werte, die Haben zuvor gemeldet hat */
  bestaetigt: z.strictObject({ umsatz: cents, rechnung: cents, grenze: cents, vorjahresumsatz: cents.optional() }).optional(),
});

export type ForeignInvoiceInput = z.input<typeof foreignInvoiceSchema>;

const RATES = new Set([0, 700, 1900]);

/** Zeilen mit demselben Satz zählen als einer: Eine E-Rechnung kann zwei 0-%-Kategorien (etwa E und Z) nennen, gebucht wird je Satz */
function groupByRate(taxes: { rate: number; net: number; tax: number }[]): { rate: number; net: number; tax: number }[] {
  const sums = new Map<number, { rate: number; net: number; tax: number }>();
  for (const t of taxes) {
    const sum = sums.get(t.rate) ?? { rate: t.rate, net: 0, tax: 0 };
    sums.set(t.rate, { rate: t.rate, net: sum.net + t.net, tax: sum.tax + t.tax });
  }
  return [...sums.values()];
}

/** Je Steuersatz, nicht nur in der Summe: +1 Cent bei 19 % und −1 Cent bei 7 % verschöbe sonst die Kennzahlen der Voranmeldung */
function rebuild(taxes: { rate: number; net: number; tax: number }[], number: string) {
  const result = rebuildInvoiceLines(
    taxes,
    (rate, mehrere) => `Rechnung ${number}${mehrere ? ` (${rate / 100} %)` : ""}`,
    (totals) => taxes.every((t) => totals.taxes.some((x) => x.rate === t.rate && x.base === t.net && x.tax === t.tax)) && totals.taxes.length === taxes.length,
  );
  if (result.ok) return result;
  throw new InvoiceError(
    `Die Steuer lässt sich nicht centgenau nachbilden (Rechnung ${formatEuro(taxes.reduce((n, t) => n + t.tax, 0))}, Haben ${formatEuro(result.netTax)}). Netto und Steuer je Satz bitte wie auf der Rechnung eintragen.`,
  );
}

function looksLikePdf(bytes: Uint8Array): boolean {
  return new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF-");
}

type AdoptInput = z.output<typeof foreignInvoiceSchema>;

/** Was gegen die Übernahme spricht: Firmendaten, Versteuerung, Steuerbehandlung, Umsatzgrenze */
async function assertAdoptable(
  tx: Tx,
  company: Company,
  contact: Contact,
  input: AdoptInput,
  totals: { net: number; taxes: { rate: number }[] },
): Promise<void> {
  const issues = [
    ...sellerIssues(company, true).map((issue) => `Firmendaten: ${issue}`),
    ...(await versteuerungIssues(company, input.issueDate, tx)),
    ...outgoingTaxIssues(input.taxTreatment, null, company.kleinunternehmer),
    ...treatmentIssues(input.taxTreatment, {
      rates: totals.taxes.map((t) => t.rate),
      sellerUstId: company.ustId,
      buyerUstId: contact.ustId,
      buyerCountry: contact.land,
      exemptionReason: input.exemptionReason,
    }),
  ];
  if (issues.length > 0) throw new InvoiceError(`Noch nicht bereit: ${issues.join(", ")}.`);
  await pruefeUmsatzgrenze(
    tx,
    { kind: "rechnung", issueDate: input.issueDate, taxTreatment: input.taxTreatment },
    totals.net,
    company.foundedOn,
    input.bestaetigt,
  );
}

/**
 * Legt die Rechnung festgeschrieben an und bucht sie wie beim Festschreiben einer eigenen Rechnung.
 * Mit `xml` (eingebettetes ZUGFeRD oder XRechnung des Originals) bleibt auch die maschinenlesbare Fassung erhalten.
 */
export async function adoptForeignInvoice(actor: string, raw: ForeignInvoiceInput, pdf: Uint8Array, xml: string | null = null): Promise<{ id: string }> {
  const input = foreignInvoiceSchema.parse(raw);
  if (!looksLikePdf(pdf)) throw new InvoiceError("Das Original muss ein PDF sein.");
  if (input.dueDate < input.issueDate) throw new InvoiceError("Das Fälligkeitsdatum liegt vor dem Rechnungsdatum.");
  if (Date.parse(input.dueDate) - Date.parse(input.issueDate) > 365 * 86_400_000) throw new InvoiceError("Das Zahlungsziel darf höchstens 365 Tage betragen.");
  if (input.taxes.some((t) => !RATES.has(t.rate))) throw new InvoiceError("Haben kennt für Rechnungen nur die Steuersätze 0 %, 7 % und 19 %.");
  if (input.serviceFrom && input.serviceTo && input.serviceFrom > input.serviceTo) throw new InvoiceError("Der Leistungszeitraum endet vor seinem Beginn.");
  if (new Set(input.taxes.map((t) => t.rate)).size !== input.taxes.length)
    throw new InvoiceError("Jeder Steuersatz darf nur einmal vorkommen; Zeilen mit demselben Satz bitte zusammenrechnen.");
  const { priceMode, totals, lines } = rebuild(input.taxes, input.number);
  // Wie beim Festschreiben: eine Rechnung über 0 € gibt es nicht (und die Buchung wäre leer)
  if (totals.gross <= 0) throw new InvoiceError("Der Gesamtbetrag muss größer als 0 sein.");

  try {
    return await withActor(actor, async (tx) => {
      const company = await openBooks(tx);
      const [contact] = await tx.select().from(schema.contacts).where(eq(schema.contacts.id, input.contactId));
      if (!contact) throw new InvoiceError("Der Kunde fehlt.");
      await assertAdoptable(tx, company, contact, input, totals);

      const invoice = await createTakenOverInvoice(tx, {
        company,
        contact,
        number: input.number,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        paymentTermDays: Math.round((Date.parse(input.dueDate) - Date.parse(input.issueDate)) / 86_400_000),
        serviceFrom: input.serviceFrom,
        serviceTo: input.serviceTo,
        serviceDate: leistungsdatum({ belegdatum: input.issueDate, leistungVon: input.serviceFrom, leistungBis: input.serviceTo }),
        taxTreatment: input.taxTreatment,
        exemptionReason: input.exemptionReason,
        note: "Aus dem Fremdsystem übernommen; das PDF ist das Original.",
        priceMode,
        totals,
        lines,
        pdf,
        pdfSha256: sha256(pdf),
        xml,
        origin: { externalSource: SOURCE, externalId: input.number },
      });
      const id = invoice.id;

      await post(tx, company, {
        date: await invoiceVatDate(invoice, tx),
        description: `Rechnung ${input.number} aus dem Fremdsystem · ${contact.name}`,
        sourceType: "invoice",
        sourceId: id,
        lines: invoicePosting(totals, company.kontenrahmen, await invoicePostingMode(invoice, tx), input.taxTreatment),
      });
      return { id };
    });
  } catch (error) {
    if (isUniqueViolation(error, "invoices_external_ref") || isUniqueViolation(error, "invoices_number_unique"))
      throw new InvoiceError(`Die Rechnung ${input.number} gibt es in Haben schon.`);
    throw error;
  }
}

/**
 * Anzahlungsrechnung (UNTDID 1001 Code 386): Bei Soll entsteht die Steuer mit der Vereinnahmung (§ 13 Abs. 1 Nr. 1 Buchst. a
 * Satz 4 UStG), nicht mit der Leistung; als Rechnung gebucht stünde sie zu früh in der Voranmeldung.
 */
const PREPAYMENT = "386";
const PREPAYMENT_TEXT = "Das ist eine Anzahlungsrechnung; Haben übernimmt hier nur Rechnungen über erbrachte Leistungen.";

/** Steuerkategorie der E-Rechnung (UNCL 5305) und die Behandlung, die Haben dafür vorschlägt; der Nutzer bestätigt sie */
const TREATMENT_OF_CATEGORY: Record<string, TaxTreatment> = { AE: "reverse_charge", K: "ig_lieferung", G: "ausfuhr", E: "steuerfrei", O: "drittland" };

export interface ForeignInvoiceProposal {
  /** Woher die Werte stammen: eingebettetes ZUGFeRD, XRechnung oder gar nicht (dann tippt der Nutzer sie ein) */
  from: "zugferd" | "xrechnung" | null;
  number: string;
  issueDate: string;
  dueDate: string;
  serviceFrom: string | null;
  serviceTo: string | null;
  taxTreatment: TaxTreatment;
  taxes: { rate: number; net: number; tax: number }[];
  /** Kunde in Haben, wenn USt-IdNr. oder Name der Rechnung zu genau einem Kontakt passen */
  contactId: string | null;
  buyerName: string | null;
  /** Hinweise zum Prüfen, etwa dass der Verkäufer nicht die eigene Firma ist */
  warnings: string[];
}

/** Liest, was die Datei selbst über die Rechnung sagt; ohne E-Rechnung bleibt der Vorschlag leer */
export async function foreignInvoiceProposal(file: { bytes: Uint8Array; filename: string; mimeType: string }): Promise<ForeignInvoiceProposal> {
  const empty: ForeignInvoiceProposal = {
    from: null,
    number: "",
    issueDate: "",
    dueDate: "",
    serviceFrom: null,
    serviceTo: null,
    taxTreatment: "regulaer",
    taxes: [],
    contactId: null,
    buyerName: null,
    warnings: [],
  };
  let read: Awaited<ReturnType<typeof readEInvoice>> = null;
  try {
    read = await readEInvoice(file);
  } catch {
    return { ...empty, warnings: ["Die E-Rechnung in der Datei lässt sich nicht lesen; die Angaben bitte von Hand eintragen."] };
  }
  if (!read) return { ...empty, warnings: ["Die Datei enthält keine E-Rechnung; die Angaben bitte von Hand eintragen."] };
  const { invoice, source } = read;
  const warnings: string[] = [];
  const company = await loadCompany();
  const sellerUst = invoice.seller.ustId?.replace(/\s/g, "").toUpperCase();
  if (sellerUst && company.ustId && sellerUst !== company.ustId.replace(/\s/g, "").toUpperCase())
    warnings.push(`Die Rechnung nennt die USt-IdNr. ${sellerUst}, in den Firmendaten steht eine andere. Ist es wirklich deine Rechnung?`);
  if (invoice.isCreditNote) warnings.push("Das ist eine Gutschrift; Haben übernimmt hier nur Rechnungen.");
  if (invoice.currency !== "EUR") warnings.push(`Die Rechnung lautet auf ${invoice.currency}; Haben übernimmt hier nur Rechnungen in Euro.`);
  if (invoice.typeCode === PREPAYMENT) warnings.push(PREPAYMENT_TEXT);
  const taxes = groupByRate(invoice.taxes.map((t) => ({ rate: t.rate, net: t.base, tax: t.tax })));
  const special = invoice.taxes.map((t) => TREATMENT_OF_CATEGORY[t.category]).find((t) => t !== undefined);
  const buyerUst = invoice.buyer?.ustId?.replace(/\s/g, "").toUpperCase();
  const buyerName = invoice.buyer?.name?.trim() ?? null;
  const contacts = await db.select({ id: schema.contacts.id, name: schema.contacts.name, ustId: schema.contacts.ustId }).from(schema.contacts);
  const matches = contacts.filter((c) =>
    buyerUst ? c.ustId.replace(/\s/g, "").toUpperCase() === buyerUst : buyerName ? c.name.trim().toLowerCase() === buyerName.toLowerCase() : false,
  );
  return {
    from: source,
    number: invoice.number,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate ?? addDays(invoice.issueDate, 14),
    serviceFrom: invoice.serviceFrom ?? null,
    serviceTo: invoice.serviceTo ?? null,
    // Ein Kleinunternehmer übernimmt nur Rechnungen nach § 19 UStG (andere Behandlungen braucht strukturierte Angaben, die das Formular nicht abfragt)
    taxTreatment: company.kleinunternehmer ? "kleinunternehmer" : (special ?? "regulaer"),
    taxes,
    contactId: matches.length === 1 ? matches[0]!.id : null,
    buyerName,
    warnings,
  };
}

/** Wie adoptForeignInvoice, mit der E-Rechnung aus der Datei, falls sie eine enthält und lesbar ist */
export async function adoptForeignInvoiceFile(actor: string, raw: ForeignInvoiceInput, file: { bytes: Uint8Array; filename: string; mimeType: string }) {
  const read = await readEInvoice(file).catch(() => null);
  if (read) {
    // Nur Rechnungen in Euro: Gutschrift und Fremdwährung warnt schon der Vorschlag, hier wird sie abgelehnt
    if (read.invoice.isCreditNote) throw new InvoiceError("Die E-Rechnung in der Datei ist eine Gutschrift; Haben übernimmt hier nur Rechnungen.");
    if (read.invoice.currency !== "EUR")
      throw new InvoiceError(`Die E-Rechnung in der Datei lautet auf ${read.invoice.currency}; Haben übernimmt hier nur Rechnungen in Euro.`);
    if (read.invoice.typeCode === PREPAYMENT) throw new InvoiceError(PREPAYMENT_TEXT);
    const problem = xmlMismatch(read.invoice, foreignInvoiceSchema.parse(raw));
    if (problem) throw new InvoiceError(`Die E-Rechnung in der Datei passt nicht zu den Angaben: ${problem}. Das Original wird so nicht übernommen.`);
  }
  return adoptForeignInvoice(actor, raw, file.bytes, read?.xml ?? null);
}

/** Was an der eingebetteten E-Rechnung von den bestätigten Angaben abweicht, oder null; das XML wird mit der Rechnung archiviert und weitergegeben */
function xmlMismatch(invoice: IncomingInvoice, input: AdoptInput): string | null {
  if (invoice.number !== input.number) return `Nummer ${invoice.number} statt ${input.number}`;
  if (invoice.issueDate !== input.issueDate) return `Rechnungsdatum ${invoice.issueDate} statt ${input.issueDate}`;
  const given = groupByRate(input.taxes);
  const same = (x: { rate: number; net: number; tax: number }) => given.some((t) => t.rate === x.rate && t.net === x.net && t.tax === x.tax);
  const xmlTaxes = groupByRate(invoice.taxes.map((t) => ({ rate: t.rate, net: t.base, tax: t.tax })));
  if (xmlTaxes.length !== given.length || !xmlTaxes.every(same)) return "Netto oder Steuer je Steuersatz weichen ab";
  const category = invoice.taxes.map((t) => t.category).find((c) => !TREATMENTS_OF_CATEGORY[c]?.includes(input.taxTreatment));
  if (category !== undefined) return `Steuerkategorie ${category} statt ${TAX_TREATMENTS[input.taxTreatment].label}`;
  return null;
}

/**
 * Welche Behandlungen zur Steuerkategorie einer Zeile passen (EN 16931, UNCL 5305): S und Z sind regulär, E steuerfrei
 * oder § 19 UStG. Eine Rechnung mit S und E zugleich passt so zu keiner Behandlung; regulär zu 0 % gebucht stünde der
 * steuerfreie Teil in keiner Kennzahl statt in Kz 48 (§ 4 Nr. 8 bis 29 UStG). Andere Kategorien (L, M, B) bildet Haben nicht ab.
 * § 19 UStG: EN 16931 (UNCL 5305) sieht E vor, manche Erzeuger schreiben O; beides gilt als Kleinunternehmer.
 */
const TREATMENTS_OF_CATEGORY: Record<string, readonly TaxTreatment[]> = {
  S: ["regulaer"],
  Z: ["regulaer"],
  E: ["steuerfrei", "kleinunternehmer"],
  AE: ["reverse_charge"],
  K: ["ig_lieferung"],
  G: ["ausfuhr"],
  O: ["drittland", "eu_sonstige", "kleinunternehmer"],
};
