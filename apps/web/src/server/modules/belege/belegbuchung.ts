import { assetAccount, documentPosting, documentSplitPosting, type ExpenseCategory, type Kontenrahmen, type PostingLine, type Rechtsform } from "@haben/core";
import type { schema } from "../../db/index.ts";
import { splitLines, type DocumentSplit } from "./splits.ts";

/*
 * Buchungszeilen eines Belegs: beim Buchen und, für Belege aus der Zeit vor dem Stichjahr, beim Storno (Gegenbuchung im
 * heutigen Format, docs/adr/journal-als-quelle.md). Die Beträge kommen je Satz vom Beleg, nicht nachgerechnet: die Steuer
 * steht auf der Rechnung.
 */

type Document = typeof schema.documents.$inferSelect;
type Amount = { taxRate: number; net: number; tax: number };

/** Bei § 13b zahlst du nur netto; die Steuer geht ans Finanzamt, nicht an den Lieferanten */
export function totalsOf(amounts: Amount[], reverseCharge: string | null = null) {
  const net = amounts.reduce((s, a) => s + a.net, 0);
  const tax = amounts.reduce((s, a) => s + a.tax, 0);
  return { net, tax, gross: reverseCharge ? net : net + tax };
}

export function belegSummen(doc: Pick<Document, "reverseCharge">, amounts: Amount[]) {
  return {
    ...totalsOf(amounts, doc.reverseCharge),
    taxes: [...amounts].sort((a, b) => b.taxRate - a.taxRate).map((a) => ({ rate: a.taxRate, base: a.net, tax: a.tax })),
  };
}

/** Die Zeilen der Belegbuchung; `vorsteuerAbzug` wie am Beleg festgehalten (Kleinunternehmer ziehen keine Vorsteuer ab) */
export function belegZeilen(
  doc: Document,
  amounts: Amount[],
  splits: DocumentSplit[],
  books: { kontenrahmen: Kontenrahmen; rechtsform: Rechtsform },
  vorsteuerAbzug: boolean,
  /** Eigene Sachkonten (#270): ID → Nummer; ein Beleg oder eine Zeile mit eigenem Konto bucht dort statt auf das Konto der Kategorie */
  eigene: ReadonlyMap<string, string> = new Map(),
): PostingLine[] {
  const totals = belegSummen(doc, amounts);
  // Anlage: auf das Anlagekonto statt in den Aufwand; ohne Vorsteuerabzug gehört die Steuer zu den Anschaffungskosten
  const asset = doc.category === "anlage" ? doc.asset : null;
  const eigenesKonto = doc.ownAccountId ? eigene.get(doc.ownAccountId) : undefined;
  const assetAccountNo = asset ? assetAccount(asset.kind, asset.method, books.kontenrahmen) : eigenesKonto;
  // Aufgeteilt (#271): eine Buchung mit einer Aufwandszeile je Kategorie; sonst über die Kategorie des Belegs
  return splits.length > 0
    ? documentSplitPosting(
        totals,
        splitLines(splits, eigene),
        books.kontenrahmen,
        books.rechtsform,
        doc.payment,
        vorsteuerAbzug,
        // ig_erwerb lehnt splitBookingIssues mit Aufteilung ab; § 13b (#508) bucht je Zeile mit RC13bEU bzw. RC13bDrittland
        doc.reverseCharge === "eu" || doc.reverseCharge === "drittland" ? doc.reverseCharge : null,
        // Gutschrift, die bereits Bezahltes erstattet: Vorsteuerminderung erst mit dem Ausgleich (#786)
        doc.erstattetBezahltes,
      )
    : documentPosting(
        totals,
        doc.category as ExpenseCategory,
        books.kontenrahmen,
        books.rechtsform,
        doc.payment,
        vorsteuerAbzug,
        assetAccountNo,
        doc.privateShare,
        doc.reverseCharge,
        doc.erstattetBezahltes,
      );
}
