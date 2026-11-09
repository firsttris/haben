import { isValidGermanUstId, isValidIban, joinEmails, normalizeTelefon, normalizeUstId, parsePersonenkonto, splitEmails, telefonProblem } from "@haben/core";
import { type ColumnMapping, type ImportField, rowReader } from "./mapping.ts";
import { duplicateKey, type RowCandidate } from "./plan.ts";
import type { CsvTable } from "./read.ts";
import { parseImportCountry } from "./values.ts";

/**
 * Kontakte aus CSV. Die Spaltennamen folgen der Mustervorlage von Lexware Office („Kundennummer“, „Firmenname“,
 * „Straße (Rechnungsadresse)“, „Geschäftlich (E-Mail)“ …, Lexware-Hilfe „Anleitung zum Import von Kontakten“:
 * https://help.lexware.de/de-form/articles/548267-anleitung-zum-import-von-kontakten-kunden-und-lieferanten), dem
 * Kontakt-Export („Straße 1“, „E-Mail 1“, „Umsatzsteuernummer“ …, Lexware-Hilfe „Kontakte beim Account-Wechsel
 * übertragen“: https://help.lexware.de/de-form/articles/548116-kontakte-beim-account-wechsel-ubertragen-export-und-import-in-lexware-office)
 * und den Feldern der Lexware-API (companyName, firstName …), dazu den üblichen Namen aus Excel-Listen. Von zwei
 * Adressen gilt die Rechnungsadresse (Vorlage) bzw. Adresse 1 (Export); die Lieferadresse übernimmt Haben nicht.
 */
export const CONTACT_FIELDS = [
  {
    key: "kundennummer",
    label: "Kundennummer",
    aliases: ["Kundennummer", "Kundennr", "Kunden-Nr.", "Kd.-Nr.", "customerNumber"],
  },
  {
    key: "lieferantennummer",
    label: "Lieferantennummer",
    aliases: ["Lieferantennummer", "Lieferantennr", "Lieferanten-Nr.", "vendorNumber"],
  },
  // DATEV-Personenkonten (#327): eigene Felder, nicht mehr in Kunden- bzw. Lieferantennummer
  {
    key: "debitorNr",
    label: "Debitor",
    hint: "DATEV-Personenkonto 10000 bis 69999",
    aliases: ["Debitorennummer", "Debitor", "Debitorenkonto", "Debitor-Nr.", "Personenkonto Debitor", "DATEV-Debitor"],
  },
  {
    key: "kreditorNr",
    label: "Kreditor",
    hint: "DATEV-Personenkonto 70000 bis 99999",
    aliases: ["Kreditorennummer", "Kreditor", "Kreditorenkonto", "Kreditor-Nr.", "Personenkonto Kreditor", "DATEV-Kreditor"],
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
    aliases: ["Straße", "Strasse", "Straße und Hausnummer", "Straße Hausnummer", "Straße (Rechnungsadresse)", "Straße 1", "Adresse", "Anschrift", "street"],
  },
  { key: "plz", label: "PLZ", aliases: ["PLZ", "Postleitzahl", "PLZ (Rechnungsadresse)", "PLZ 1", "zip"] },
  { key: "ort", label: "Ort", aliases: ["Ort", "Stadt", "Ort (Rechnungsadresse)", "Ort 1", "city"] },
  {
    key: "land",
    label: "Land",
    hint: "Ländercode wie DE, auch 276 oder „Deutschland“; leer = DE",
    aliases: ["Land", "Ländercode", "Länderkennzeichen", "Land (Rechnungsadresse)", "Land 1", "countryCode", "country"],
  },
  {
    key: "email",
    label: "E-Mail",
    aliases: ["E-Mail", "Email", "E-Mail-Adresse", "E-Mail geschäftlich", "Geschäftlich (E-Mail)", "E-Mail 1", "Mail", "emailAddress"],
  },
  {
    key: "telefon",
    label: "Telefon",
    // „Geschäftlich (Rufnummer)“ in der Vorlage, „Telefon 1“ im Export von Lexware Office
    aliases: ["Telefon", "Telefonnummer", "Tel.", "Rufnummer", "Geschäftlich (Rufnummer)", "Telefon 1", "Telefon geschäftlich", "phoneNumber", "phone"],
  },
  {
    key: "ustId",
    label: "USt-IdNr.",
    // „Umsatzsteuer ID“ in der Vorlage, „Umsatzsteuernummer“ im Export von Lexware Office (dort die USt-IdNr.)
    aliases: ["USt-IdNr.", "USt-IdNr", "USt-ID", "UStIdNr", "Umsatzsteuer-ID", "Umsatzsteuer-Identifikationsnummer", "Umsatzsteuernummer", "vatRegistrationId"],
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
  telefon: string;
  ustId: string;
  iban: string;
  leitwegId: string;
  isCustomer: boolean;
  isSupplier: boolean;
  debitorNr: number | null;
  kreditorNr: number | null;
}

/**
 * Rolle aus der Spalte, sonst aus den Nummern: nur Lieferantennummer bzw. Kreditor = Lieferant, sonst Kunde. `supplierFile`: Die Datei
 * hat eine Spalte Lieferantennummer, aber keine Kundennummer, wie die Lieferanten-Vorlage von Lexware Office; dort darf
 * die Nummer leer bleiben (Lexware-Hilfe, Artikel 548267, Spalte A).
 */
function roles(raw: string, kundennummer: string, lieferantennummer: string, supplierFile: boolean): { isCustomer: boolean; isSupplier: boolean } | string {
  const value = raw.toLowerCase();
  if (!value) {
    const isSupplier = Boolean(lieferantennummer) || (supplierFile && !kundennummer);
    return { isCustomer: Boolean(kundennummer) || !isSupplier, isSupplier };
  }
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
  const supplierFile = mapping.lieferantennummer != null && mapping.kundennummer == null;
  return table.rows.map((row) => {
    const read = rowReader(row, mapping, CONTACT_FIELDS, table.header.length);
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
    const telefon = read.text("telefon");
    const telefonFehler = telefonProblem(telefon);
    if (telefonFehler) errors.push(telefonFehler);
    const debitor = parsePersonenkonto("debitor", read.text("debitorNr"));
    if (!debitor.ok) errors.push(debitor.error);
    const kreditor = parsePersonenkonto("kreditor", read.text("kreditorNr"));
    if (!kreditor.ok) errors.push(kreditor.error);
    // Ein Debitor macht zum Kunden, ein Kreditor zum Lieferanten, wie die Kunden- bzw. Lieferantennummer
    const role = roles(
      read.raw("rolle"),
      kundennummer || (debitor.ok && debitor.value ? String(debitor.value) : ""),
      lieferantennummer || (kreditor.ok && kreditor.value ? String(kreditor.value) : ""),
      supplierFile,
    );
    if (typeof role === "string") errors.push(role);
    // Mehrere Adressen in einer Zelle getrennt mit Komma oder Semikolon, gespeichert wie im Formular mit „, “
    const emails = joinEmails(splitEmails(read.text("email")));
    const ustId = rawUstId ? normalizeUstId(rawUstId) : "";
    // Alle Texte vor der Entscheidung lesen: auch eine Formel in der Straße macht die Zeile fehlerhaft
    const address = { strasse: read.text("strasse"), plz: read.text("plz"), ort: read.text("ort"), leitwegId: read.text("leitwegId") };
    const value: ContactRow | null =
      errors.length > 0 || typeof role === "string" || !land.ok || !debitor.ok || !kreditor.ok
        ? null
        : {
            kundennummer,
            lieferantennummer,
            name,
            ...address,
            land: land.value,
            email: emails,
            telefon: normalizeTelefon(telefon),
            ustId,
            iban: rawIban.replace(/\s+/g, "").toUpperCase(),
            ...role,
            debitorNr: debitor.value,
            kreditorNr: kreditor.value,
          };
    return {
      line: row.line,
      title: name || "(ohne Name)",
      value,
      errors,
      keys: contactKeys({
        kundennummer,
        lieferantennummer,
        name,
        email: emails,
        ustId,
        debitorNr: debitor.ok ? debitor.value : null,
        kreditorNr: kreditor.ok ? kreditor.value : null,
      }),
    };
  });
}

/**
 * Woran ein Kontakt wiedererkannt wird: Kunden- und Lieferantennummer, Debitor und Kreditor, jede E-Mail-Adresse,
 * USt-IdNr. und der Name (Groß- und Kleinschreibung egal, wie beim Abruf aus Lexware Office). Lieber einmal zu viel
 * überspringen als einen Kunden doppelt anlegen; einen gleichnamigen anderen Kunden legt man von Hand an. Eine schon
 * vergebene Personenkontonummer steht so als Konflikt in der Vorschau, statt überschrieben oder doppelt vergeben zu werden.
 */
export function contactKeys(c: {
  kundennummer: string | null;
  lieferantennummer: string | null;
  name: string;
  email: string;
  ustId: string;
  debitorNr?: number | null;
  kreditorNr?: number | null;
}) {
  return [
    ...duplicateKey("Kundennummer", c.kundennummer),
    ...duplicateKey("Lieferantennummer", c.lieferantennummer),
    ...duplicateKey("Debitor", c.debitorNr == null ? null : String(c.debitorNr)),
    ...duplicateKey("Kreditor", c.kreditorNr == null ? null : String(c.kreditorNr)),
    ...splitEmails(c.email).flatMap((e) => duplicateKey("E-Mail", e)),
    ...duplicateKey("USt-IdNr.", c.ustId),
    ...duplicateKey("Name", c.name),
  ];
}
