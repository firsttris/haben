import { DEFAULT_OPTIONS, dunningAmounts, type LetterheadOptions, orderRateAmounts, planSchedule } from "@haben/core";
import { dunningPdfData } from "./dunning.ts";
import { TEXTS } from "./i18n.ts";
import { confirmationPdfData, deliveryNotePdfData } from "./order.ts";
import { asDraft, pdfData, templateInputs } from "./pdf.ts";
import { quotePdfData } from "./quote.ts";
import { gmbhSeller, sampleBuyer, sampleDocument, sampleSeller } from "./samples.ts";
import type { Letterhead } from "./types.ts";

/*
 * Beispieldaten für Belegvorlagen: decken jedes Feld des Feldvertrags ab (layout-schema.test.ts), dienen beim Hochladen
 * eines eigenen Layouts als Probe und lassen sich herunterladen. Nur Testdaten, keine echten Firmen.
 */

export interface LayoutBeispiel {
  name: string;
  art: "beleg" | "mahnung";
  data: object;
  /** Nur Rechnungen: Steuernummer und USt-IdNr. des Ausstellers, eine davon muss auf dem Blatt stehen (§ 14 Abs. 4 Nr. 2 UStG) */
  steuer?: string[];
}

/** Ein weißes Pixel als PNG: steht für Logo und Briefpapier, wenn die Beispiele gesetzt werden */
export const BEISPIEL_PNG = new Uint8Array(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64"),
);

const optionen = (mehr: Partial<LetterheadOptions> = {}): LetterheadOptions => ({ ...DEFAULT_OPTIONS, ...mehr });

/** Mit Logo und Briefpapier, damit beide Dateinamen in den Daten stehen; die Bytes liefert erst der Aufrufer */
const briefkopf = (mehr: Partial<LetterheadOptions> = {}): Letterhead => ({
  logo: { data: BEISPIEL_PNG, format: "png" },
  background: { data: BEISPIEL_PNG, format: "png" },
  accent: "#1F6F5C",
  options: optionen(mehr),
});

const viele = Array.from({ length: 40 }, (_, i) => ({
  description: `Leistung ${i + 1}`,
  quantity: 1000,
  unit: "Std." as const,
  unitPrice: 9500,
  taxRate: (i % 4 === 0 ? 700 : 1900) as 700 | 1900,
}));

export function layoutBeispiele(): LayoutBeispiel[] {
  const kopf = briefkopf({ footerColumns: ["*{firma}*\n{strasse}", "{steuernummer}"] });
  const rechnung = {
    ...sampleDocument({ intro: "Vielen *Dank* für Ihren Auftrag.", note: "Bitte _pünktlich_ zahlen." }),
    seller: gmbhSeller,
    skonto: [{ days: 7, percent: 200 }],
    lines: sampleDocument({}).lines.map((line, i) =>
      i === 0 ? { ...line, itemNumber: "ET-1042", detail: "Konzeption und *Umsetzung*" } : { ...line, discount: { kind: "prozent" as const, value: 1000 } },
    ),
    ...kopf,
  };
  const brutto = { ...sampleDocument({ priceMode: "brutto", discount: { kind: "prozent", value: 1000 }, lines: viele }), ...briefkopf() };
  const fremd = {
    ...sampleDocument({}),
    currency: "USD",
    euroTax: { tax: 1757, taxes: [{ rate: 1900, tax: 1757 }], rate: "1 EUR = 1,0812 USD (USt-Umrechnungskurs 09/2026)" },
  };
  const klein = sampleDocument({ taxTreatment: "kleinunternehmer" });
  const storno = sampleDocument({ kind: "storno" });
  const totals = sampleDocument({}).totals;
  const angebot = {
    ...sampleDocument({}),
    validUntil: "2026-11-30",
    lines: sampleDocument({}).lines.map((line, i) => (i === 1 ? { ...line, kind: "optional" as const } : line)),
    paymentPlan: planSchedule([{ label: "Anzahlung", share: { kind: "rest" }, due: "Bei Auftrag" }], orderRateAmounts(totals, "netto"), "netto"),
    ...kopf,
  };
  const lieferschein = {
    reference: { kind: "rechnung" as const, number: "2026-034", issueDate: "2026-10-02" },
    deliveryDate: "2026-10-01",
    date: "2026-10-01",
    seller: sampleSeller,
    buyer: sampleBuyer,
    lines: sampleDocument({}).lines,
    note: "Ware *geprüft*",
    ...briefkopf(),
  };
  const mahnung = {
    level: 2 as const,
    date: "2026-10-16",
    dueDate: "2026-10-26",
    seller: gmbhSeller,
    buyer: sampleBuyer,
    invoice: { number: "2026-034", issueDate: "2026-09-02", dueDate: "2026-09-16" },
    amounts: dunningAmounts({ open: 1_740_958, dueDate: "2026-09-16", date: "2026-10-16", fee: 5_000, flatFee: true, interestRate: 1_027 }),
    intro: "leider haben wir *keinen* Zahlungseingang erhalten.",
    closing: "Sollten Sie bereits gezahlt haben, ist dieses Schreiben gegenstandslos.",
    ...briefkopf(),
  };
  const beleg = (name: string, data: object, lh: Letterhead = {}): LayoutBeispiel => ({ name, art: "beleg", data: templateInputs(data, lh) });
  const steuer = { steuer: [sampleSeller.steuernummer, sampleSeller.ustId].filter((x): x is string => Boolean(x)) };
  const rechnungBeleg = (name: string, data: object, lh: Letterhead = {}): LayoutBeispiel => ({ ...beleg(name, data, lh), ...steuer });
  return [
    rechnungBeleg("Rechnung", pdfData(rechnung), kopf),
    rechnungBeleg("Rechnung als Entwurf", asDraft(pdfData(rechnung), TEXTS.de), kopf),
    rechnungBeleg("Rechnung mit Bruttopreisen, Rabatt und 40 Positionen", pdfData(brutto), briefkopf()),
    rechnungBeleg("Rechnung in Fremdwährung", pdfData(fremd)),
    rechnungBeleg("Rechnung als Kleinunternehmer", pdfData(klein)),
    rechnungBeleg("Rechnung mit Aufbewahrungshinweis", pdfData({ ...rechnung, propertyRetention: true }), kopf),
    rechnungBeleg("Stornorechnung", pdfData(storno)),
    beleg("Angebot", quotePdfData(angebot), kopf),
    beleg("Auftragsbestätigung", confirmationPdfData(angebot, "2026-10-05"), kopf),
    beleg("Lieferschein", deliveryNotePdfData(lieferschein), briefkopf()),
    { name: "Mahnung", art: "mahnung", data: templateInputs(dunningPdfData(mahnung), briefkopf()) },
    { name: "Mahnung als Entwurf", art: "mahnung", data: templateInputs(asDraft(dunningPdfData(mahnung), TEXTS.de), briefkopf()) },
  ];
}
