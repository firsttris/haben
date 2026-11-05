import { isValidGermanUstId, isValidIban, joinEmails, normalizeUstId, splitEmails } from "@haben/core";
import { type ColumnMapping, type ImportField, rowReader } from "./mapping.ts";
import { duplicateKey, type RowCandidate } from "./plan.ts";
import type { CsvTable } from "./read.ts";
import { parseImportCountry } from "./values.ts";

/**
 * Kontakte aus CSV. Die Spaltennamen folgen der Vorlage und dem Export von Lexware Office („Kundennummer“,
 * „Firmenname“, „Rechnungsadresse Straße“ …) und den Feldern der Lexware-API (companyName, firstName …), dazu den
 * üblichen Namen aus Excel-Listen.
 */
export const CONTACT_FIELDS = [
  {
    key: "kundennummer",
    label: "Kundennummer",
    aliases: ["Kundennummer", "Kundennr", "Kunden-Nr.", "Kd.-Nr.", "Debitorennummer", "Debitor", "customerNumber"],
  },
  {
    key: "lieferantennummer",
    label: "Lieferantennummer",
    aliases: ["Lieferantennummer", "Lieferantennr", "Lieferanten-Nr.", "Kreditorennummer", "Kreditor", "vendorNumber"],
  },
  {
    key: "firma",
    label: "Firma",
    hint: "Fehlt sie, wird der Name aus Vor- und Nachname gebildet",
    aliases: ["Firmenname", "Firma", "Unternehmen", "Unternehmensname", "Name des Unternehmens", "Organisation", "Name", "companyName"],
  },
  { key: "vorname", label: "Vorname", aliases: ["Vorname", "Vorname Ansprechpartner", "firstName"] },
  { key: "nachname", label: "Nachname", aliases: ["Nachname", "Nachname Ansprechpartner", "Familienname", "lastName"] },
  {
    key: "strasse",
    label: "Straße",
    aliases: ["Straße", "Strasse", "Straße und Hausnummer", "Straße Hausnummer", "Rechnungsadresse Straße", "Adresse", "Anschrift", "street"],
  },
  { key: "plz", label: "PLZ", aliases: ["PLZ", "Postleitzahl", "Rechnungsadresse PLZ", "zip"] },
  { key: "ort", label: "Ort", aliases: ["Ort", "Stadt", "Rechnungsadresse Ort", "city"] },
  {
    key: "land",
    label: "Land",
    hint: "Ländercode wie DE, auch 276 oder „Deutschland“; leer = DE",
    aliases: ["Land", "Ländercode", "Länderkennzeichen", "Rechnungsadresse Land", "Rechnungsadresse Ländercode", "countryCode", "country"],
  },
  { key: "email", label: "E-Mail", aliases: ["E-Mail", "Email", "E-Mail-Adresse", "E-Mail geschäftlich", "Mail", "emailAddress"] },
  {
    key: "ustId",
    label: "USt-IdNr.",
    aliases: ["USt-IdNr.", "USt-IdNr", "USt-ID", "UStIdNr", "Umsatzsteuer-ID", "Umsatzsteuer-Identifikationsnummer", "vatRegistrationId"],
  },
  { key: "iban", label: "IBAN", aliases: ["IBAN"] },
  { key: "leitwegId", label: "Leitweg-ID", aliases: ["Leitweg-ID", "LeitwegID", "Leitweg", "buyerReference"] },
  {
    key: "rolle",
    label: "Rolle",
    hint: "Kunde, Lieferant oder beides; leer = nach den Nummern, sonst Kunde",
    aliases: ["Rolle", "Typ", "Kontaktart", "Kontakttyp", "Kontaktrolle"],
  },
] as const satisfies readonly ImportField[];

export interface ContactRow {
  kundennummer: string;
  lieferantennummer: string;
  name: string;
  strasse: string;
  plz: string;
  ort: string;
  land: string;
  email: string;
  ustId: string;
  iban: string;
  leitwegId: string;
  isCustomer: boolean;
  isSupplier: boolean;
}

/** Rolle aus der Spalte, sonst aus den Nummern: nur Lieferantennummer = Lieferant, sonst Kunde */
function roles(raw: string, kundennummer: string, lieferantennummer: string): { isCustomer: boolean; isSupplier: boolean } | string {
  const value = raw.toLowerCase();
  if (!value) return { isCustomer: Boolean(kundennummer) || !lieferantennummer, isSupplier: Boolean(lieferantennummer) };
  const kunde = /kunde|debitor|customer/.test(value);
  const lieferant = /lieferant|kreditor|vendor|supplier/.test(value);
  const beides = /beide|both/.test(value);
  if (beides || (kunde && lieferant)) return { isCustomer: true, isSupplier: true };
  if (kunde || lieferant) return { isCustomer: kunde, isSupplier: lieferant };
  return `Rolle: „${raw}“; möglich sind Kunde, Lieferant oder beides`;
}

/** USt-IdNr. formal prüfen, die deutsche auch mit Prüfziffer; ob sie erteilt ist, weiß nur das BZSt */
export function ustIdImportProblem(raw: string): string | null {
  const ustId = normalizeUstId(raw);
  if (!/^[A-Z]{2}[0-9A-Z+*]{2,12}$/.test(ustId)) return `USt-IdNr.: „${raw}“ hat nicht die Form DE123456789`;
  if (ustId.startsWith("DE") && !isValidGermanUstId(ustId)) return `USt-IdNr.: „${raw}“ hat eine falsche Prüfziffer`;
  return null;
}

export function contactCandidates(table: CsvTable, mapping: ColumnMapping): RowCandidate<ContactRow>[] {
  return table.rows.map((row) => {
    const read = rowReader(row, mapping, CONTACT_FIELDS);
    const { errors } = read;
    const firma = read.text("firma");
    const person = [read.text("vorname"), read.text("nachname")].filter(Boolean).join(" ");
    const name = firma || person;
    if (!name) errors.push("Name fehlt (Firma oder Vor- und Nachname)");
    const kundennummer = read.text("kundennummer");
    const lieferantennummer = read.text("lieferantennummer");
    const land = parseImportCountry(read.raw("land"));
    if (!land.ok) errors.push(land.error);
    const rawUstId = read.raw("ustId");
    const ustProblem = rawUstId ? ustIdImportProblem(rawUstId) : null;
    if (ustProblem) errors.push(ustProblem);
    const rawIban = read.raw("iban");
    if (rawIban && !isValidIban(rawIban)) errors.push(`IBAN: „${rawIban}“ ist ungültig (Prüfziffer oder Länge)`);
    const role = roles(read.raw("rolle"), kundennummer, lieferantennummer);
    if (typeof role === "string") errors.push(role);
    // Mehrere Adressen in einer Zelle getrennt mit Komma oder Semikolon, gespeichert wie im Formular mit „, “
    const emails = joinEmails(splitEmails(read.text("email")));
    const ustId = rawUstId ? normalizeUstId(rawUstId) : "";
    // Alle Texte vor der Entscheidung lesen: auch eine Formel in der Straße macht die Zeile fehlerhaft
    const address = { strasse: read.text("strasse"), plz: read.text("plz"), ort: read.text("ort"), leitwegId: read.text("leitwegId") };
    const value: ContactRow | null =
      errors.length > 0 || typeof role === "string" || !land.ok
        ? null
        : {
            kundennummer,
            lieferantennummer,
            name,
            ...address,
            land: land.value,
            email: emails,
            ustId,
            iban: rawIban.replace(/\s+/g, "").toUpperCase(),
            ...role,
          };
    return {
      line: row.line,
      title: name || "(ohne Name)",
      value,
      errors,
      keys: contactKeys({ kundennummer, lieferantennummer, name, email: emails, ustId }),
    };
  });
}

/**
 * Woran ein Kontakt wiedererkannt wird: Kunden- und Lieferantennummer, jede E-Mail-Adresse, USt-IdNr. und der Name
 * (Groß- und Kleinschreibung egal, wie beim Abruf aus Lexware Office). Lieber einmal zu viel überspringen als einen
 * Kunden doppelt anlegen; einen gleichnamigen anderen Kunden legt man von Hand an.
 */
export function contactKeys(c: { kundennummer: string | null; lieferantennummer: string | null; name: string; email: string; ustId: string }) {
  return [
    ...duplicateKey("Kundennummer", c.kundennummer),
    ...duplicateKey("Lieferantennummer", c.lieferantennummer),
    ...splitEmails(c.email).flatMap((e) => duplicateKey("E-Mail", e)),
    ...duplicateKey("USt-IdNr.", c.ustId),
    ...duplicateKey("Name", c.name),
  ];
}
