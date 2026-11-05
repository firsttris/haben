import { allocateSplitTax, EXPENSE_CATEGORY_KEYS, splitIssues, type AllocatedSplitLine, type ExpenseCategory } from "@haben/core";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";

/*
 * Aufteilung eines Belegs auf mehrere Kontierungszeilen (#271). Die Zeilen tragen Kategorie, Steuersatz und Netto; die
 * Vorsteuer des Satzes verteilt allocateSplitTax beim Speichern anteilig auf sie. Ohne Zeilen gilt wie bisher die
 * Kategorie des Belegs. Mit Zeilen steht am Beleg keine Kategorie.
 */

export type DocumentSplit = typeof schema.documentSplits.$inferSelect;

export const splitInputSchema = z.object({
  category: z.enum(EXPENSE_CATEGORY_KEYS),
  taxRate: z.union([z.literal(1900), z.literal(700), z.literal(0)]),
  net: z.number().int().min(-100_000_000_00).max(100_000_000_00),
});

/** Höchstwert der int4-Spalten net und tax */
const MAX_SPLIT_CENTS = 2_147_483_647;

export type SplitInput = z.output<typeof splitInputSchema>;

/** Zeilen als Kontierungszeilen für Buchung, EÜR und Prüfung */
export function splitLines(splits: Pick<DocumentSplit, "category" | "taxRate" | "net" | "tax">[]): AllocatedSplitLine[] {
  return splits.map(({ category, taxRate, net, tax }) => ({ category: category as ExpenseCategory, taxRate, net, tax }));
}

/** Ersetzt die Zeilen eines offenen Belegs; die Vorsteuer je Zeile kommt aus den Euro-Beträgen des Belegs je Satz */
export async function replaceSplits(tx: Tx, documentId: string, splits: SplitInput[], amounts: { taxRate: number; net: number; tax: number }[]): Promise<void> {
  await tx.delete(schema.documentSplits).where(eq(schema.documentSplits.documentId, documentId));
  if (splits.length === 0) return;
  const allocated = allocateSplitTax(splits, amounts);
  // Netto und verteilte Vorsteuer stehen in int4-Spalten; die Eingabe erlaubt wie bei den Beträgen mehr
  if (allocated.some((line) => Math.abs(line.net) > MAX_SPLIT_CENTS || Math.abs(line.tax) > MAX_SPLIT_CENTS)) {
    throw new UserError("Ein Betrag der Aufteilung ist zu groß. Stimmen die Nettobeträge der Zeilen?");
  }
  await tx.insert(schema.documentSplits).values(allocated.map((line, i) => ({ documentId, position: i + 1, ...line })));
}

export async function loadSplits(documentId: string, q: Db | Tx = db): Promise<DocumentSplit[]> {
  return q.select().from(schema.documentSplits).where(eq(schema.documentSplits.documentId, documentId)).orderBy(asc(schema.documentSplits.position));
}

/** Zeilen mehrerer Belege, je Beleg in Reihenfolge; Belege ohne Aufteilung fehlen */
export async function splitsByDocument(ids: string[], q: Db | Tx = db): Promise<Map<string, AllocatedSplitLine[]>> {
  if (ids.length === 0) return new Map();
  const rows = await q
    .select()
    .from(schema.documentSplits)
    .where(inArray(schema.documentSplits.documentId, ids))
    .orderBy(asc(schema.documentSplits.documentId), asc(schema.documentSplits.position));
  const result = new Map<string, AllocatedSplitLine[]>();
  for (const row of rows) result.set(row.documentId, [...(result.get(row.documentId) ?? []), ...splitLines([row])]);
  return result;
}

/**
 * Was gegen das Buchen eines aufgeteilten Belegs spricht. Erster Schritt: nur Belege mit deutscher Umsatzsteuer in Euro.
 * § 13b, Privatanteil und Fremdwährung verteilen Steuer bzw. Beträge anders; sie lehnt Haben mit Aufteilung ab.
 */
export function splitBookingIssues(
  doc: { reverseCharge: string | null; privateShare: number; currency: string },
  amounts: { taxRate: number; net: number; tax: number }[],
  splits: Pick<DocumentSplit, "category" | "taxRate" | "net" | "tax">[],
): string[] {
  const issues: string[] = [];
  if (doc.reverseCharge) issues.push("§ 13b mit Aufteilung wird nicht unterstützt");
  if (doc.privateShare > 0) issues.push("Ein Privatanteil mit Aufteilung wird nicht unterstützt");
  if (doc.currency !== "EUR") issues.push("Fremdwährung mit Aufteilung wird nicht unterstützt");
  return [...issues, ...splitIssues(splitLines(splits), amounts)];
}
