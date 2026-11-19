import { asc } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { csv, iso } from "./csv.ts";
import { kontaktFiles } from "./export-kontakte.ts";
import type { ArchiveFile } from "./export-zip.ts";

// Stammdaten des Jahresarchivs: Kontakte, Bankkonten und Firma

const encoder = new TextEncoder();

/** Kontakte (aktueller Stand und Versionen), Bankkonten und Firmendaten */
export async function* masterDataFiles(
  year: number,
  company: typeof schema.company.$inferSelect | undefined,
  accounts: (typeof schema.bankAccounts.$inferSelect)[],
): AsyncGenerator<ArchiveFile> {
  const contacts = await db.select().from(schema.contacts).orderBy(asc(schema.contacts.name), asc(schema.contacts.id));
  yield {
    path: "stammdaten/kontakte.csv",
    content: csv(
      [
        "Kundennummer",
        "Name",
        "Straße",
        "PLZ",
        "Ort",
        "Land",
        "E-Mail",
        "Telefon",
        "USt-IdNr.",
        "IBAN",
        "Leitweg-ID",
        "Rechnungsformat",
        "Version",
        "Archiviert",
        "Angelegt",
        "Geändert",
        "ID",
      ],
      contacts.map((c) => [
        c.kundennummer,
        c.name,
        c.strasse,
        c.plz,
        c.ort,
        c.land,
        c.email,
        c.telefon,
        c.ustId,
        c.iban,
        c.leitwegId,
        c.defaultFormat,
        c.version,
        iso(c.archivedAt),
        iso(c.createdAt),
        iso(c.updatedAt),
        c.id,
      ]),
    ),
    compress: true,
  };
  yield* kontaktFiles(year);
  yield {
    path: "stammdaten/bankkonten.csv",
    content: csv(
      ["Name", "IBAN", "Angelegt", "ID"],
      accounts.map((a) => [a.name, a.iban, iso(a.createdAt), a.id]),
    ),
    compress: true,
  };
  // Ohne den Hash des Kalender-Tokens: der gehört zum Zugang, nicht zu den Stammdaten
  const firma = company && { ...company, calendarTokenHash: undefined };
  yield { path: "stammdaten/firma.json", content: encoder.encode(`${JSON.stringify(firma, null, 2)}\n`), compress: true };
}
