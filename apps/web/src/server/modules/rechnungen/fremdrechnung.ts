import {
  addDays,
  computeInvoice,
  invoicePosting,
  leistungsdatum,
  outgoingTaxIssues,
  TAX_TREATMENT_KEYS,
  treatmentIssues,
  type PriceMode,
  type TaxTreatment,
} from "@haben/core";
import { readEInvoice } from "@haben/einvoice";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import { loadCompany, type Company, type Contact } from "../stammdaten/index.ts";
import { isUniqueViolation } from "../../errors.ts";
import { openBooks, post } from "../buchhaltung/index.ts";
import { buyerFrom, sellerFrom } from "./invoices.ts";
import { invoicePostingMode, invoiceVatDate } from "./invoice-tax.ts";
import { storeInvoiceTaxes } from "./invoice-taxes.ts";
import { InvoiceError } from "./invoice-error.ts";
import { outgoingTaxDetailsSchema } from "./tax-details.ts";

/*
 * Ausgangsrechnung aus einem Fremdsystem übernehmen (#660): Die Rechnung ist dort geschrieben und verschickt worden und
 * behält Nummer, Datum und PDF. In Haben wird sie wie eine festgeschriebene eigene Rechnung gebucht (Forderung an Erlöse und
 * Umsatzsteuer, bei Ist-Versteuerung auf „nicht fällig“) und läuft danach durch Bankabgleich, Mahnung und Storno wie jede
 * andere. Der eigene Nummernkreis bleibt unberührt; das PDF ist das Original und wird nicht neu erzeugt.
 * Anders als die Übernahme beim Umzug (archiv/legacy-open.ts) gibt es keinen Stichtag und keine Eröffnungsbuchung.
 */

/** Plattformkennung wie bei der externen Referenz eines Entwurfs: Kleinbuchstaben, Ziffern, Punkt, Bindestrich, Unterstrich */
const sourceSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Quelle in Kleinbuchstaben, Ziffern, Punkt, Bindestrich oder Unterstrich");

const cents = z.number().int().min(-2_147_483_647).max(2_147_483_647);

export const foreignInvoiceSchema = z.object({
  /** Nummer aus dem Fremdsystem; sie bleibt unverändert */
  number: z.string().trim().min(1, "Rechnungsnummer fehlt").max(100),
  issueDate: z.iso.date(),
  dueDate: z.iso.date(),
  serviceFrom: z.iso.date().nullable().default(null),
  serviceTo: z.iso.date().nullable().default(null),
  contactId: z.uuid(),
  /** Woher die Rechnung kommt; mit der Nummer zusammen eindeutig, damit sie nicht zweimal übernommen wird */
  source: sourceSchema.default("fremdsystem"),
  taxTreatment: z.enum(TAX_TREATMENT_KEYS).default("regulaer"),
  taxDetails: outgoingTaxDetailsSchema.nullable().default(null),
  /** Befreiungsvorschrift wie auf der Rechnung, z. B. „Steuerfrei nach § 4 Nr. 14 UStG“; bei steuerfreien Umsätzen Pflicht */
  exemptionReason: z.string().trim().max(500).default(""),
  /** Netto und Steuer je Steuersatz (Basispunkte), wie auf der Rechnung ausgewiesen */
  taxes: z
    .array(z.strictObject({ rate: z.number().int().min(0).max(10_000), net: cents, tax: cents }))
    .min(1)
    .max(20),
});

export type ForeignInvoiceInput = z.input<typeof foreignInvoiceSchema>;

const RATES = new Set([0, 700, 1900]);

/** Eine Position je Steuersatz; erst netto nachbilden, sonst brutto, damit Steuer und Brutto centgenau zur Rechnung passen */
function rebuild(taxes: { rate: number; net: number; tax: number }[], number: string) {
  const attempt = (priceMode: PriceMode) => {
    const lines = taxes.map((t, i) => ({
      position: i + 1,
      description: `Rechnung ${number}${taxes.length > 1 ? ` (${t.rate / 100} %)` : ""}`,
      quantity: 1000,
      unit: "Psch." as const,
      unitPrice: priceMode === "brutto" ? t.net + t.tax : t.net,
      taxRate: t.rate as 1900 | 700 | 0,
    }));
    const { totals, lineNets } = computeInvoice(lines, priceMode);
    return { priceMode, totals, lines: lines.map((l, i) => ({ ...l, net: lineNets[i]! })) };
  };
  const expected = {
    net: taxes.reduce((n, t) => n + t.net, 0),
    tax: taxes.reduce((n, t) => n + t.tax, 0),
  };
  const matches = (r: ReturnType<typeof attempt>) => r.totals.net === expected.net && r.totals.tax === expected.tax;
  const net = attempt("netto");
  if (matches(net)) return net;
  const gross = attempt("brutto");
  if (matches(gross)) return gross;
  throw new InvoiceError(`Die Steuer lässt sich nicht centgenau nachbilden (Rechnung ${expected.tax / 100} €, Haben ${net.totals.tax / 100} €).`);
}

function looksLikePdf(bytes: Uint8Array): boolean {
  return new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF-");
}

type AdoptInput = z.output<typeof foreignInvoiceSchema>;

/** Was gegen die Übernahme spricht: Nummer oder Vorgang schon da, Steuerbehandlung passt nicht zu Kunde und Firma */
async function assertAdoptable(tx: Tx, company: Company, contact: Contact, input: AdoptInput, rates: number[]): Promise<void> {
  const [clash] = await tx.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.number, input.number));
  if (clash) throw new InvoiceError(`Die Rechnungsnummer ${input.number} gibt es in Haben schon.`);
  const [same] = await tx
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.externalSource, input.source), eq(schema.invoices.externalId, input.number)));
  if (same) throw new InvoiceError(`Die Rechnung ${input.number} aus ${input.source} ist schon übernommen.`);
  const issues = [
    ...outgoingTaxIssues(input.taxTreatment, input.taxDetails, company.kleinunternehmer),
    ...treatmentIssues(input.taxTreatment, {
      rates,
      sellerUstId: company.ustId,
      buyerUstId: contact.ustId,
      buyerCountry: contact.land,
      exemptionReason: input.exemptionReason,
    }),
  ];
  if (issues.length > 0) throw new InvoiceError(`Noch nicht bereit: ${issues.join(", ")}.`);
}

/**
 * Legt die Rechnung festgeschrieben an und bucht sie wie beim Festschreiben einer eigenen Rechnung.
 * Mit `xml` (eingebettetes ZUGFeRD oder XRechnung des Originals) bleibt auch die maschinenlesbare Fassung erhalten.
 */
export async function adoptForeignInvoice(actor: string, raw: ForeignInvoiceInput, pdf: Uint8Array, xml: string | null = null): Promise<{ id: string }> {
  const input = foreignInvoiceSchema.parse(raw);
  if (!looksLikePdf(pdf)) throw new InvoiceError("Das Original muss ein PDF sein.");
  if (input.dueDate < input.issueDate) throw new InvoiceError("Das Fälligkeitsdatum liegt vor dem Rechnungsdatum.");
  if (input.taxes.some((t) => !RATES.has(t.rate))) throw new InvoiceError("Haben kennt für Rechnungen nur die Steuersätze 0 %, 7 % und 19 %.");
  const { priceMode, totals, lines } = rebuild(input.taxes, input.number);

  try {
    return await withActor(actor, async (tx) => {
      const company = await openBooks(tx);
      const [contact] = await tx.select().from(schema.contacts).where(eq(schema.contacts.id, input.contactId));
      if (!contact) throw new InvoiceError("Der Kunde fehlt.");
      await assertAdoptable(
        tx,
        company,
        contact,
        input,
        totals.taxes.map((t) => t.rate),
      );

      const term = Math.max(0, Math.min(365, Math.round((Date.parse(input.dueDate) - Date.parse(input.issueDate)) / 86_400_000)));
      const serviceDate = leistungsdatum({ belegdatum: input.issueDate, leistungVon: input.serviceFrom, leistungBis: input.serviceTo });
      const [draft] = await tx
        .insert(schema.invoices)
        .values({
          kind: "rechnung",
          contactId: contact.id,
          issueDate: input.issueDate,
          serviceFrom: input.serviceFrom,
          serviceTo: input.serviceTo,
          paymentTermDays: term,
          dueDate: input.dueDate,
          note: `Aus ${input.source} übernommen; das PDF ist das Original.`,
          priceMode,
          taxTreatment: input.taxTreatment,
          taxDetails: input.taxDetails,
          exemptionReason: input.exemptionReason,
          net: totals.net,
          tax: totals.tax,
          gross: totals.gross,
        })
        .returning({ id: schema.invoices.id });
      const id = draft!.id;
      await tx.insert(schema.invoiceLines).values(lines.map((l) => ({ ...l, invoiceId: id })));
      await storeInvoiceTaxes(tx, id, totals.taxes);
      const now = new Date();
      const [invoice] = await tx
        .update(schema.invoices)
        .set({
          status: "final",
          number: input.number,
          externalSource: input.source,
          externalId: input.number,
          contactVersion: contact.version,
          seller: sellerFrom(company),
          buyer: buyerFrom(contact),
          serviceDate,
          pdf: Buffer.from(pdf),
          pdfSha256: createHash("sha256").update(pdf).digest("hex"),
          xml,
          xmlSha256: xml ? createHash("sha256").update(xml).digest("hex") : null,
          lockedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.invoices.id, id))
        .returning();

      await post(tx, company, {
        date: await invoiceVatDate(invoice!, tx),
        description: `Rechnung ${input.number} aus ${input.source} · ${contact.name}`,
        sourceType: "invoice",
        sourceId: id,
        lines: invoicePosting(totals, company.kontenrahmen, await invoicePostingMode(invoice!, tx), input.taxTreatment),
      });
      return { id };
    });
  } catch (error) {
    if (isUniqueViolation(error, "invoices_external_ref") || isUniqueViolation(error, "invoices_number_unique"))
      throw new InvoiceError(`Die Rechnung ${input.number} gibt es in Haben schon.`);
    throw error;
  }
}

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
  const taxes = invoice.taxes.map((t) => ({ rate: t.rate, net: t.base, tax: t.tax }));
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
    taxTreatment: special === "steuerfrei" && company.kleinunternehmer ? "kleinunternehmer" : (special ?? "regulaer"),
    taxes,
    contactId: matches.length === 1 ? matches[0]!.id : null,
    buyerName,
    warnings,
  };
}

/** Wie adoptForeignInvoice, mit der E-Rechnung aus der Datei, falls sie eine enthält und lesbar ist */
export async function adoptForeignInvoiceFile(actor: string, raw: ForeignInvoiceInput, file: { bytes: Uint8Array; filename: string; mimeType: string }) {
  const xml = (await readEInvoice(file).catch(() => null))?.xml ?? null;
  return adoptForeignInvoice(actor, raw, file.bytes, xml);
}
