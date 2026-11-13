import {
  isValidIban,
  joinEmails,
  normalizeTelefon,
  normalizeUstId,
  PERSONENKONTO_BEREICH,
  type PersonenkontoRolle,
  splitEmails,
  telefonProblem,
} from "@haben/core";
import { ustIdImportProblem } from "./csv-import/contacts.ts";
import { type CsvEncoding, type CsvEncodingChoice, decodeCsvBytes, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "./csv-import/read.ts";
import { formulaProblem, parseImportCountry } from "./csv-import/values.ts";
import { isDatevFile, normalizeName, splitLines } from "./datev.ts";

/*
 * DATEV-Stammdaten „Debitoren/Kreditoren“ (EXTF Formatkategorie 16), wie sie sevDesk als EXTF_GP_Stamm_*.csv und andere
 * Programme mit DATEV-Export schreiben. Gelesen wird wie beim Buchungsstapel (datev.ts) nach Spaltennamen, nicht nach
 * Position; die Namen folgen dem Export von sevDesk (extf-gp-stamm.csv in test-fixtures/sevdesk/, 254 Spalten).
 * Personenkonten führt Haben fünfstellig (packages/core/src/personenkonten.ts, DATEV-Kontenrahmen SKR 03/04 2026, S. 36);
 * eine andere Sachkontenlänge lehnt der Parser ab, statt Nummern zu kürzen.
 */

const STAMMDATEN = 16;

export interface DatevGpRow {
  /** Zeile in der Datei; 1 ist die Kopfzeile, 2 die Spaltennamen */
  line: number;
  konto: string;
  /** Aus dem Kontenbereich; null, wenn das Konto kein Personenkonto ist */
  rolle: PersonenkontoRolle | null;
  nr: number | null;
  name: string;
  strasse: string;
  plz: string;
  ort: string;
  land: string;
  email: string;
  telefon: string;
  /** Aus „EU-Mitgliedstaat“ und „EU-UStId.“ zusammengesetzt */
  ustId: string;
  iban: string;
  kundennummer: string;
  steuernummer: string;
  errors: string[];
}

export type DatevStammdatenResult = { ok: true; encoding: CsvEncoding; rows: DatevGpRow[] } | { ok: false; error: string };

/** Erste Zeile als Felder; die Formatkategorie steht in Feld 3, die Sachkontenlänge in Feld 14 */
const headerFields = (text: string) => (splitLines(text.slice(0, 1024))[0]?.fields ?? []).map((f) => f.trim());

export function isDatevStammdaten(bytes: Uint8Array): boolean {
  if (!isDatevFile(bytes)) return false;
  const decoded = decodeCsvBytes(bytes.subarray(0, 1024), "auto");
  return "text" in decoded && headerFields(decoded.text)[2] === String(STAMMDATEN);
}

/** Konto → Rolle nach den Bereichen bei Sachkontenlänge 4; alles andere ist kein Personenkonto */
function personenkonto(konto: string): { rolle: PersonenkontoRolle; nr: number } | null {
  if (!/^\d{5}$/.test(konto)) return null;
  const nr = Number(konto);
  for (const rolle of ["debitor", "kreditor"] as const) {
    const { von, bis } = PERSONENKONTO_BEREICH[rolle];
    if (nr >= von && nr <= bis) return { rolle, nr };
  }
  return null;
}

/**
 * „EU-Mitgliedstaat“ DE und „EU-UStId.“ 136695976 ergeben DE136695976; trägt die Nummer das Kennzeichen schon, bleibt sie.
 * Wie in der Datei, damit eine Meldung den Text der Datei nennt; normalisiert wird beim Speichern.
 */
function rawUstId(country: string, number: string): string {
  if (!number) return "";
  return !country || number.toUpperCase().startsWith(country.toUpperCase()) ? number : `${country}${number}`;
}

const KONTO_FEHLER = (konto: string) =>
  `Konto: „${konto}“ ist kein Personenkonto (Debitor ${PERSONENKONTO_BEREICH.debitor.von} bis ${PERSONENKONTO_BEREICH.debitor.bis}, Kreditor ${PERSONENKONTO_BEREICH.kreditor.von} bis ${PERSONENKONTO_BEREICH.kreditor.bis})`;

function readRow(line: number, get: (name: string) => string): DatevGpRow {
  const errors: string[] = [];
  const text = (name: string, label = name) => {
    const value = get(name);
    const problem = formulaProblem(value, label);
    if (problem) errors.push(problem);
    return value;
  };
  const konto = get("Konto");
  const account = personenkonto(konto);
  if (!konto) errors.push("Konto fehlt");
  else if (!account) errors.push(KONTO_FEHLER(konto));
  // Je Adressatentyp eine eigene Namensspalte; belegt ist jeweils die des Typs
  const person = [get("Vorname (Adressatentyp natürl. Person)"), get("Name (Adressatentyp natürl. Person)")].filter(Boolean).join(" ");
  const name = get("Name (Adressatentyp Unternehmen)") || person || get("Name (Adressatentyp keine Angabe)") || get("Kurzbezeichnung");
  if (!name) errors.push("Name fehlt");
  else {
    const problem = formulaProblem(name, "Name");
    if (problem) errors.push(problem);
  }
  const rawUst = rawUstId(get("EU-Mitgliedstaat"), get("EU-UStId."));
  const ustProblem = rawUst ? ustIdImportProblem(rawUst) : null;
  if (ustProblem) errors.push(ustProblem);
  // „UN“ steht im GP-Stamm von sevDesk bei Kontakten ohne Anschrift (sevDesk zeigt „UNKNOWN“, #472); kein Land, also wie leer
  const rawLand = get("Land");
  const land = parseImportCountry(rawLand.toUpperCase() === "UN" ? "" : rawLand);
  if (!land.ok) errors.push(land.error);
  const rawIban = get("IBAN-Nr. 1");
  if (rawIban && !isValidIban(rawIban)) errors.push(`IBAN: „${rawIban}“ ist ungültig (Prüfziffer oder Länge)`);
  // sevDesk schreibt Telefonnummern mit vorangestelltem Apostroph, damit Excel sie als Text liest (echter GP-Stamm, #472)
  const telefon = text("Telefon").replace(/^'/, "");
  const telefonFehler = telefonProblem(telefon);
  if (telefonFehler) errors.push(telefonFehler);
  return {
    line,
    konto,
    rolle: account?.rolle ?? null,
    nr: account?.nr ?? null,
    name,
    strasse: text("Straße"),
    plz: text("Postleitzahl", "PLZ"),
    ort: text("Ort"),
    land: land.ok ? land.value : "",
    email: joinEmails(splitEmails(text("E-Mail"))),
    telefon: normalizeTelefon(telefon),
    ustId: normalizeUstId(rawUst),
    iban: rawIban.replace(/\s+/g, "").toUpperCase(),
    kundennummer: text("Kundennummer"),
    steuernummer: text("Steuernummer"),
    errors,
  };
}

/** Kopfzeile prüfen: Kategorie 16 und Sachkontenlänge 4 (leer geht, die Bereiche prüft jede Zeile) */
function headerProblem(fields: string[]): string | null {
  const category = fields[2] ?? "";
  if (category !== String(STAMMDATEN)) {
    return `Das ist ein DATEV-Export „${fields[3] || `Kategorie ${category}`}“, keine Debitoren/Kreditoren.`;
  }
  const length = fields[13] ?? "";
  if (length !== "" && length !== "4") {
    return `Die Kopfzeile nennt Sachkontenlänge ${length}. Haben führt Personenkonten fünfstellig (Sachkontenlänge 4) und kürzt keine Nummern; exportiere die Datei mit Sachkontenlänge 4.`;
  }
  return null;
}

export function parseDatevStammdaten(bytes: Uint8Array, encoding: CsvEncodingChoice = "auto"): DatevStammdatenResult {
  if (bytes.length === 0) return { ok: false, error: "Die Datei ist leer." };
  if (bytes.length > MAX_IMPORT_BYTES) return { ok: false, error: "Die Datei ist größer als 5 MB." };
  if (!isDatevFile(bytes)) return { ok: false, error: "Keine DATEV-Datei: Kopfzeile beginnt nicht mit EXTF." };
  const decoded = decodeCsvBytes(bytes, encoding);
  if ("error" in decoded) return { ok: false, error: decoded.error };
  const [head, columns, ...data] = splitLines(decoded.text);
  const problem = headerProblem((head?.fields ?? []).map((f) => f.trim()));
  if (problem) return { ok: false, error: problem };
  const names = (columns?.fields ?? []).map((t) => normalizeName(t.replace(/\s+/g, " ").trim()));
  if (!names.includes(normalizeName("Konto"))) return { ok: false, error: "Zeile 2: Spalte „Konto“ fehlt." };
  const filled = data.filter((l) => l.fields.some((f) => f.trim() !== ""));
  if (filled.length === 0) return { ok: false, error: "Die Datei enthält keine Geschäftspartner." };
  if (filled.length > MAX_IMPORT_ROWS) return { ok: false, error: `Höchstens ${MAX_IMPORT_ROWS} Zeilen je Datei; teile die Datei auf.` };
  const rows = filled.map(({ line, fields }) =>
    readRow(line, (name) => {
      const i = names.indexOf(normalizeName(name));
      return i < 0 ? "" : (fields[i] ?? "").trim();
    }),
  );
  return { ok: true, encoding: decoded.encoding, rows };
}
