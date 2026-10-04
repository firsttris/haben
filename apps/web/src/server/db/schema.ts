import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  customType,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  index,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { Buyer, Seller } from "@haben/einvoice";
import {
  ASSET_KIND_KEYS,
  ASSET_METHOD_KEYS,
  TAX_TREATMENT_KEYS,
  type AssetKind,
  type AssetMethod,
  type CarPrivateUse,
} from "@haben/core";

export * from "./auth-schema.ts";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const bundeslandEnum = pgEnum("bundesland", [
  "BW", "BY", "BE", "BB", "HB", "HH", "HE", "MV",
  "NI", "NW", "RP", "SL", "SN", "ST", "SH", "TH",
]);

export const versteuerungEnum = pgEnum("versteuerung", ["ist", "soll"]);

export const kontenrahmenEnum = pgEnum("kontenrahmen", ["SKR03", "SKR04"]);

export const invoiceFormatEnum = pgEnum("invoice_format", ["zugferd", "xrechnung-cii", "xrechnung-ubl"]);

export interface TaxpayerPerson {
  idnr: string;
  anrede: "Herrn" | "Frau";
  vorname: string;
  name: string;
  /** JJJJ-MM-TT */
  geburtsdatum: string;
  /** Religionsschlüssel laut ELSTER, z. B. "11" (keine) */
  religion: string;
  beruf: string;
}

export interface TaxpayerData {
  a?: TaxpayerPerson;
  b?: TaxpayerPerson;
  veranlagung?: "einzel" | "zusammen";
  /** JJJJ-MM-TT */
  verheiratetSeit?: string;
}

/** Firmendaten, genau eine Zeile (id = 1). */
export const company = pgTable(
  "company",
  {
    id: smallint("id").primaryKey().default(1),
    name: text("name").notNull().default(""),
    strasse: text("strasse").notNull().default(""),
    plz: text("plz").notNull().default(""),
    ort: text("ort").notNull().default(""),
    email: text("email").notNull().default(""),
    steuernummer: text("steuernummer").notNull().default(""),
    ustId: text("ust_id").notNull().default(""),
    finanzamt: text("finanzamt").notNull().default(""),
    bundesland: bundeslandEnum("bundesland"),
    versteuerung: versteuerungEnum("versteuerung").notNull().default("ist"),
    telefon: text("telefon").notNull().default(""),
    bank: text("bank").notNull().default(""),
    iban: text("iban").notNull().default(""),
    bic: text("bic").notNull().default(""),
    kontenrahmen: kontenrahmenEnum("kontenrahmen").notNull().default("SKR03"),
    paymentTermDays: smallint("payment_term_days").notNull().default(14),
    defaultFormat: invoiceFormatEnum("default_format").notNull().default("zugferd"),
    /** Kleinunternehmer nach § 19 UStG: Rechnungen ohne Umsatzsteuer, keine Voranmeldung, kein Vorsteuerabzug */
    kleinunternehmer: boolean("kleinunternehmer").notNull().default(false),
    /** Für die Anlage EÜR: Einkunftsart und Art des Betriebs */
    einkunftsart: text("einkunftsart", { enum: ["gewerbe", "selbstaendig"] }),
    taetigkeit: text("taetigkeit").notNull().default(""),
    /** Für den DATEV-Export: Nummern bei der Steuerberatung */
    datevBeraterNr: text("datev_berater_nr").notNull().default(""),
    datevMandantNr: text("datev_mandant_nr").notNull().default(""),
    /** Persönliche Angaben für ELSTER (Bankverbindung, Einkommensteuer): Person A, ggf. Ehegatte B */
    taxpayer: jsonb("taxpayer").$type<TaxpayerData>().notNull().default({}),
    /** Vorgabe für den Privatanteil in Prozent je Belegkategorie, z. B. { telefon: 20 } */
    privateShares: jsonb("private_shares").$type<Record<string, number>>().notNull().default({}),
    /**
     * Mahnwesen: Basiszinssatz in Basispunkten (null = keine Verzugszinsen), Mahngebühr je Stufe in Cent,
     * Zahlungsfrist in Tagen
     */
    dunning: jsonb("dunning")
      .$type<{ baseRate: number | null; fees: Record<"1" | "2" | "3", number>; deadlineDays: number }>()
      .notNull()
      .default({ baseRate: null, fees: { "1": 0, "2": 0, "3": 0 }, deadlineDays: 10 }),
    /** SHA-256 des geheimen Tokens im Kalender-Abo der Fristen; null = kein Abo */
    calendarTokenHash: text("calendar_token_hash"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("company_single_row", sql`${t.id} = 1`)],
);

/** ELSTER-Zertifikatsdatei (.pfx), AES-256-GCM-verschlüsselt. */
export const elsterCertificates = pgTable("elster_certificates", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: text("filename").notNull(),
  ciphertext: bytea("ciphertext").notNull(),
  validUntil: date("valid_until", { mode: "string" }),
  /** PIN für den automatischen Postfachabruf, nur auf Wunsch, verschlüsselt wie das Zertifikat */
  pinCiphertext: bytea("pin_ciphertext"),
  pinSavedAt: timestamp("pin_saved_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vatReturnStatusEnum = pgEnum("vat_return_status", ["draft", "sent"]);

/**
 * Umsatzsteuer-Voranmeldungen. Beträge in Cent.
 * Nach erfolgreicher Echtübermittlung gesetztes locked_at sperrt die Zeile (Trigger).
 */
export const vatReturns = pgTable(
  "vat_returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    year: smallint("year").notNull(),
    month: smallint("month").notNull(),
    kz81: integer("kz81").notNull().default(0),
    kz86: integer("kz86").notNull().default(0),
    /** Umsätze ohne Steuer: Reverse Charge im EU-Ausland, nicht steuerbar, steuerfrei ohne Vorsteuerabzug */
    kz21: integer("kz21").notNull().default(0),
    kz45: integer("kz45").notNull().default(0),
    kz48: integer("kz48").notNull().default(0),
    kz66: integer("kz66").notNull().default(0),
    /** § 13b als Leistungsempfänger: Bemessungsgrundlagen 46/84, Steuer 47/85, Vorsteuer 67 */
    kz46: integer("kz46").notNull().default(0),
    kz47: integer("kz47").notNull().default(0),
    kz84: integer("kz84").notNull().default(0),
    kz85: integer("kz85").notNull().default(0),
    kz67: integer("kz67").notNull().default(0),
    kz83: integer("kz83").notNull().default(0),
    status: vatReturnStatusEnum("status").notNull().default("draft"),
    /** Berichtigte Anmeldung (Kz 10) */
    berichtigt: boolean("berichtigt").notNull().default(false),
    /** Kennzahlen aus den Buchungen berechnet oder von Hand überschrieben */
    source: text("source", { enum: ["berechnet", "manuell"] }).notNull().default("manuell"),
    overrideReason: text("override_reason"),
    /** Berechnete Werte zum Zeitpunkt des Speicherns, zum Nachvollziehen einer Überschreibung */
    computed: jsonb("computed").$type<{
      kz81: number;
      kz86: number;
      kz21?: number;
      kz45?: number;
      kz48?: number;
      kz66: number;
      kz46?: number;
      kz47?: number;
      kz84?: number;
      kz85?: number;
      kz67?: number;
      kz83: number;
    }>(),
    correctsId: uuid("corrects_id"),
    transferTicket: text("transfer_ticket"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("vat_returns_month", sql`${t.month} between 1 and 12`),
    // höchstens ein Entwurf je Zeitraum
    uniqueIndex("vat_returns_one_draft_per_period")
      .on(t.year, t.month)
      .where(sql`${t.status} = 'draft'`),
  ],
);

/** Jede Prüfung oder Übermittlung an ELSTER, nur anhängen. */
export const vatReturnSubmissions = pgTable("vat_return_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  vatReturnId: uuid("vat_return_id")
    .notNull()
    .references(() => vatReturns.id),
  kind: text("kind", { enum: ["validate", "test", "send"] }).notNull(),
  ok: boolean("ok").notNull(),
  code: integer("code").notNull(),
  message: text("message").notNull(),
  transferTicket: text("transfer_ticket"),
  requestXml: text("request_xml").notNull(),
  responseXml: text("response_xml").notNull(),
  serverResponseXml: text("server_response_xml").notNull(),
  protocolPdf: bytea("protocol_pdf"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Prüfungen und Übermittlungen der Jahreserklärungen (Umsatzsteuererklärung, Anlage EÜR), nur anhängen.
 * `figures` hält die gesendeten Werte fest, unabhängig davon, wie sich die Buchungen später ändern.
 */
export const annualSubmissions = pgTable(
  "annual_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    form: text("form", { enum: ["ust", "euer", "est"] }).notNull(),
    year: smallint("year").notNull(),
    kind: text("kind", { enum: ["validate", "test", "send"] }).notNull(),
    ok: boolean("ok").notNull(),
    code: integer("code").notNull(),
    message: text("message").notNull(),
    transferTicket: text("transfer_ticket"),
    figures: jsonb("figures").$type<Record<string, unknown>>().notNull(),
    requestXml: text("request_xml").notNull(),
    responseXml: text("response_xml").notNull(),
    serverResponseXml: text("server_response_xml").notNull(),
    protocolPdf: bytea("protocol_pdf"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("annual_submissions_form_year").on(t.form, t.year),
    // Je Erklärung und Jahr höchstens eine erfolgreiche Echtübermittlung
    uniqueIndex("annual_submissions_sent").on(t.form, t.year).where(sql`${t.kind} = 'send' and ${t.ok}`),
  ],
);

/**
 * Nachrichten an das Finanzamt über ELSTER (Sonstige Nachricht), etwa der Antrag auf Herabsetzung der
 * Vorauszahlungen; jede Prüfung und Übermittlung mit XML, nur anhängen.
 */
export const elsterMessages = pgTable("elster_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  topic: text("topic", { enum: ["nachricht", "vorauszahlung", "bankverbindung"] }).notNull(),
  betreff: text("betreff").notNull(),
  text: text("text").notNull(),
  /** Beim Antrag auf Herabsetzung: die Zahlen, auf die er sich stützt */
  figures: jsonb("figures").$type<Record<string, unknown>>(),
  kind: text("kind", { enum: ["validate", "test", "send"] }).notNull(),
  ok: boolean("ok").notNull(),
  code: integer("code").notNull(),
  message: text("message").notNull(),
  transferTicket: text("transfer_ticket"),
  requestXml: text("request_xml").notNull(),
  responseXml: text("response_xml").notNull(),
  serverResponseXml: text("server_response_xml").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Angaben zur Einkommensteuererklärung je Jahr, die nicht aus der Buchhaltung kommen (Vorsorge, Sonderausgaben, Kinder …) */
export const incomeTaxInputs = pgTable("income_tax_inputs", {
  year: smallint("year").primaryKey(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Abrufe des ELSTER-Postfachs (PostfachAnfrage) und Bestätigungen der Abholung (PostfachBestaetigung) */
export const postfachRequests = pgTable("postfach_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  art: text("art", { enum: ["anfrage", "bestaetigung"] }).notNull(),
  test: boolean("test").notNull(),
  ok: boolean("ok").notNull(),
  code: integer("code").notNull(),
  message: text("message").notNull(),
  /** anfrage: vollständig abgeholte Bereitstellungen; bestaetigung: die bestätigten */
  bereitstellungIds: text("bereitstellung_ids").array().notNull().default(sql`'{}'::text[]`),
  /** Fehler beim Download einzelner Anhänge */
  fehler: jsonb("fehler").$type<{ referenzId: string; fehler: string }[]>().notNull().default([]),
  requestXml: text("request_xml").notNull(),
  responseXml: text("response_xml").notNull(),
  serverResponseXml: text("server_response_xml").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Aus dem ELSTER-Postfach abgeholte Dokumente: Bescheide und Mitteilungen des Finanzamts */
export const postfachDocuments = pgTable("postfach_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  referenzId: text("referenz_id").notNull().unique(),
  bereitstellungId: text("bereitstellung_id").notNull(),
  datenart: text("datenart").notNull(),
  veranlagungszeitraum: text("veranlagungszeitraum").notNull(),
  steuernummer: text("steuernummer").notNull(),
  bescheiddatum: text("bescheiddatum").notNull(),
  dateibezeichnung: text("dateibezeichnung").notNull(),
  mimeType: text("mime_type").notNull(),
  filename: text("filename").notNull(),
  sha256: text("sha256").notNull(),
  size: integer("size").notNull(),
  test: boolean("test").notNull(),
  requestId: uuid("request_id")
    .notNull()
    .references(() => postfachRequests.id),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Belegabrufe für die vorausgefüllte Steuererklärung (VaSt): Anfrage der Liste und Abholung der Belege */
export const vastRequests = pgTable("vast_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** a = steuerpflichtige Person, b = Ehegatte */
  person: text("person", { enum: ["a", "b"] }).notNull(),
  idnr: text("idnr").notNull(),
  year: smallint("year").notNull(),
  test: boolean("test").notNull(),
  ok: boolean("ok").notNull(),
  code: integer("code").notNull(),
  message: text("message").notNull(),
  /** Fehler beim Abholen oder Entschlüsseln einzelner Belege */
  fehler: jsonb("fehler").$type<{ id: string; fehler: string }[]>().notNull().default([]),
  requestXml: text("request_xml").notNull(),
  responseXml: text("response_xml").notNull(),
  serverResponseXml: text("server_response_xml").notNull(),
  /** Zweiter Schritt, nur wenn Belege vorlagen */
  abholung: jsonb("abholung").$type<{ requestXml: string; responseXml: string; serverResponseXml: string }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Abgeholte und entschlüsselte Belege: Lohnsteuerbescheinigung, Rentenbezüge, Beiträge … */
export const vastBelege = pgTable("vast_belege", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** ID bei ELSTER; ein geänderter Beleg kommt mit neuer ID */
  belegId: text("beleg_id").notNull().unique(),
  person: text("person", { enum: ["a", "b"] }).notNull(),
  idnr: text("idnr").notNull(),
  year: smallint("year").notNull(),
  belegart: text("belegart").notNull(),
  schemaversion: text("schemaversion").notNull(),
  hashwert: text("hashwert").notNull(),
  /** Entschlüsseltes Beleg-XML */
  xml: text("xml").notNull(),
  test: boolean("test").notNull(),
  requestId: uuid("request_id")
    .notNull()
    .references(() => vastRequests.id),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Berechtigungen zum Belegabruf für andere Personen (ElsterBRM): Antrag, Freischaltung, Widerruf, Liste */
export const brmRequests = pgTable("brm_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  art: text("art", { enum: ["antrag", "freischaltung", "storno", "liste"] }).notNull(),
  /** Steuer-IdNr der Person, deren Belege abgerufen werden sollen; leer bei der Liste */
  dateninhaberIdnr: text("dateninhaber_idnr"),
  antragsId: text("antrags_id"),
  /** Status laut ELSTER nach diesem Schritt: offen, genehmigt, widerrufen … */
  status: text("status"),
  /** Antrag: bis wann der Freischaltcode einzugeben ist; JJJJ-MM-TT */
  genehmigenBis: text("genehmigen_bis"),
  /** Antrag: bis wann die Berechtigung gilt; JJJJ-MM-TT */
  gueltigBis: text("gueltig_bis"),
  /** Nur bei der Liste: alle Anträge laut ELSTER */
  liste: jsonb("liste").$type<{ antragsId: string; status: string; dateninhaberIdnr: string; gueltigBis: string; jahre: number[] }[]>(),
  test: boolean("test").notNull(),
  ok: boolean("ok").notNull(),
  code: integer("code").notNull(),
  message: text("message").notNull(),
  requestXml: text("request_xml").notNull(),
  responseXml: text("response_xml").notNull(),
  serverResponseXml: text("server_response_xml").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** SMTP-Zugang für E-Mails von Haben (Erinnerungen an Fristen), genau eine Zeile (id = 1) */
export const mailSettings = pgTable(
  "mail_settings",
  {
    id: smallint("id").primaryKey().default(1),
    host: text("host").notNull(),
    port: integer("port").notNull(),
    /** true: TLS ab Verbindungsaufbau (meist Port 465); false: STARTTLS (meist Port 587) */
    secure: boolean("secure").notNull(),
    username: text("username").notNull(),
    /** Passwort AES-256-GCM-verschlüsselt wie das Zertifikat; bleibt aus dem Audit-Log */
    ciphertext: bytea("ciphertext").notNull(),
    fromAddress: text("from_address").notNull(),
    /** Empfänger der Erinnerungen */
    reminderTo: text("reminder_to").notNull(),
    remindersEnabled: boolean("reminders_enabled").notNull().default(true),
    /** Erinnern so viele Tage vor einer Frist, 0 = am Tag selbst */
    reminderDays: smallint("reminder_days").array().notNull().default(sql`'{7,1}'::smallint[]`),
    /** Vorlagen für Rechnungen und Mahnungen; leer = Standardtext. Platzhalter wie {nummer}, {betrag} */
    invoiceSubject: text("invoice_subject").notNull().default(""),
    invoiceBody: text("invoice_body").notNull().default(""),
    dunningSubject: text("dunning_subject").notNull().default(""),
    dunningBody: text("dunning_body").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("mail_settings_single_row", sql`${t.id} = 1`)],
);

/** Postfach für eingehende Belege (IMAP); Passwort verschlüsselt wie beim SMTP-Zugang */
export const inboxSettings = pgTable(
  "inbox_settings",
  {
    id: smallint("id").primaryKey().default(1),
    host: text("host").notNull(),
    port: integer("port").notNull(),
    /** true: TLS ab Verbindungsaufbau (Port 993); false: STARTTLS (Port 143) */
    secure: boolean("secure").notNull(),
    username: text("username").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    /** Ordner, aus dem Haben ungelesene Mails holt */
    folder: text("folder").notNull().default("INBOX"),
    enabled: boolean("enabled").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("inbox_settings_single_row", sql`${t.id} = 1`)],
);

/** Abgerufene Mails mit den daraus angelegten Belegen; je Message-ID genau einmal */
export const inboxMessages = pgTable("inbox_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: text("message_id").notNull().unique(),
  sender: text("sender").notNull(),
  subject: text("subject").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  /** Neu angelegte Belege */
  documentIds: uuid("document_ids").array().notNull().default(sql`'{}'::uuid[]`),
  /** Anhänge, die schon als Beleg vorhanden waren */
  duplicates: integer("duplicates").notNull().default(0),
  /** Übersprungene Anhänge mit Grund */
  skipped: text("skipped").array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Gesendete E-Mails; Fristen-Erinnerungen merken sich, welche Frist zu welcher Stufe schon erinnert wurde */
export const mailLog = pgTable("mail_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind", { enum: ["test", "fristen", "rechnung", "mahnung", "angebot"] }).notNull(),
  /** Empfänger, bei mehreren durch Komma getrennt */
  recipient: text("recipient").notNull(),
  /** Blindkopie an sich selbst */
  bcc: text("bcc"),
  invoiceId: uuid("invoice_id").references(() => invoices.id),
  dunningId: uuid("dunning_id").references(() => dunnings.id),
  quoteId: uuid("quote_id").references(() => quotes.id),
  /** Dateinamen der Anhänge */
  attachments: text("attachments").array().notNull().default(sql`'{}'::text[]`),
  subject: text("subject").notNull(),
  ok: boolean("ok").notNull(),
  error: text("error"),
  /** Fristen-ID und Tage vorher, z. B. ustva-2026-09:7 */
  reminderKeys: text("reminder_keys").array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Pauschalen ohne Beleg (Homeoffice-Tagespauschale, Fahrten mit dem Privatfahrzeug, Verpflegungsmehraufwand),
 * gebucht Aufwand an Privateinlage. Nur anhängen: ein Storno ist eine eigene Zeile mit negativem Betrag.
 */
export const pauschalen = pgTable("pauschalen", {
  id: uuid("id").primaryKey().defaultRandom(),
  art: text("art", { enum: ["homeoffice", "fahrt", "verpflegung"] }).notNull(),
  /** Homeoffice: letzter Tag des Monats; sonst der Tag der Fahrt bzw. Reise */
  date: date("date", { mode: "string" }).notNull(),
  /** Anlass, Ziel, Kunde */
  description: text("description").notNull(),
  /** Homeoffice: { tage }; Fahrt: { km, fahrzeug, hinUndZurueck }; Verpflegung: { tag, fruehstueck, mittag, abend } */
  details: jsonb("details").$type<Record<string, string | number | boolean>>().notNull(),
  /** Cent; beim Storno negativ */
  amount: integer("amount").notNull(),
  /** Storno: die aufgehobene Pauschale */
  reversesId: uuid("reverses_id"),
  journalEntryId: uuid("journal_entry_id")
    .notNull()
    .references(() => journalEntries.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Kassenbuch: jede Bewegung der Barkasse mit fortlaufender Nummer, nur anhängen. Bar bezahlte Belege
 * stehen hier mit ihrem Beleg; Einlagen, Entnahmen und Geldtransit von und zur Bank ohne Beleg.
 * Korrekturen nur per Storno (Gegenzeile).
 */
export const cashEntries = pgTable(
  "cash_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Lfd. Nr. im Kassenbuch, lückenlos */
    number: integer("number").notNull().unique(),
    date: date("date", { mode: "string" }).notNull(),
    /** Cent; Eingang positiv, Ausgang negativ */
    amount: integer("amount").notNull(),
    kind: text("kind", { enum: ["beleg", "einlage", "entnahme", "abhebung", "einzahlung"] }).notNull(),
    text: text("text").notNull(),
    documentId: uuid("document_id").references(() => documents.id),
    /** Storno: die aufgehobene Zeile */
    reversesId: uuid("reverses_id"),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("cash_entries_document").on(t.documentId), uniqueIndex("cash_entries_reverses").on(t.reversesId)],
);

/** Jede Änderung mit altem und neuem Wert, per Trigger befüllt, nur anhängen. */
export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actor: text("actor"),
  tableName: text("table_name").notNull(),
  rowId: text("row_id"),
  action: text("action", { enum: ["INSERT", "UPDATE", "DELETE"] }).notNull(),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
});

/** Kunden und Lieferanten. Jede Änderung legt per Trigger eine Version in contact_versions ab. */
export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  kundennummer: text("kundennummer"),
  name: text("name").notNull(),
  strasse: text("strasse").notNull().default(""),
  plz: text("plz").notNull().default(""),
  ort: text("ort").notNull().default(""),
  land: text("land").notNull().default("DE"),
  email: text("email").notNull().default(""),
  ustId: text("ust_id").notNull().default(""),
  iban: text("iban").notNull().default(""),
  leitwegId: text("leitweg_id").notNull().default(""),
  defaultFormat: invoiceFormatEnum("default_format"),
  /** Sprache von Rechnungen und Angeboten an diesen Kontakt */
  language: text("language", { enum: ["de", "en"] }).notNull().default("de"),
  /** Herkunft aus dem Lexoffice-Import, damit alte Rechnungen und Belege ihm zugeordnet bleiben */
  lexofficeId: text("lexoffice_id").unique(),
  version: integer("version").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Stand eines Kontakts je Version, nur anhängen */
export const contactVersions = pgTable(
  "contact_versions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    version: integer("version").notNull(),
    data: jsonb("data").$type<Record<string, string | number | null>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("contact_versions_contact_version").on(t.contactId, t.version)],
);

export const invoiceKindEnum = pgEnum("invoice_kind", ["rechnung", "storno", "korrektur"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "final"]);

/** Ausgangsrechnungen. Beträge in Cent, bei Storno und Korrektur negativ. */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: invoiceKindEnum("kind").notNull().default("rechnung"),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    /** Erst beim Festschreiben vergeben */
    number: text("number").unique(),
    numberYear: smallint("number_year"),
    numberCounter: integer("number_counter"),
    contactId: uuid("contact_id").references(() => contacts.id),
    contactVersion: integer("contact_version"),
    issueDate: date("issue_date", { mode: "string" }).notNull(),
    serviceFrom: date("service_from", { mode: "string" }),
    serviceTo: date("service_to", { mode: "string" }),
    paymentTermDays: smallint("payment_term_days").notNull().default(14),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    format: invoiceFormatEnum("format").notNull().default("zugferd"),
    note: text("note").notNull().default(""),
    /** Sprache des PDFs */
    language: text("language", { enum: ["de", "en"] }).notNull().default("de"),
    /** Umsatzsteuerliche Behandlung; außer „regulaer“ stehen alle Positionen auf 0 % */
    taxTreatment: text("tax_treatment", { enum: TAX_TREATMENT_KEYS }).notNull().default("regulaer"),
    /** Eigener Befreiungsgrund auf der Rechnung, sonst der Standardtext der Behandlung */
    exemptionReason: text("exemption_reason").notNull().default(""),
    correctsId: uuid("corrects_id"),
    /** Abschlags- oder Schlussrechnung; nur bei kind „rechnung“ */
    variant: text("variant", { enum: ["abschlag", "schluss"] }),
    net: integer("net").notNull().default(0),
    tax: integer("tax").notNull().default(0),
    gross: integer("gross").notNull().default(0),
    /** Verkäufer und Käufer, wie sie auf der festgeschriebenen Rechnung stehen */
    seller: jsonb("seller").$type<Seller>(),
    buyer: jsonb("buyer").$type<Buyer>(),
    pdf: bytea("pdf"),
    pdfSha256: text("pdf_sha256"),
    xml: text("xml"),
    xmlSha256: text("xml_sha256"),
    /** Aus einer wiederkehrenden Rechnung erzeugt, mit dem Termin; je Termin genau eine Rechnung */
    recurringId: uuid("recurring_id"),
    recurringDate: date("recurring_date", { mode: "string" }),
    /** Offene Rechnung aus Lexoffice übernommen: Original-PDF, Eröffnungsbuchung statt Erlösbuchung */
    lexofficeVoucherId: uuid("lexoffice_voucher_id").unique(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("invoices_final_has_number", sql`${t.status} = 'draft' or (${t.number} is not null and ${t.lockedAt} is not null)`),
    check("invoices_variant_kind", sql`${t.variant} is null or ${t.kind} = 'rechnung'`),
    uniqueIndex("invoices_number_counter").on(t.numberYear, t.numberCounter),
    uniqueIndex("invoices_recurring_date").on(t.recurringId, t.recurringDate),
  ],
);

export const invoiceLines = pgTable("invoice_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  position: smallint("position").notNull(),
  description: text("description").notNull(),
  /** Tausendstel */
  quantity: integer("quantity").notNull(),
  unit: text("unit").notNull(),
  unitPrice: integer("unit_price").notNull(),
  taxRate: smallint("tax_rate").notNull(),
  net: integer("net").notNull(),
  /** Schlussrechnung: Abzug dieser Abschlagsrechnung; erzeugt Haben, nicht der Editor */
  deductionOf: uuid("deduction_of").references(() => invoices.id),
});

/** Letzte vergebene laufende Nummer je Jahr; lückenlos, weil nur beim Festschreiben gezogen */
export const invoiceNumberCounters = pgTable("invoice_number_counters", {
  year: smallint("year").primaryKey(),
  last: integer("last").notNull(),
});

/**
 * Angebote: Entwurf frei änderbar, beim Festschreiben Nummer (eigener Kreis) und PDF, danach fest.
 * Nur Entscheidung (angenommen, abgelehnt) und die daraus erstellte Rechnung lassen sich noch setzen.
 */
export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    number: text("number").unique(),
    numberYear: smallint("number_year"),
    numberCounter: integer("number_counter"),
    contactId: uuid("contact_id").references(() => contacts.id),
    contactVersion: integer("contact_version"),
    issueDate: date("issue_date", { mode: "string" }).notNull(),
    validUntil: date("valid_until", { mode: "string" }).notNull(),
    serviceFrom: date("service_from", { mode: "string" }),
    serviceTo: date("service_to", { mode: "string" }),
    note: text("note").notNull().default(""),
    language: text("language", { enum: ["de", "en"] }).notNull().default("de"),
    taxTreatment: text("tax_treatment", { enum: TAX_TREATMENT_KEYS }).notNull().default("regulaer"),
    exemptionReason: text("exemption_reason").notNull().default(""),
    net: integer("net").notNull().default(0),
    tax: integer("tax").notNull().default(0),
    gross: integer("gross").notNull().default(0),
    seller: jsonb("seller").$type<Seller>(),
    buyer: jsonb("buyer").$type<Buyer>(),
    pdf: bytea("pdf"),
    pdfSha256: text("pdf_sha256"),
    /** Antwort des Kunden */
    decision: text("decision", { enum: ["angenommen", "abgelehnt"] }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Rechnung, die aus dem Angebot entstanden ist */
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("quotes_final_has_number", sql`${t.status} = 'draft' or (${t.number} is not null and ${t.lockedAt} is not null)`),
    check("quotes_decision_final", sql`${t.decision} is null or ${t.status} = 'final'`),
    uniqueIndex("quotes_number_counter").on(t.numberYear, t.numberCounter),
  ],
);

export const quoteLines = pgTable("quote_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  quoteId: uuid("quote_id")
    .notNull()
    .references(() => quotes.id, { onDelete: "cascade" }),
  position: smallint("position").notNull(),
  description: text("description").notNull(),
  /** Tausendstel */
  quantity: integer("quantity").notNull(),
  unit: text("unit").notNull(),
  unitPrice: integer("unit_price").notNull(),
  taxRate: smallint("tax_rate").notNull(),
  net: integer("net").notNull(),
});

/** Firmenlogo für Rechnungen, Angebote und Mahnungen; höchstens eine Zeile */
export const companyLogo = pgTable(
  "company_logo",
  {
    id: smallint("id").primaryKey().default(1),
    /** PNG oder JPEG; bleibt wie alle Binärdaten aus dem Änderungsprotokoll */
    logo: bytea("logo").notNull(),
    format: text("format", { enum: ["png", "jpg"] }).notNull(),
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("company_logo_single", sql`${t.id} = 1`)],
);

/** Artikel und Leistungen zum Einfügen in Rechnungen und Angebote; Preise netto in Cent */
export const articles = pgTable("articles", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Eigene Artikelnummer, optional */
  number: text("number").notNull().default(""),
  /** Text der Position auf Rechnung und Angebot */
  description: text("description").notNull(),
  unit: text("unit").notNull(),
  unitPrice: integer("unit_price").notNull(),
  taxRate: smallint("tax_rate").notNull(),
  /** Interne Notiz, erscheint nicht auf Belegen */
  note: text("note").notNull().default(""),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Letzte Angebotsnummer je Jahr */
export const quoteNumberCounters = pgTable("quote_number_counters", {
  year: smallint("year").primaryKey(),
  last: integer("last").notNull(),
});

/** Buchungen. Festgeschrieben ab Entstehung; Korrektur nur per Gegenbuchung. */
export const journalEntries = pgTable("journal_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  date: date("date", { mode: "string" }).notNull(),
  description: text("description").notNull(),
  sourceType: text("source_type", { enum: ["invoice", "document", "allocation", "asset", "pauschale", "kasse"] }).notNull(),
  sourceId: uuid("source_id").notNull(),
  kontenrahmen: kontenrahmenEnum("kontenrahmen").notNull(),
  reversesId: uuid("reverses_id"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const journalLines = pgTable(
  "journal_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => journalEntries.id),
    account: text("account").notNull(),
    debit: integer("debit").notNull().default(0),
    credit: integer("credit").notNull().default(0),
    taxCode: text("tax_code"),
  },
  (t) => [check("journal_lines_one_side", sql`(${t.debit} >= 0 and ${t.credit} >= 0) and (${t.debit} = 0 or ${t.credit} = 0)`)],
);

export const documentStatusEnum = pgEnum("document_status", ["neu", "gebucht"]);
export const extractionStatusEnum = pgEnum("extraction_status", ["keine", "laeuft", "fertig", "fehler"]);

/**
 * Belege (Eingangsrechnungen, Quittungen). Die Datei liegt im Dateisystem unter ihrem SHA-256;
 * Beträge in Cent, Gutschriften negativ. Beim Buchen gesperrt.
 */
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  sha256: text("sha256").notNull().unique(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  status: documentStatusEnum("status").notNull().default("neu"),
  /** Woher die Felder stammen: zugferd, xrechnung, ki oder manuell */
  extractedBy: text("extracted_by", { enum: ["zugferd", "xrechnung", "ki", "manuell"] }),
  extractionStatus: extractionStatusEnum("extraction_status").notNull().default("keine"),
  extractionError: text("extraction_error"),
  /** Rohdaten der Auslesung zum Nachvollziehen */
  extraction: jsonb("extraction").$type<Record<string, unknown>>(),
  supplierName: text("supplier_name").notNull().default(""),
  supplierUstId: text("supplier_ust_id").notNull().default(""),
  invoiceNumber: text("invoice_number").notNull().default(""),
  documentDate: date("document_date", { mode: "string" }),
  dueDate: date("due_date", { mode: "string" }),
  category: text("category"),
  payment: text("payment", { enum: ["bank", "privat", "kasse"] }).notNull().default("bank"),
  note: text("note").notNull().default(""),
  currency: text("currency").notNull().default("EUR"),
  net: integer("net").notNull().default(0),
  tax: integer("tax").notNull().default(0),
  gross: integer("gross").notNull().default(0),
  /** Bei Kategorie „anlage“: Angaben für die Anlage, die beim Buchen entsteht */
  asset: jsonb("asset").$type<{ name: string; kind: AssetKind; method: AssetMethod; usefulLifeMonths: number | null }>(),
  /** Beim Buchen festgehalten: false bei Kleinunternehmern, dann ist die Steuer Teil des Aufwands */
  vorsteuerAbzug: boolean("vorsteuer_abzug").notNull().default(true),
  /** Privatanteil in Prozent (Handy, Internet): nur der Rest ist Aufwand und Vorsteuer */
  privateShare: smallint("private_share").notNull().default(0),
  /**
   * § 13b: Die Steuer schuldest du als Leistungsempfänger. Die Beträge tragen die selbst berechnete Steuer,
   * gezahlt wird nur netto (gross = net).
   */
  reverseCharge: text("reverse_charge", { enum: ["eu", "drittland"] }),
  /** Offener Beleg aus Lexoffice übernommen: Vorsteuer schon dort angemeldet, Eröffnungsbuchung */
  lexofficeVoucherId: uuid("lexoffice_voucher_id").unique(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Beträge eines Belegs je Steuersatz */
export const documentAmounts = pgTable(
  "document_amounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    taxRate: smallint("tax_rate").notNull(),
    net: integer("net").notNull(),
    tax: integer("tax").notNull(),
  },
  (t) => [uniqueIndex("document_amounts_rate").on(t.documentId, t.taxRate)],
);

/** Bankkonten; der Import ordnet Umsätze über die IBAN zu. */
export const bankAccounts = pgTable("bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  iban: text("iban").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Jede importierte Datei, nur anhängen */
export const bankImports = pgTable("bank_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  bankAccountId: uuid("bank_account_id")
    .notNull()
    .references(() => bankAccounts.id),
  filename: text("filename").notNull(),
  sha256: text("sha256").notNull(),
  format: text("format").notNull(),
  periodFrom: date("period_from", { mode: "string" }),
  periodTo: date("period_to", { mode: "string" }),
  openingBalance: integer("opening_balance"),
  closingBalance: integer("closing_balance"),
  /** Neu angelegt / als Duplikat übersprungen */
  added: integer("added").notNull(),
  skipped: integer("skipped").notNull(),
  warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BankConnectionAccount = {
  /** Kennung des Kontos bei Enable Banking, gilt für die Dauer der Zustimmung */
  uid: string;
  iban: string;
  name: string;
  bankAccountId: string;
  /** Abgerufen bis einschließlich dieses Tages */
  syncedTo: string | null;
};

/**
 * Zustimmungen für den automatischen Kontoabruf über Enable Banking. Die Sitzungskennung liegt
 * verschlüsselt in `ciphertext`; `state` verknüpft die Rückleitung der Bank mit dem Eintrag.
 */
export const bankConnections = pgTable("bank_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  aspspName: text("aspsp_name").notNull(),
  aspspCountry: text("aspsp_country").notNull(),
  psuType: text("psu_type", { enum: ["personal", "business"] }).notNull(),
  status: text("status", { enum: ["wartet", "aktiv", "abgelaufen", "widerrufen", "fehler"] }).notNull().default("wartet"),
  state: text("state").unique(),
  ciphertext: bytea("ciphertext"),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  accounts: jsonb("accounts").$type<BankConnectionAccount[]>().notNull().default([]),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Importierte Umsätze; unveränderlich ab Import. Eingang positiv, Ausgang negativ. */
export const bankTransactions = pgTable(
  "bank_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => bankAccounts.id),
    importId: uuid("import_id")
      .notNull()
      .references(() => bankImports.id),
    bookingDate: date("booking_date", { mode: "string" }).notNull(),
    valueDate: date("value_date", { mode: "string" }),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("EUR"),
    counterpartyName: text("counterparty_name").notNull().default(""),
    counterpartyIban: text("counterparty_iban"),
    purpose: text("purpose").notNull().default(""),
    type: text("type"),
    bankReference: text("bank_reference"),
    dedupHash: text("dedup_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("bank_transactions_dedup").on(t.bankAccountId, t.dedupHash)],
);

export const allocationKindEnum = pgEnum("allocation_kind", [
  "invoice",
  "document",
  "privat",
  "geldtransit",
  "ustVorauszahlung",
  "gebuehren",
  "mahnerloes",
]);

/**
 * Zuordnung eines Bankumsatzes (ganz oder teilweise) zu Rechnung, Beleg oder einer Buchung ohne Beleg.
 * Nur anhängen; aufgehoben wird per Gegenzeile mit negativem Betrag (reversesId).
 */
export const allocations = pgTable("allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => bankTransactions.id),
  kind: allocationKindEnum("kind").notNull(),
  invoiceId: uuid("invoice_id").references(() => invoices.id),
  documentId: uuid("document_id").references(() => documents.id),
  /** Mit dem Vorzeichen des Umsatzes */
  amount: integer("amount").notNull(),
  reversesId: uuid("reverses_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Original-Exporte und Nachweise (DATEV, IDEA, ELSTER-Protokolle, Kontoauszüge) unverändert unter ihrem SHA-256.
 * Nur anhängen.
 */
export const archiveFiles = pgTable(
  "archive_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: ["datev", "idea", "elster", "kontoauszug", "sonstiges"] }).notNull(),
    /** Geschäftsjahr, auf das sich die Datei bezieht */
    year: smallint("year"),
    filename: text("filename").notNull(),
    sha256: text("sha256").notNull().unique(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    note: text("note").notNull().default(""),
    /** Bei DATEV: Kopfzeile, Zeitraum und Warnungen des Parsers */
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("archive_files_year").on(t.year, t.kind)],
);

/** Buchungen aus einem DATEV-Buchungsstapel, je Zeile unverändert. Nur anhängen. */
export const datevBookings = pgTable(
  "datev_bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => archiveFiles.id),
    /** Zeilennummer in der Originaldatei */
    row: integer("row").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    /** Cent, immer positiv; die Richtung steht in side */
    amount: integer("amount").notNull(),
    side: text("side", { enum: ["S", "H"] }).notNull(),
    currency: text("currency").notNull().default("EUR"),
    account: text("account").notNull(),
    contraAccount: text("contra_account").notNull(),
    buKey: text("bu_key").notNull().default(""),
    voucherField1: text("voucher_field1").notNull().default(""),
    voucherField2: text("voucher_field2").notNull().default(""),
    text: text("text").notNull().default(""),
    documentLink: text("document_link").notNull().default(""),
    raw: jsonb("raw").$type<Record<string, string>>().notNull(),
  },
  (t) => [uniqueIndex("datev_bookings_file_row").on(t.fileId, t.row), index("datev_bookings_date").on(t.date)],
);

/** API-Schlüssel für Lexware Office, AES-256-GCM-verschlüsselt; eine Zeile */
export const lexofficeConnection = pgTable(
  "lexoffice_connection",
  {
    id: smallint("id").primaryKey().default(1),
    ciphertext: bytea("ciphertext").notNull(),
    organizationName: text("organization_name").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("lexoffice_connection_single_row", sql`${t.id} = 1`)],
);

export type LexofficeImportProgress = {
  phase: "kontakte" | "liste" | "belege" | "fertig";
  contacts: number;
  contactsLinked: number;
  listed: number;
  imported: number;
  skipped: number;
  files: number;
  failed: { lexofficeId: string; number: string; message: string }[];
};

/** Abrufe über die API; der Fortschritt wird während des Laufs fortgeschrieben. */
export const lexofficeImports = pgTable("lexoffice_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: text("status", { enum: ["laeuft", "fertig", "fehler", "abgebrochen"] }).notNull().default("laeuft"),
  progress: jsonb("progress").$type<LexofficeImportProgress>().notNull(),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export type LegacyTaxRow = { rate: number; net: number; tax: number };
export type LegacyCategoryRow = { categoryId: string; name: string; rate: number; net: number; tax: number };
export type LegacyPayment = { status: string; openAmount: number; paidDate: string | null; items: { type: string; date: string; amount: number }[] };

/**
 * Rechnungen, Gutschriften und Belege aus Lexoffice, so wie die API sie geliefert hat. Nur anhängen.
 * Beträge in Cent, Gutschriften negativ.
 */
export const lexofficeVouchers = pgTable(
  "lexoffice_vouchers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lexofficeId: text("lexoffice_id").notNull().unique(),
    importId: uuid("import_id")
      .notNull()
      .references(() => lexofficeImports.id),
    type: text("type").notNull(),
    direction: text("direction", { enum: ["einnahme", "ausgabe"] }).notNull(),
    number: text("number").notNull().default(""),
    date: date("date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }),
    serviceFrom: date("service_from", { mode: "string" }),
    serviceTo: date("service_to", { mode: "string" }),
    status: text("status").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id),
    contactName: text("contact_name").notNull().default(""),
    currency: text("currency").notNull().default("EUR"),
    net: integer("net").notNull(),
    tax: integer("tax").notNull(),
    gross: integer("gross").notNull(),
    taxes: jsonb("taxes").$type<LegacyTaxRow[]>().notNull(),
    categories: jsonb("categories").$type<LegacyCategoryRow[]>().notNull(),
    payment: jsonb("payment").$type<LegacyPayment>(),
    remark: text("remark").notNull().default(""),
    /** Antwort der API, zum Nachweis */
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lexoffice_vouchers_date").on(t.date), index("lexoffice_vouchers_number").on(t.number)],
);

/** Dateien zu einem Lexoffice-Beleg (Original-PDF, E-Rechnungs-XML, Anhänge). Nur anhängen. */
export const lexofficeVoucherFiles = pgTable(
  "lexoffice_voucher_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    voucherId: uuid("voucher_id")
      .notNull()
      .references(() => lexofficeVouchers.id),
    role: text("role", { enum: ["pdf", "xml", "anhang"] }).notNull(),
    lexofficeFileId: text("lexoffice_file_id"),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sha256: text("sha256").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("lexoffice_voucher_files_unique").on(t.voucherId, t.sha256)],
);

/**
 * Anlagenverzeichnis. Anschaffung per Beleg (Kategorie „anlage“) oder übernommen aus der
 * Vorgänger-Buchhaltung mit Restbuchwert zum Stichtag. Sobald eine Abschreibung gebucht ist,
 * sind die Berechnungsgrundlagen unveränderlich (Trigger).
 */
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ASSET_KIND_KEYS }).notNull(),
    method: text("method", { enum: ASSET_METHOD_KEYS }).notNull(),
    /** Anlagekonto, beim Anlegen festgelegt */
    account: text("account").notNull(),
    acquisitionDate: date("acquisition_date", { mode: "string" }).notNull(),
    /** Anschaffungskosten netto (ohne Vorsteuerabzug brutto) */
    cost: integer("cost").notNull(),
    usefulLifeMonths: smallint("useful_life_months"),
    documentId: uuid("document_id")
      .unique()
      .references(() => documents.id),
    /** Übernahme: Buchwert zum Stichtag; gebucht als Eröffnung gegen den Saldenvortrag */
    openingDate: date("opening_date", { mode: "string" }),
    openingBookValue: integer("opening_book_value"),
    openingEntryId: uuid("opening_entry_id"),
    disposalDate: date("disposal_date", { mode: "string" }),
    /** Firmenwagen: private Nutzung nach der Listenpreismethode */
    privateUse: jsonb("private_use").$type<CarPrivateUse>(),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("assets_opening_complete", sql`(${t.openingDate} is null) = (${t.openingBookValue} is null)`),
    check("assets_cost_positive", sql`${t.cost} > 0`),
    check("assets_private_use_car", sql`${t.privateUse} is null or ${t.kind} = 'kfz'`),
  ],
);

/** Gebuchte Abschreibungen je Anlage und Jahr, nur anhängen */
export const assetDepreciations = pgTable(
  "asset_depreciations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    year: smallint("year").notNull(),
    depreciation: integer("depreciation").notNull(),
    /** Restbuchwert beim Abgang */
    disposal: integer("disposal").notNull().default(0),
    /** Private Kfz-Nutzung im Jahr: Entnahme und Umsatzsteuer */
    privateUse: integer("private_use").notNull().default(0),
    privateUseVat: integer("private_use_vat").notNull().default(0),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => journalEntries.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("asset_depreciations_year").on(t.assetId, t.year)],
);

/**
 * Vorlage für wiederkehrende Rechnungen. Ein Hintergrundjob legt zu jedem fälligen Termin eine Rechnung
 * an (als Entwurf oder festgeschrieben) und rückt den nächsten Termin weiter.
 */
export const recurringInvoices = pgTable(
  "recurring_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    format: invoiceFormatEnum("format").notNull().default("zugferd"),
    paymentTermDays: smallint("payment_term_days").notNull().default(14),
    note: text("note").notNull().default(""),
    taxTreatment: text("tax_treatment", { enum: TAX_TREATMENT_KEYS }).notNull().default("regulaer"),
    exemptionReason: text("exemption_reason").notNull().default(""),
    lines: jsonb("lines")
      .$type<{ description: string; quantity: number; unit: string; unitPrice: number; taxRate: number }[]>()
      .notNull(),
    /** Monate zwischen zwei Rechnungen: 1, 3, 6 oder 12 */
    intervalMonths: smallint("interval_months").notNull(),
    /** Tag im Monat, auf den die Termine fallen (31 = Monatsende) */
    anchorDay: smallint("anchor_day").notNull(),
    nextDate: date("next_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    servicePeriod: text("service_period", { enum: ["laufend", "vorher", "keiner"] }).notNull().default("laufend"),
    /** entwurf = nur anlegen, festschreiben = Nummer ziehen und buchen */
    mode: text("mode", { enum: ["entwurf", "festschreiben"] }).notNull().default("entwurf"),
    /** Nur mit festschreiben: die Rechnung gleich per E-Mail an den Kunden schicken */
    sendByMail: boolean("send_by_mail").notNull().default(false),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("recurring_interval", sql`${t.intervalMonths} in (1, 3, 6, 12)`),
    check("recurring_anchor_day", sql`${t.anchorDay} between 1 and 31`),
  ],
);

/** Mahnungen und Zahlungserinnerungen mit PDF; wie ein verschicktes Schreiben unveränderlich */
export const dunnings = pgTable("dunnings", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id),
  /** 1 Zahlungserinnerung, 2 Mahnung, 3 letzte Mahnung */
  level: smallint("level").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  /** Neue Zahlungsfrist */
  dueDate: date("due_date", { mode: "string" }).notNull(),
  open: integer("open").notNull(),
  fee: integer("fee").notNull().default(0),
  flatFee: integer("flat_fee").notNull().default(0),
  interest: integer("interest").notNull().default(0),
  /** Zinssatz in Basispunkten (Basiszinssatz plus Aufschlag) */
  interestRate: integer("interest_rate").notNull().default(0),
  interestDays: integer("interest_days").notNull().default(0),
  total: integer("total").notNull(),
  intro: text("intro").notNull(),
  closing: text("closing").notNull(),
  pdf: bytea("pdf").notNull(),
  pdfSha256: text("pdf_sha256").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
