import type { LayoutDocumentType } from "@haben/core";
import { z } from "zod";

/*
 * Feldvertrag der Belegvorlagen (#113): Was eine Vorlage über sys.inputs.data bekommt, mit Beschreibung. Eigene Layouts
 * hängen davon ab, deshalb gilt:
 * - Jedes Feld, das die Daten tragen, steht hier (layout-schema.test.ts scheitert sonst).
 * - Felder kommen nur dazu. Wegfallen, umbenennen oder den Typ wechseln darf keines, solange die Version gilt; der
 *   eingefrorene Stand liegt in layout-schema.v1.json. Ein unvermeidbarer Bruch wird eine neue Version mit Adapter.
 * - Alles ist fertig formatierter Text: Beträge, Daten und Mengen setzt Haben, die Vorlage rechnet nichts.
 */

/** Version des Feldvertrags; ein eigenes Layout merkt sich, für welche es geschrieben ist */
export const LAYOUT_SCHEMA_VERSION = 1;

const text = (beschreibung: string) => z.string().describe(beschreibung);
const flag = (beschreibung: string) => z.boolean().describe(beschreibung);

const row = z.strictObject({ label: text("Bezeichnung, links"), value: text("Wert, rechts") }).describe("Zeile aus Bezeichnung und Wert");

const runs = z
  .array(
    z.strictObject({
      text: text("Text des Abschnitts"),
      bold: flag("fett"),
      italic: flag("kursiv"),
      underline: flag("unterstrichen"),
    }),
  )
  .describe("Text mit Auszeichnungen in Abschnitten, wie im Feld eingegeben (*fett*, _kursiv_, __unterstrichen__)");

/** Was jede Vorlage bekommt, gleich ob Beleg oder Mahnung */
const common = {
  docTitle: text("Titel des PDF-Dokuments, z. B. „Rechnung 2026-001“"),
  author: text("Verfasser im PDF, der Firmenname"),
  title: text("Überschrift auf dem Blatt, z. B. „Rechnung“ oder „Angebot“"),
  reference: text("Bezugszeile unter der Überschrift, etwa auf die stornierte Rechnung").nullable(),
  senderLine: text("Kleine Absenderzeile über dem Anschriftfeld"),
  recipient: z.array(z.string()).describe("Anschrift des Empfängers, eine Zeile je Eintrag"),
  meta: z.array(row).describe("Angaben rechts neben der Anschrift: Nummer, Datum, Leistungsdatum, Kundennummer, Referenzen"),
  payment: text("Satz zur Zahlung, etwa Fälligkeit, Skonto oder Lastschrift").nullable(),
  qr: text("GiroCode als SVG; null oder fehlt, wenn keiner gedruckt wird").nullable().optional(),
  footer: z.array(z.array(z.string())).describe("Spalten der Fußzeile, je Spalte die Zeilen als Text"),
  footerFormatted: z.array(z.array(runs)).nullable().describe("Eigene Fußzeile mit Auszeichnungen, je Spalte und Zeile; null bei der automatischen Fußzeile"),
  legal: text("Pflichtangaben einer GmbH oder UG (§ 35a GmbHG) in einer Zeile; null ohne").nullable(),
  // Aus dem Briefkopf (templateInputs)
  accent: text("Akzentfarbe #RRGGBB"),
  palette: z
    .strictObject({ ink: text("Text"), muted: text("Beschriftungen"), rule: text("Linien") })
    .describe("Grautöne #RRGGBB, aus der Akzentfarbe abgeleitet"),
  look: z
    .strictObject({
      logoHeight: z.number().describe("Größte Höhe des Logos in mm"),
      logoWidth: z.number().describe("Größte Breite des Logos in mm"),
      logoLeft: flag("Logo links statt rechts"),
      foldMarks: flag("Falz- und Lochmarken drucken"),
      backgroundPages: z.enum(["erste", "alle"]).describe("Briefpapier nur auf der ersten oder auf allen Seiten"),
    })
    .describe("Einstellungen der Gestaltung"),
  font: z
    .strictObject({ regular: text("Familie für normalen Text"), medium: text("Familie für mittelfett"), semibold: text("Familie für halbfett") })
    .describe("Gewählte Schrift; Familien, wie Typst sie nennt"),
  logo: text("Dateiname des Logos neben der Vorlage, z. B. logo.png; fehlt ohne Logo").optional(),
  background: text("Dateiname des Briefpapiers neben der Vorlage; fehlt ohne Briefpapier").optional(),
  draft: text("Vermerk über jeder Seite, wenn es ein Entwurf ist, z. B. „ENTWURF“; fehlt sonst").optional(),
  qrPlaceholder: text("Entwurf: Text im Platzhalter an der Stelle des GiroCodes; null ohne GiroCode").nullable().optional(),
};

const line = z.strictObject({
  pos: text("Positionsnummer"),
  itemNumber: text("Artikelnummer; leer ohne"),
  description: text("Bezeichnung"),
  detail: text("Text zur Position ohne Auszeichnungszeichen; null ohne").nullable(),
  detailFormatted: runs.nullable().describe("Text zur Position mit Auszeichnungen; null ohne"),
  quantity: text("Menge mit Einheit, z. B. „8 Std.“"),
  unitPrice: text("Einzelpreis; leer auf dem Lieferschein"),
  rate: text("Steuersatz, z. B. „19 %“; „–“ ohne Steuerausweis, leer auf dem Lieferschein"),
  net: text("Betrag der Zeile, bei Bruttopreisen brutto; leer auf dem Lieferschein"),
  discount: text("Rabatt der Position als Satz, z. B. „abzüglich 10 % Rabatt (95,00 €)“; null ohne").nullable().optional(),
  tag: text("Angebot: Kennzeichen über der Bezeichnung, etwa „Optional“ oder „Alternative zu Pos. 1“").optional(),
});

const totalsBlock = z
  .strictObject({
    rows: z.array(row).describe("Zeilen über dem Gesamtbetrag: Rabatt, Summe netto, Umsatzsteuer je Satz"),
    gross: row.describe("Gesamtbetrag"),
    included: z
      .strictObject({ label: text("Überschrift, z. B. „darin enthalten“"), rows: z.array(row).describe("Enthaltenes Netto und Umsatzsteuer je Satz") })
      .nullable()
      .optional()
      .describe("Bruttopreise: enthaltenes Netto und Umsatzsteuer je Satz; null bei Nettopreisen"),
    euroTax: z
      .strictObject({ label: text("Überschrift mit dem Kurs"), rows: z.array(row).describe("Umsatzsteuer in Euro je Satz, bei mehreren Sätzen auch gesamt") })
      .nullable()
      .optional()
      .describe("Fremdwährung: Umsatzsteuer in Euro (§ 14 Abs. 4 Nr. 8 UStG); null in Euro"),
  })
  .describe("Summenblock");

/** Daten für templates/rechnung.typ: Rechnung, Storno, Korrektur, Angebot, Auftragsbestätigung, Lieferschein */
export const belegDatenSchema = z
  .strictObject({
    ...common,
    labels: z
      .strictObject({
        columns: z
          .strictObject({
            pos: text("Kopf der Spalte Position"),
            itemNumber: text("Kopf der Spalte Artikelnummer"),
            description: text("Kopf der Spalte Bezeichnung"),
            quantity: text("Kopf der Spalte Menge"),
            unitPrice: text("Kopf der Spalte Einzelpreis"),
            vat: text("Kopf der Spalte Steuersatz"),
            net: text("Kopf der Spalte Betrag"),
          })
          .describe("Köpfe der Positionstabelle in der Sprache des Belegs"),
        page: z.array(z.string()).describe('Teile von „Seite x von y“, z. B. ["Seite", "von"]'),
      })
      .describe("Beschriftungen in der Sprache des Belegs"),
    itemNumbers: flag("Spalte Artikelnummer zeigen"),
    hideVatColumn: flag("Spalte Steuersatz weglassen (ein einziger Satz, abgewählt); fehlt auf dem Lieferschein").optional(),
    lines: z.array(line).describe("Positionen"),
    totals: totalsBlock.nullable().describe("Summenblock; null auf dem Lieferschein"),
    taxNote: text(
      "Feste Pflichthinweise unter den Summen: ohne Steuerausweis (etwa Kleinunternehmer, Reverse Charge) und zur Aufbewahrung privater Grundstücksleistungen; null ohne",
    ).nullable(),
    intro: text("Einleitung über den Positionen ohne Auszeichnungszeichen; null ohne, fehlt auf dem Lieferschein").nullable().optional(),
    introFormatted: runs.nullable().optional().describe("Einleitung mit Auszeichnungen; null ohne, fehlt auf dem Lieferschein"),
    note: text("Hinweis unter den Summen ohne Auszeichnungszeichen; null ohne").nullable(),
    noteFormatted: runs.nullable().describe("Hinweis mit Auszeichnungen; null ohne"),
    plan: z
      .strictObject({
        title: text("Überschrift des Zahlungsplans"),
        columns: z
          .strictObject({
            label: text("Kopf der Spalte Bezeichnung"),
            due: text("Kopf der Spalte Fälligkeit"),
            share: text("Kopf der Spalte Anteil"),
            amount: text("Kopf der Spalte Betrag"),
          })
          .describe("Spaltenköpfe"),
        rows: z
          .array(z.strictObject({ label: text("Bezeichnung"), due: text("Fälligkeit"), share: text("Anteil"), amount: text("Betrag") }))
          .describe("Zeilen des Plans"),
      })
      .nullable()
      .optional()
      .describe("Angebot und Auftragsbestätigung: Zahlungsplan; null ohne"),
    noPrices: flag("Lieferschein: Positionen ohne Preise").optional(),
    signature: z
      .strictObject({ text: text("Satz zur Empfangsbestätigung"), label: text("Beschriftung unter der Unterschriftslinie") })
      .optional()
      .describe("Lieferschein: Feld für die Unterschrift"),
  })
  .describe(`Daten für Belege (Feldvertrag v${LAYOUT_SCHEMA_VERSION})`);

/** Daten für templates/mahnung.typ */
export const mahnungDatenSchema = z
  .strictObject({
    ...common,
    salutation: text("Anrede"),
    intro: text("Einleitung ohne Auszeichnungszeichen"),
    introFormatted: runs.describe("Einleitung mit Auszeichnungen"),
    invoices: z
      .array(z.strictObject({ number: text("Rechnungsnummer"), date: text("Rechnungsdatum"), due: text("Fällig seit"), open: text("Offener Betrag") }))
      .describe("Gemahnte Rechnungen"),
    rows: z.array(row).describe("Forderung: offener Betrag, Gebühren, Pauschale, Zinsen"),
    total: row.describe("Zu zahlen"),
    closing: text("Schlusstext ohne Auszeichnungszeichen"),
    closingFormatted: runs.describe("Schlusstext mit Auszeichnungen"),
    greeting: text("Gruß und Firmenname, mit Zeilenumbruch"),
  })
  .describe(`Daten für Mahnungen (Feldvertrag v${LAYOUT_SCHEMA_VERSION})`);

export type BelegDaten = z.infer<typeof belegDatenSchema>;
export type MahnungDaten = z.infer<typeof mahnungDatenSchema>;

/** Beide Verträge als JSON Schema, zum Herunterladen und für die Doku */
export function layoutJsonSchema() {
  return {
    version: LAYOUT_SCHEMA_VERSION,
    beleg: z.toJSONSchema(belegDatenSchema),
    mahnung: z.toJSONSchema(mahnungDatenSchema),
  };
}

/**
 * Felder, die ein eigenes Layout verwenden muss (#113): Haben sucht ihren Namen im Quelltext, bevor es setzt. So fällt
 * ein vergessenes Feld auch dann auf, wenn kein Beispiel es füllt, etwa der Hinweis bei Reverse Charge in taxNote.
 * Mehrere Namen mit „|“: einer davon genügt. Bei Listen zählt der letzte Teil des Pfads (lines[].rate → rate).
 * Ob das Feld auch auf dem Blatt erscheint, prüft erst das Setzen der Beispiele; mehr garantiert Haben nicht.
 */
export const LAYOUT_PFLICHTFELDER = {
  beleg: [
    "title",
    "reference",
    "senderLine",
    "recipient",
    "meta",
    "lines",
    "lines[].description",
    "lines[].quantity",
    "lines[].rate",
    "lines[].net",
    "totals",
    "taxNote",
    "payment",
    "footer|footerFormatted",
    "legal",
    "draft",
  ],
  mahnung: [
    "title",
    "senderLine",
    "recipient",
    "meta",
    "intro|introFormatted",
    "invoices",
    "rows",
    "total",
    "closing|closingFormatted",
    "footer|footerFormatted",
    "legal",
    "draft",
  ],
} as const satisfies Record<"beleg" | "mahnung", readonly string[]>;

const ALLE_BELEGE = ["rechnung", "angebot", "auftragsbestaetigung", "lieferschein", "mahnung"] as const satisfies readonly LayoutDocumentType[];

/**
 * Einstellungen unter Einstellungen › Beleggestaltung, die nur über ein Feld des Vertrags aufs Blatt kommen (#113):
 * Nennt das zugeordnete eigene Layout keines der Felder, ändert die Einstellung dort nichts. belege sind die Belegarten,
 * auf die sie überhaupt wirkt, etwa der GiroCode nur auf Rechnung und Mahnung. Gesucht wird wie bei den Pflichtfeldern
 * der letzte Teil des Pfads im Quelltext (look.foldMarks → foldMarks), mehrere Pfade mit „|“: einer genügt.
 * Kundennummer, Fußzeile und „Fußzeile steht auf dem Briefpapier“ fehlen hier: Sie wirken über Pflichtfelder (meta,
 * footer, legal), die jedes Layout verwendet.
 */
export const LAYOUT_GESTALTUNG = {
  accent: { label: "Akzentfarbe", felder: "accent|palette", belege: ALLE_BELEGE },
  font: { label: "Schrift", felder: "font", belege: ALLE_BELEGE },
  logo: { label: "Logo", felder: "logo", belege: ALLE_BELEGE },
  logoSize: { label: "Größe des Logos", felder: "look.logoHeight|look.logoWidth", belege: ALLE_BELEGE },
  logoPosition: { label: "Seite des Logos", felder: "look.logoLeft", belege: ALLE_BELEGE },
  foldMarks: { label: "Falz- und Lochmarken", felder: "look.foldMarks", belege: ALLE_BELEGE },
  giroCode: { label: "GiroCode", felder: "qr", belege: ["rechnung", "mahnung"] },
  itemNumber: { label: "Artikelnummer", felder: "itemNumbers", belege: ["rechnung", "angebot", "auftragsbestaetigung", "lieferschein"] },
  vatColumn: { label: "Spalte USt je Position", felder: "hideVatColumn", belege: ["rechnung", "angebot", "auftragsbestaetigung"] },
  background: { label: "Briefpapier", felder: "background", belege: ALLE_BELEGE },
  backgroundPages: { label: "Seiten mit Briefpapier", felder: "look.backgroundPages", belege: ALLE_BELEGE },
} as const satisfies Record<string, { label: string; felder: string; belege: readonly LayoutDocumentType[] }>;

export type LayoutGestaltung = keyof typeof LAYOUT_GESTALTUNG;
