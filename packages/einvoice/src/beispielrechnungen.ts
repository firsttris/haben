// Beispielrechnungen aller Fälle, die Haben als E-Rechnung erzeugt: geprüft mit dem KoSIT-Validator
// (scripts/kosit-check.ts) und als festgehaltenes XML (e-rechnung-vergleich.test.ts)
import type { Discount } from "@haben/core";
import {
  discountLines,
  euBuyer,
  gmbhSeller,
  grossPriceLines,
  mixedRateLines,
  publicBuyer,
  sampleBuyer,
  sampleDocument,
  sampleSeller,
  thirdCountryBuyer,
  zeroRateLines,
} from "./samples.ts";
import type { InvoiceDocument } from "./types.ts";

const sampleDirectDebit = {
  mandateReference: "KD-1042-01",
  creditorId: "DE98ZZZ09999999999",
  debtorIban: "DE02120300000000202051",
  collectionDate: "2026-11-30",
};
const orderReferences = { buyerOrder: "4500012345", sellerOrder: "AN-2026-007", despatchAdvice: "LS-0815" };

/** Name → Rechnung; der Name endet auf das Format (zugferd, xr-cii, xr-ubl oder das Format selbst) */
export const BEISPIELRECHNUNGEN: Record<string, InvoiceDocument> = {
  "rechnung-19-zugferd": sampleDocument({ note: "Vielen Dank für die gute Zusammenarbeit." }),
  "rechnung-19-xr-cii": sampleDocument({ format: "xrechnung-cii" }),
  "rechnung-19-xr-ubl": sampleDocument({ format: "xrechnung-ubl" }),
  // Beschreibung der Position (BT-154) unter der Bezeichnung
  ...Object.fromEntries(
    (["zugferd", "xrechnung-cii", "xrechnung-ubl"] as const).map((format) => {
      const doc = sampleDocument({ format });
      doc.lines[0]!.detail = "Konzeption und Umsetzung\nlaut Rahmenvertrag RV-2026-17";
      return [`positionstext-${format}`, doc];
    }),
  ),
  "gemischt-19-7-zugferd": sampleDocument({ lines: mixedRateLines }),
  "gemischt-19-7-xr-cii": sampleDocument({ format: "xrechnung-cii", lines: mixedRateLines }),
  "gemischt-19-7-xr-ubl": sampleDocument({ format: "xrechnung-ubl", lines: mixedRateLines }),
  "storno-zugferd": sampleDocument({ kind: "storno" }),
  "storno-xr-cii": sampleDocument({ kind: "storno", format: "xrechnung-cii" }),
  "storno-xr-ubl": sampleDocument({ kind: "storno", format: "xrechnung-ubl" }),
  "korrektur-xr-ubl": sampleDocument({ kind: "korrektur", format: "xrechnung-ubl", lines: mixedRateLines }),
  // Storno einer Korrektur (mit dem Storno ihrer Rechnung): Positionen positiv, als Gutschrift mit negativen Beträgen
  ...Object.fromEntries(
    (["zugferd", "xrechnung-cii", "xrechnung-ubl"] as const).map((format) => [
      `storno-korrektur-${format}`,
      sampleDocument({ kind: "storno", format, lines: mixedRateLines.map((line) => ({ ...line, unitPrice: -line.unitPrice })) }),
    ]),
  ),
  // GmbH: Handelsregisternummer (BT-30) und Pflichtangaben nach § 35a GmbHG (BT-33)
  ...Object.fromEntries(
    (["zugferd", "xrechnung-cii", "xrechnung-ubl"] as const).map((format) => [`gmbh-${format}`, { ...sampleDocument({ format }), seller: gmbhSeller }]),
  ),
  // Skonto in den Zahlungsbedingungen (BT-20) nach BR-DE-18, zwei Stufen wie im Testfall 01.10a der XRechnung-Testsuite
  ...Object.fromEntries(
    (["zugferd", "xrechnung-cii", "xrechnung-ubl"] as const).flatMap((format) => [
      [
        `skonto-${format}`,
        {
          ...sampleDocument({ format }),
          skonto: [
            { days: 10, percent: 200 },
            { days: 14, percent: 100 },
          ],
        },
      ],
      [`skonto-leitweg-${format}`, { ...sampleDocument({ format, buyer: publicBuyer }), skonto: [{ days: 7, percent: 250 }] }],
    ]),
  ),
  // Ansprechpartner des Käufers (BT-56) neben der Kontakt-E-Mail (BT-58), in allen drei Formaten (#424)
  ...Object.fromEntries(
    (["zugferd", "xrechnung-cii", "xrechnung-ubl"] as const).map((format) => [
      `ansprechpartner-${format}`,
      sampleDocument({
        format,
        buyer: { ...sampleBuyer, ansprechpartner: { name: "Mara Beispiel", email: "mara@nordwerk.example", telefon: "+49 40 7654321", funktion: "Einkauf" } },
      }),
    ]),
  ),
  "leitweg-xr-cii": sampleDocument({ format: "xrechnung-cii", buyer: publicBuyer }),
  "leitweg-xr-ubl": sampleDocument({ format: "xrechnung-ubl", buyer: publicBuyer }),
  "leistungsdatum-xr-ubl": { ...sampleDocument({ format: "xrechnung-ubl" }), serviceFrom: "2026-09-30", serviceTo: undefined },
  ...Object.fromEntries(
    (["zugferd", "xrechnung-cii", "xrechnung-ubl"] as const).map((format) => [
      `nur-steuernummer-${format}`,
      { ...sampleDocument({ format }), seller: { ...sampleSeller, ustId: undefined } },
    ]),
  ),
  ...Object.fromEntries(
    (["zugferd", "xrechnung-cii", "xrechnung-ubl"] as const).flatMap((format) => [
      [`reverse-charge-${format}`, sampleDocument({ format, buyer: euBuyer, lines: zeroRateLines, taxTreatment: "reverse_charge" })],
      // Eigene Einheiten (#748): Code aus der Position, auch der Rückfall C62
      [
        `eigene-einheiten-${format}`,
        (() => {
          const doc = sampleDocument({ format });
          const eigene = [
            { unit: "UE", unitCode: "C62" },
            { unit: "m²", unitCode: "MTK" },
            { unit: "lfm", unitCode: "LM" },
          ];
          return { ...doc, lines: doc.lines.map((line, i) => ({ ...line, ...eigene[i % eigene.length] })) };
        })(),
      ],
      [`drittland-${format}`, sampleDocument({ format, buyer: thirdCountryBuyer, lines: zeroRateLines, taxTreatment: "drittland" })],
      [`ig-lieferung-${format}`, sampleDocument({ format, buyer: euBuyer, lines: zeroRateLines, taxTreatment: "ig_lieferung" })],
      [
        `ig-lieferung-lieferdatum-${format}`,
        { ...sampleDocument({ format, buyer: euBuyer, lines: zeroRateLines, taxTreatment: "ig_lieferung" }), serviceFrom: "2026-09-30", serviceTo: undefined },
      ],
      [`ausfuhr-${format}`, sampleDocument({ format, buyer: thirdCountryBuyer, lines: zeroRateLines, taxTreatment: "ausfuhr" })],
      [
        `steuerfrei-${format}`,
        sampleDocument({ format, lines: zeroRateLines, taxTreatment: "steuerfrei", exemptionReason: "Steuerfrei nach § 4 Nr. 21 UStG" }),
      ],
      [
        `kleinunternehmer-${format}`,
        {
          ...sampleDocument({ format, lines: zeroRateLines, taxTreatment: "kleinunternehmer" }),
          seller: { ...sampleSeller, ustId: undefined },
        },
      ],
    ]),
  ),
  "storno-ig-lieferung-xr-cii": sampleDocument({ kind: "storno", format: "xrechnung-cii", buyer: euBuyer, lines: zeroRateLines, taxTreatment: "ig_lieferung" }),
  "storno-reverse-charge-xr-ubl": sampleDocument({
    kind: "storno",
    format: "xrechnung-ubl",
    buyer: euBuyer,
    lines: zeroRateLines,
    taxTreatment: "reverse_charge",
  }),
  // Fremdwährung: Rechnungswährung USD bzw. CHF, Steuerwährung EUR mit der Steuer in Euro (BT-6, BT-111)
  ...Object.fromEntries(
    (["zugferd", "xrechnung-cii", "xrechnung-ubl"] as const).flatMap((format) => [
      [
        `usd-19-${format}`,
        {
          ...sampleDocument({
            format,
            lines: [{ description: "Beratung", quantity: 1000, unit: "Psch." as const, unitPrice: 10_000, taxRate: 1900 as const }],
          }),
          currency: "USD",
          euroTax: { tax: 1757, taxes: [{ rate: 1900, tax: 1757 }], rate: "1 EUR = 1,0812 USD (USt-Umrechnungskurs 09/2026)" },
        },
      ],
      [
        `usd-storno-${format}`,
        {
          ...sampleDocument({
            kind: "storno",
            format,
            lines: [{ description: "Beratung", quantity: 1000, unit: "Psch." as const, unitPrice: 10_000, taxRate: 1900 as const }],
          }),
          currency: "USD",
          euroTax: { tax: -1757, taxes: [{ rate: 1900, tax: -1757 }], rate: "1 EUR = 1,0812 USD (USt-Umrechnungskurs 09/2026)" },
        },
      ],
      [
        `chf-drittland-${format}`,
        {
          ...sampleDocument({ format, buyer: thirdCountryBuyer, lines: zeroRateLines, taxTreatment: "drittland" }),
          currency: "CHF",
          euroTax: { tax: 0, taxes: [{ rate: 0, tax: 0 }], rate: "1 EUR = 0,9400 CHF (USt-Umrechnungskurs 09/2026)" },
        },
      ],
    ]),
  ),
  "korrektur-gemischt-xr-cii": korrekturMitZuschlag("xrechnung-cii"),
  "korrektur-gemischt-xr-ubl": korrekturMitZuschlag("xrechnung-ubl"),
  ...Object.fromEntries(
    (["zugferd", "xrechnung-cii", "xrechnung-ubl"] as const).flatMap((format) => [
      [`abschlag-${format}`, { ...sampleDocument({ format }), variant: "abschlag" as const }],
      [`schluss-${format}`, schlussrechnung(format)],
    ]),
  ),
  // SEPA-Lastschrift (#445): Zahlungsart 59 mit BT-89, BT-90, BT-91 (BR-DE-25-a/b, BR-DE-30, BR-DE-31), auch als Storno
  ...Object.fromEntries(
    (["zugferd", "xrechnung-cii", "xrechnung-ubl"] as const).flatMap((format) => [
      [`lastschrift-${format}`, { ...sampleDocument({ format }), directDebit: sampleDirectDebit }],
      [`lastschrift-storno-${format}`, { ...sampleDocument({ kind: "storno", format }), directDebit: sampleDirectDebit }],
    ]),
  ),
  // Bruttopreise: Netto je Satz herausgerechnet, Netto-Einzelpreise mit mehr Nachkommastellen
  ...Object.fromEntries(
    (["zugferd", "xrechnung-cii", "xrechnung-ubl"] as const).flatMap((format) => [
      [`brutto-${format}`, sampleDocument({ format, lines: grossPriceLines, priceMode: "brutto" })],
      [`brutto-storno-${format}`, sampleDocument({ kind: "storno", format, lines: grossPriceLines, priceMode: "brutto" })],
      // 9,80 € brutto: Steuer 1,56 € auf 8,24 € netto, nachgerechnet wären es 1,57 € (BR-CO-17 erlaubt das)
      [
        `brutto-980-${format}`,
        sampleDocument({
          format,
          lines: [{ description: "Abzug 13 × 18 cm", quantity: 1000, unit: "Stk.", unitPrice: 980, taxRate: 1900 }],
          priceMode: "brutto",
        }),
      ],
      [`brutto-schluss-${format}`, schlussrechnung(format, "brutto")],
    ]),
  ),
  // Rabatte: Positionsrabatt (BG-27) in Prozent und als Betrag, Gesamtrabatt je Steuersatz (BG-20)
  ...Object.fromEntries(
    (["zugferd", "xrechnung-cii", "xrechnung-ubl"] as const).flatMap((format) => [
      [`rabatt-prozent-${format}`, sampleDocument({ format, lines: discountLines, discount: { kind: "prozent", value: 500 } })],
      [`rabatt-betrag-${format}`, sampleDocument({ format, lines: discountLines, discount: { kind: "betrag", value: 10_001 } })],
      [`rabatt-brutto-${format}`, sampleDocument({ format, lines: discountLines, discount: { kind: "prozent", value: 300 }, priceMode: "brutto" })],
      [`rabatt-storno-${format}`, sampleDocument({ kind: "storno", format, lines: discountLines, discount: { kind: "betrag", value: 10_001 } })],
      [
        `rabatt-brutto-storno-${format}`,
        sampleDocument({ kind: "storno", format, lines: discountLines, discount: { kind: "betrag", value: 999 }, priceMode: "brutto" }),
      ],
      [`rabatt-schluss-${format}`, schlussrechnung(format, "netto", { kind: "prozent", value: 1000 })],
      [`rabatt-brutto-schluss-${format}`, schlussrechnung(format, "brutto", { kind: "betrag", value: 5000 })],
      [
        `rabatt-reverse-charge-${format}`,
        sampleDocument({
          format,
          buyer: euBuyer,
          lines: zeroRateLines.map((l) => ({ ...l, discount: { kind: "prozent" as const, value: 1500 } })),
          discount: { kind: "betrag", value: 2000 },
          taxTreatment: "reverse_charge",
        }),
      ],
      [
        `rabatt-drittland-${format}`,
        sampleDocument({ format, buyer: thirdCountryBuyer, lines: zeroRateLines, discount: { kind: "prozent", value: 1000 }, taxTreatment: "drittland" }),
      ],
      [
        `rabatt-kleinunternehmer-${format}`,
        {
          ...sampleDocument({ format, lines: zeroRateLines, discount: { kind: "prozent", value: 250 }, taxTreatment: "kleinunternehmer" }),
          seller: { ...sampleSeller, ustId: undefined },
        },
      ],
    ]),
  ),
  "brutto-grosse-menge-xr-ubl": sampleDocument({
    format: "xrechnung-ubl",
    lines: [
      { description: "Druckseiten", quantity: 123_456_789, unit: "Stk.", unitPrice: 7, taxRate: 1900 },
      { description: "Versand", quantity: 3000, unit: "Psch.", unitPrice: 499, taxRate: 1900 },
    ],
    priceMode: "brutto",
  }),
  "nullsatz-xr-cii": sampleDocument({
    format: "xrechnung-cii",
    lines: [{ description: "Leistung zum Nullsatz", quantity: 1000, unit: "Psch.", unitPrice: 50000, taxRate: 0 }],
  }),
  // Die Fälle darüber, die es nur in einem oder zwei Formaten gibt, in den übrigen (#734)
  ...Object.fromEntries(
    (
      [
        ["korrektur", ["zugferd", "xrechnung-cii"], (format) => sampleDocument({ kind: "korrektur", format, lines: mixedRateLines })],
        ["korrektur-gemischt", ["zugferd"], korrekturMitZuschlag],
        ["leitweg", ["zugferd"], (format) => sampleDocument({ format, buyer: publicBuyer })],
        ["leistungsdatum", ["zugferd", "xrechnung-cii"], (format) => ({ ...sampleDocument({ format }), serviceFrom: "2026-09-30", serviceTo: undefined })],
        [
          "storno-ig-lieferung",
          ["zugferd", "xrechnung-ubl"],
          (format) => sampleDocument({ kind: "storno", format, buyer: euBuyer, lines: zeroRateLines, taxTreatment: "ig_lieferung" }),
        ],
        [
          "storno-reverse-charge",
          ["zugferd", "xrechnung-cii"],
          (format) => sampleDocument({ kind: "storno", format, buyer: euBuyer, lines: zeroRateLines, taxTreatment: "reverse_charge" }),
        ],
        [
          "brutto-grosse-menge",
          ["zugferd", "xrechnung-cii"],
          (format) =>
            sampleDocument({
              format,
              lines: [
                { description: "Druckseiten", quantity: 123_456_789, unit: "Stk.", unitPrice: 7, taxRate: 1900 },
                { description: "Versand", quantity: 3000, unit: "Psch.", unitPrice: 499, taxRate: 1900 },
              ],
              priceMode: "brutto",
            }),
        ],
        [
          "nullsatz",
          ["zugferd", "xrechnung-ubl"],
          (format) =>
            sampleDocument({ format, lines: [{ description: "Leistung zum Nullsatz", quantity: 1000, unit: "Psch.", unitPrice: 50000, taxRate: 0 }] }),
        ],
      ] as [string, InvoiceDocument["format"][], (format: InvoiceDocument["format"]) => InvoiceDocument][]
    ).flatMap(([name, formats, make]) => formats.map((format) => [`${name}-${format}`, make(format)])),
  ),
  // Bestellnummer (BT-13), Auftragsnummer (BT-14) und Lieferschein (BT-16); BT-16 mit Lieferdatum und ohne
  ...Object.fromEntries(
    (["zugferd", "xrechnung-cii", "xrechnung-ubl"] as const).flatMap((format) => [
      [`referenzen-${format}`, { ...sampleDocument({ format }), references: orderReferences }],
      [`referenzen-lieferdatum-${format}`, { ...sampleDocument({ format }), serviceFrom: "2026-09-30", serviceTo: "2026-09-30", references: orderReferences }],
      // Ohne Bestellnummer: im UBL „NA“ in cac:OrderReference/cbc:ID, im CII kein BT-13
      [`referenzen-ohne-bestellung-${format}`, { ...sampleDocument({ format }), references: { sellerOrder: "AN-2026-007" } }],
      [`referenzen-storno-${format}`, { ...sampleDocument({ kind: "storno", format }), references: orderReferences }],
    ]),
  ),
  // Artikelnummer des Verkäufers (BT-155) an der ersten Position, die zweite ohne; auch als Storno
  ...Object.fromEntries(
    (["zugferd", "xrechnung-cii", "xrechnung-ubl"] as const).flatMap((format) =>
      (["rechnung", "storno"] as const).map((kind) => {
        const doc = sampleDocument({ kind, format });
        doc.lines[0]!.itemNumber = "ET-1042";
        return [`artikelnummer-${kind}-${format}`, doc];
      }),
    ),
  ),
};

/**
 * Schlussrechnung mit zwei Steuersätzen, abzüglich einer Abschlagsrechnung als negative Positionen;
 * bei Bruttopreisen werden die Abschläge brutto abgezogen
 */
function schlussrechnung(format: InvoiceDocument["format"], priceMode: "netto" | "brutto" = "netto", discount?: Discount): InvoiceDocument {
  const gross = priceMode === "brutto";
  const deductions = [
    {
      description: "Abzüglich Abschlagsrechnung 2026-030 vom 15.09.2026 (netto 1.000,00 €, USt 190,00 €)",
      quantity: 1000,
      unit: "Psch." as const,
      unitPrice: gross ? -119000 : -100000,
      taxRate: 1900 as const,
      deductionOf: "abschlag-2026-030",
    },
    {
      description: "Abzüglich Abschlagsrechnung 2026-030 vom 15.09.2026 (netto 50,00 €, USt 3,50 €)",
      quantity: 1000,
      unit: "Psch." as const,
      unitPrice: gross ? -5350 : -5000,
      taxRate: 700 as const,
      deductionOf: "abschlag-2026-030",
    },
  ];
  return {
    ...sampleDocument({
      format,
      lines: [...(gross ? grossPriceLines.map((l) => ({ ...l, quantity: l.quantity * 10 })) : mixedRateLines), ...deductions],
      priceMode,
      ...(discount ? { discount } : {}),
    }),
    variant: "schluss",
    deducted: [{ number: "2026-030", issueDate: "2026-09-15" }],
  };
}

/** Korrektur mit gutgeschriebenen und einer nachberechneten Position, insgesamt negativ */
function korrekturMitZuschlag(format: InvoiceDocument["format"]): InvoiceDocument {
  const lines = mixedRateLines.map((line, i) => (i === 2 ? { ...line, unitPrice: -line.unitPrice } : line));
  return sampleDocument({ kind: "korrektur", format, lines });
}
