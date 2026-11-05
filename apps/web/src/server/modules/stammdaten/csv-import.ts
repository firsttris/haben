import {
  ARTICLE_FIELDS,
  articleCandidates,
  articleKeys,
  CONTACT_FIELDS,
  contactCandidates,
  contactKeys,
  planRows,
  type ColumnMapping,
  type CsvTable,
  type ImportField,
  type PlannedRow,
  type RowCandidate,
} from "@haben/import";
import type { z } from "zod";
import type { Db, Tx } from "../../db/index.ts";
import { schema } from "../../db/index.ts";
import { type ArticleInput, articleInputSchema, insertArticle } from "./articles.ts";
import { type ContactInput, contactSchema, insertContact } from "./contacts.ts";

/*
 * CSV-Import von Kontakten und Artikeln (docs/csv-import.md): Die Zeilen liest und prüft @haben/import, hier kommen die
 * Regeln der Formulare (contactSchema, articleInputSchema) und die Dubletten gegen den Bestand dazu. Angelegt wird über
 * dieselben Funktionen wie im Formular, in der Transaktion des Aufrufers.
 */

/** Meldungen eines Schemas mit dem Namen des Felds davor, wie in der Vorschau je Zeile */
function schemaErrors(error: z.ZodError, fields: readonly ImportField[]): string[] {
  return error.issues.map((issue) => {
    const key = String(issue.path[0] ?? "");
    const label = fields.find((f) => f.key === key)?.label ?? (key === "name" ? "Name" : key);
    return label ? `${label}: ${issue.message}` : issue.message;
  });
}

/** Das Ergebnis des Schemas an die Zeile hängen: entweder der geprüfte Wert oder die Meldungen */
function validated<T, U>(row: RowCandidate<T>, check: (value: T) => z.ZodSafeParseResult<U>, fields: readonly ImportField[]): RowCandidate<U> {
  if (!row.value) return { ...row, value: null };
  const result = check(row.value);
  return result.success ? { ...row, value: result.data } : { ...row, value: null, errors: [...row.errors, ...schemaErrors(result.error, fields)] };
}

/** Alle Kontakte, auch archivierte: ein archivierter Kunde soll nicht als neuer wieder auftauchen */
async function contactKeysInStock(q: Db | Tx) {
  const rows = await q
    .select({
      kundennummer: schema.contacts.kundennummer,
      lieferantennummer: schema.contacts.lieferantennummer,
      name: schema.contacts.name,
      email: schema.contacts.email,
      ustId: schema.contacts.ustId,
    })
    .from(schema.contacts);
  return rows.flatMap(contactKeys);
}

export async function planContactImport(q: Db | Tx, table: CsvTable, mapping: ColumnMapping): Promise<PlannedRow<z.output<typeof contactSchema>>[]> {
  const candidates = contactCandidates(table, mapping).map((row) =>
    validated(row, (c) => contactSchema.safeParse({ ...c, defaultFormat: null, language: "de" }), CONTACT_FIELDS),
  );
  return planRows(candidates, await contactKeysInStock(q));
}

export async function insertImportedContacts(tx: Tx, contacts: readonly ContactInput[]): Promise<number> {
  for (const contact of contacts) await insertContact(tx, contact);
  return contacts.length;
}

async function articleKeysInStock(q: Db | Tx) {
  const rows = await q.select({ number: schema.articles.number, description: schema.articles.description }).from(schema.articles);
  return rows.flatMap(articleKeys);
}

export async function planArticleImport(q: Db | Tx, table: CsvTable, mapping: ColumnMapping): Promise<PlannedRow<z.output<typeof articleInputSchema>>[]> {
  const candidates = articleCandidates(table, mapping).map((row) => validated(row, (a) => articleInputSchema.safeParse(a), ARTICLE_FIELDS));
  return planRows(candidates, await articleKeysInStock(q));
}

export async function insertImportedArticles(tx: Tx, articles: readonly ArticleInput[]): Promise<number> {
  for (const article of articles) await insertArticle(tx, article);
  return articles.length;
}
