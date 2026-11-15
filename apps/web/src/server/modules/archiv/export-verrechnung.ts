import { and, asc, gte, inArray, lte, type SQL } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";

/*
 * Verrechnungen zweier Eingangsbelege (#274): Eine Gutschrift gleicht eine Rechnung ohne Zahlung aus. Je Verrechnung
 * stehen zwei Zeilen (negativ beim Beleg, positiv bei der Gutschrift), eine Aufhebung ist eine Gegenzeile mit dem Datum
 * der Aufhebung. Sie haben keinen Bankumsatz; gebucht wird je Belegseite gegen das Verrechnungskonto (#786), und ohne
 * eigene Datei wäre der Vorgang, der beide offenen Posten zugleich verändert, im Archiv nicht nachvollziehbar.
 */

export const VERRECHNUNGEN_HEADER = ["Datum", "Beleg", "Gegenbeleg", "Betrag", "Notiz", "Hebt auf", "Angelegt", "Beleg-ID", "Gegenbeleg-ID", "Verrechnungs-ID"];

/**
 * Was die Verrechnungsdatei aus dem Archiv-Umfeld braucht. Die Helfer kommen als Parameter, damit dieses Modul
 * nichts aus export.ts importiert und kein Zirkelbezug entsteht.
 */
export interface VerrechnungsUmgebung {
  /** Belegtag als SQL-Ausdruck: Dokumentdatum, sonst Upload in deutscher Zeit */
  documentDay: SQL<string>;
  /** Erstes und letztes Datum des Archivjahrs */
  von: string;
  bis: string;
  /** Dateiname ohne Pfad, ASCII */
  safeName: (value: string) => string;
  /** Dateiendung zum MIME-Typ, Ersatz „bin“ */
  extension: (mimeType: string) => string;
  /** Cent als Dezimalzahl mit Komma */
  money: (cents: number | null | undefined) => string;
  /** Zeitstempel als ISO-Zeichenkette */
  iso: (value: Date | null | undefined) => string;
}

/**
 * Zeilen für `belege/verrechnungen.csv` eines Jahres, in der Reihenfolge Datum, Anlage, ID; `null`, wenn es keine
 * Verrechnung gibt. Der Name eines Belegs kommt aus seinem Archivpfad; liegt der Gegenbeleg in einem anderen Jahr,
 * aus Datum, Lieferant und ID.
 */
export async function verrechnungenFuerArchiv(documentPaths: ReadonlyMap<string, string>, umgebung: VerrechnungsUmgebung): Promise<(string | null)[][] | null> {
  const settlements = await db
    .select()
    .from(schema.documentSettlements)
    .where(and(gte(schema.documentSettlements.date, umgebung.von), lte(schema.documentSettlements.date, umgebung.bis)))
    .orderBy(asc(schema.documentSettlements.date), asc(schema.documentSettlements.createdAt), asc(schema.documentSettlements.id));
  if (settlements.length === 0) return null;

  // Der Gegenbeleg kann in einem anderen Jahr liegen; dann fehlt sein Pfad im Archiv und der Name kommt aus dem Beleg
  const ids = [...new Set(settlements.flatMap((s) => [s.documentId, s.counterDocumentId]))];
  const missing = ids.filter((id) => !documentPaths.has(id));
  const outside = missing.length
    ? await db
        .select({
          id: schema.documents.id,
          day: umgebung.documentDay,
          supplierName: schema.documents.supplierName,
          mimeType: schema.documents.mimeType,
        })
        .from(schema.documents)
        .where(inArray(schema.documents.id, missing))
    : [];
  const belegName = new Map<string, string>([
    ...[...documentPaths].map(([id, path]) => [id, path.replace(/^belege\//, "")] as const),
    ...outside.map((d) => [d.id, `${d.day}_${umgebung.safeName(d.supplierName)}_${d.id.slice(0, 8)}.${umgebung.extension(d.mimeType)}`] as const),
  ]);

  return settlements.map((s) => [
    s.date,
    belegName.get(s.documentId) ?? "",
    belegName.get(s.counterDocumentId) ?? "",
    umgebung.money(s.amount),
    s.note,
    s.reversesId,
    umgebung.iso(s.createdAt),
    s.documentId,
    s.counterDocumentId,
    s.id,
  ]);
}

export const RECHNUNGSVERRECHNUNGEN_HEADER = [
  "Datum",
  "Rechnung",
  "Gegenbeleg",
  "Betrag",
  "Notiz",
  "Hebt auf",
  "Paar",
  "Angelegt",
  "Rechnungs-ID",
  "Gegenbeleg-ID",
];

/**
 * Zeilen für `rechnungen/verrechnungen.csv` eines Jahres, in der Reihenfolge Datum, Anlage, ID; `null`, wenn es keine
 * Verrechnung gibt. Sie stehen in `invoice_settlements`, haben wie die Belegverrechnung keinen Bankumsatz und wären im
 * Archiv sonst nicht nachvollziehbar. Die Rechnungsnummern kommen aus dem Rechnungsabschnitt; eine Rechnung aus einem
 * anderen Jahr steht dort nicht und wird hier nachgeschlagen, sonst steht ihre ID.
 */
export async function rechnungsVerrechnungenFuerArchiv(
  invoiceNumbers: ReadonlyMap<string, string | null>,
  umgebung: VerrechnungsUmgebung,
): Promise<(string | null)[][] | null> {
  const settlements = await db
    .select()
    .from(schema.invoiceSettlements)
    .where(and(gte(schema.invoiceSettlements.date, umgebung.von), lte(schema.invoiceSettlements.date, umgebung.bis)))
    .orderBy(asc(schema.invoiceSettlements.date), asc(schema.invoiceSettlements.createdAt), asc(schema.invoiceSettlements.id));
  if (settlements.length === 0) return null;

  const numbers = new Map<string, string | null>(invoiceNumbers);
  const fehlend = [...new Set(settlements.flatMap((s) => [s.invoiceId, s.counterInvoiceId]))].filter((id) => !numbers.has(id));
  if (fehlend.length > 0) {
    for (const row of await db
      .select({ id: schema.invoices.id, number: schema.invoices.number })
      .from(schema.invoices)
      .where(inArray(schema.invoices.id, fehlend))) {
      numbers.set(row.id, row.number);
    }
  }
  const nummer = (id: string) => numbers.get(id) ?? id;

  return settlements.map((s) => [
    s.date,
    nummer(s.invoiceId),
    nummer(s.counterInvoiceId),
    umgebung.money(s.amount),
    s.note,
    s.reversesId,
    s.settlementId,
    umgebung.iso(s.createdAt),
    s.invoiceId,
    s.counterInvoiceId,
  ]);
}
