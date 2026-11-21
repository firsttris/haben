import { getTableColumns, type Table } from "drizzle-orm";
// Direkt aus dem Schema statt über db/index.ts: felder.test.ts läuft ohne Datenbank
import * as schema from "../../db/schema.ts";

/*
 * Welche Spalten der Export der Einstellungen mitnimmt (#488) und welche er bewusst auslässt, je Tabelle mit Grund.
 * felder.test.ts prüft, dass jede Spalte in genau einer der beiden Listen steht: Eine neue Spalte muss jemand
 * zuordnen, statt still mitzugehen oder still zu fehlen. Zugangsdaten bleiben draußen, die richtet man in der neuen
 * Instanz bewusst neu ein; ebenso alles, was nur für diese Instanz gilt (Bestätigungen, Freigaben, Zählerstände).
 */

type Spalte<T extends Table> = keyof T["_"]["columns"] & string;

type Felder<T extends Table, K extends Spalte<T>> = {
  table: T;
  mit: readonly K[];
  ohne: Partial<Record<Exclude<Spalte<T>, K>, string>>;
};

const felder = <T extends Table, const K extends Spalte<T>>(
  table: T,
  mit: readonly K[],
  ohne: Partial<Record<Exclude<Spalte<T>, K>, string>>,
): Felder<T, K> => ({
  table,
  mit,
  ohne,
});

const ANGELEGT = "Zeitpunkt der Anlage in dieser Instanz";
const GEAENDERT = "Zeitpunkt der letzten Änderung in dieser Instanz";
const ANGELEGT_VON = "Person aus dieser Instanz";
const EINE_ZEILE = "Tabelle mit genau einer Zeile";

export const FELDER = {
  company: felder(
    schema.company,
    [
      "name",
      "strasse",
      "plz",
      "ort",
      "email",
      "telefon",
      "steuernummer",
      "ustId",
      "finanzamt",
      "bundesland",
      "versteuerung",
      "kleinunternehmer",
      "ohneVorsteuerabzug",
      "kontenrahmen",
      "rechtsform",
      "sitz",
      "registergericht",
      "registernummer",
      "geschaeftsfuehrer",
      "aufsichtsratVorsitz",
      "bank",
      "iban",
      "bic",
      "kontoinhaber",
      "glaeubigerId",
      "foundedOn",
      "einkunftsart",
      "taetigkeit",
      "paymentTermDays",
      "skonto",
      "defaultFormat",
      "paymentPlanTemplates",
      "invoiceNumberFormat",
      "quoteNumberFormat",
      "invoiceCounterRunning",
      "quoteCounterRunning",
      "customerNumberFormat",
      // Die Kontakte behalten ihre Kundennummern, der Zähler muss dahinter weiterlaufen
      "customerNumberNext",
      "datevBeraterNr",
      "datevMandantNr",
      "datevPersonenkontenAb",
      "taxpayer",
      "privateShares",
      "dunning",
      "tageskurs",
      "navColor",
      "navLogo",
      "archiveSearch",
      // Nur ob die Firmendaten bewusst gespeichert waren: Der Import setzt den Zeitpunkt dann neu, sonst bleibt er leer
      "companySavedAt",
    ],
    {
      id: EINE_ZEILE,
      journalAb: "Gelesen wird es nicht mehr (#1116), es entfällt mit modules/umstellung",
      calendarTokenHash: "Kalender-Abo der Fristen ist ein Zugang, in der neuen Instanz neu anlegen",
      calendarTokenCreatedBy: "Gehört zum Kalender-Abo",
      calendarTokenResponsibleId: "Gehört zum Kalender-Abo",
      calendarTokenDisabledAt: "Gehört zum Kalender-Abo",
      calendarTokenDisabledReason: "Gehört zum Kalender-Abo",
      mcpEnabled: "Zugang für KI-Assistenten und API schaltet man in der neuen Instanz bewusst ein",
      invoiceCounterPerCustomer: "Zähler je Kunde bleibt eine Einstellung der Instanz; die Kreise hängen an den Kontakten und zählen dort neu (#1426)",
      quoteCounterPerCustomer: "Zähler je Kunde bleibt eine Einstellung der Instanz; die Kreise hängen an den Kontakten und zählen dort neu (#1426)",
      elsterDatenschutzAt: "Bestätigung der Datenschutzhinweise gilt für die Instanz, in der sie gegeben wurde (ERiC-Lizenz § 5)",
      updatedAt: GEAENDERT,
    },
  ),
  einrichtung: felder(schema.einrichtung, ["ausgeblendeteBereiche", "fragenAt", "offen"], { id: EINE_ZEILE, updatedAt: GEAENDERT }),
  letterheadProfiles: felder(schema.letterheadProfiles, ["id", "name", "isDefault", "settings"], { updatedAt: GEAENDERT }),
  companyLogo: felder(schema.companyLogo, ["format", "logo"], { id: EINE_ZEILE, sha256: "Ergibt sich aus der Datei", createdAt: ANGELEGT }),
  letterheadBackground: felder(schema.letterheadBackground, ["format", "background"], {
    id: EINE_ZEILE,
    sha256: "Ergibt sich aus der Datei",
    createdAt: ANGELEGT,
  }),
  belegLayouts: felder(schema.belegLayouts, ["id", "name", "art", "source", "schemaVersion", "packages"], {
    sha256: "Ergibt sich aus dem Quelltext",
    approvedSha256: "Ergibt sich beim Import aus dem Quelltext; die Pakete lädt man in der neuen Instanz auf Klick nach, wie nach einem Restore",
    createdAt: ANGELEGT,
    updatedAt: GEAENDERT,
  }),
  units: felder(schema.units, ["id", "label", "code", "archivedAt"], { createdAt: ANGELEGT }),
  articles: felder(
    schema.articles,
    ["id", "number", "description", "detail", "unit", "unitPrice", "taxRate", "priceIncludesTax", "note", "sevdeskId", "archivedAt"],
    { createdAt: ANGELEGT, updatedAt: GEAENDERT },
  ),
  contacts: felder(
    schema.contacts,
    [
      "id",
      "kundennummer",
      "isCustomer",
      "isSupplier",
      "lieferantennummer",
      "name",
      "strasse",
      "plz",
      "ort",
      "land",
      "email",
      "telefon",
      "ustId",
      "iban",
      "leitwegId",
      "unsereLieferantennummer",
      "defaultFormat",
      "skonto",
      "language",
      // Herkunft aus einem Umzug: Holt die neue Instanz das Archiv aus demselben Programm, findet sie den Kontakt wieder
      "lexofficeId",
      "sevdeskId",
      "fastbillId",
      "debitorNr",
      "kreditorNr",
      "hourlyRateCents",
      "archivedAt",
    ],
    { version: "Zählt die Fassungen für festgeschriebene Belege dieser Instanz, beginnt neu", createdAt: ANGELEGT, updatedAt: GEAENDERT },
  ),
  contactPersons: felder(schema.contactPersons, ["id", "contactId", "name", "email", "telefon", "funktion", "deactivatedAt"], {
    createdBy: ANGELEGT_VON,
    createdAt: ANGELEGT,
  }),
  textBlocks: felder(schema.textBlocks, ["id", "name", "kind", "text", "contactId", "standardFuer", "archivedAt"], {
    createdAt: ANGELEGT,
    updatedAt: GEAENDERT,
  }),
  ownAccounts: felder(schema.ownAccounts, ["id", "kontenrahmen", "account", "name", "parentCategory", "archivedAt"], {
    createdBy: ANGELEGT_VON,
    createdAt: ANGELEGT,
    updatedAt: GEAENDERT,
  }),
  mailSettings: felder(schema.mailSettings, ["fromAddress", "fromName", "reminderTo", "remindersEnabled", "reminderDays", "templates", "pruefwertMail"], {
    id: EINE_ZEILE,
    transport: "Zugang zum Versand, in der neuen Instanz neu einrichten",
    host: "Zugang zum Versand",
    port: "Zugang zum Versand",
    secure: "Zugang zum Versand",
    username: "Zugang zum Versand",
    ciphertext: "Geheimnis",
    graphTenantId: "Zugang zum Versand",
    graphClientId: "Zugang zum Versand",
    graphAuth: "Zugang zum Versand",
    graphThumbprint: "Zugang zum Versand",
    graphMailbox: "Zugang zum Versand",
    updatedAt: GEAENDERT,
  }),
  quoteDefaultAttachments: felder(schema.quoteDefaultAttachments, ["filename", "mimeType", "sha256"], {
    id: "Die neue Instanz vergibt eigene",
    size: "Ergibt sich aus der Datei",
    createdAt: ANGELEGT,
  }),
  customPages: felder(schema.customPages, ["name", "url", "openInNewTab"], { id: "Nichts verweist darauf", createdAt: ANGELEGT, updatedAt: GEAENDERT }),
  // Fragt die Einrichtung ab; ohne ihn stünde die neue Instanz ohne Rückfrage auf „monatlich“
  vatFrequencies: felder(schema.vatFrequencies, ["year", "fromMonth", "frequency"], { updatedAt: GEAENDERT }),
  procedureDetails: felder(
    schema.procedureDetails,
    ["verantwortlich", "datensicherung", "aufbewahrungsort", "papierbelege", "serverbetrieb", "schluesselablage", "ergaenzungen"],
    { id: EINE_ZEILE, updatedAt: GEAENDERT },
  ),
} as const;

/** Die Spalten aus `mit` als Auswahl für `db.select(…)` */
export function auswahl<T extends Table, K extends Spalte<T>>({ table, mit }: Felder<T, K>): Pick<T["_"]["columns"], K> {
  const alle = getTableColumns(table);
  return Object.fromEntries(mit.map((key) => [key, alle[key]])) as Pick<T["_"]["columns"], K>;
}
