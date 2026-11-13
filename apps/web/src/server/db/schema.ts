import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  index,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import type { Buyer, Seller } from "@haben/einvoice";
import type { LetterheadDesign } from "@haben/core";
import {
  ASSET_KIND_KEYS,
  ASSET_METHOD_KEYS,
  PAYMENT_METHODS,
  PRICE_MODES,
  RECHTSFORM_KEYS,
  TAX_TREATMENT_KEYS,
  SELF_ASSESSED_TAX_KEYS,
  EXCHANGE_RATE_SOURCE_KEYS,
  DAUERBELEG_STATUS_KEYS,
  STEUERART_KEYS,
  STEUER_POSTEN_KEYS,
  DARLEHENSGEBER_KEYS,
  DARLEHEN_LAUFZEIT_KEYS,
  DARLEHEN_TEIL_KEYS,
  BAREINNAHME_BEHANDLUNG_KEYS,
  DARLEHEN_ZWECK_KEYS,
  DEFAULT_PLAN_TEMPLATES,
  QUOTE_LINE_KINDS,
  type PaymentPlanRow,
  type PlanTemplate,
  type AssetKind,
  type AssetMethod,
  type CarPrivateUse,
  type MailTemplates,
  type SkontoStufe,
  type TaxShare,
  type DirektKategorie,
  BESCHAEFTIGUNGSARTEN,
  KONFESSIONEN,
  type Beschaeftigungsart,
  type Bestandteil,
  type Konfession,
  type LohnStammdaten,
  type LstaKennzahlen,
  type SvBeitraege,
} from "@haben/core";
import type { LstbWerte } from "@haben/core";

export * from "./auth-schema.ts";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const bundeslandEnum = pgEnum("bundesland", ["BW", "BY", "BE", "BB", "HB", "HH", "HE", "MV", "NI", "NW", "RP", "SL", "SN", "ST", "SH", "TH"]);

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
    /** Inhaber des Kontos, wenn nicht der Firmenname; leer = Firmenname (GiroCode, BT-85) */
    kontoinhaber: text("kontoinhaber").notNull().default(""),
    /** Gläubiger-Identifikationsnummer für SEPA-Lastschriften (#445), von der Bundesbank vergeben; leer = keine */
    glaeubigerId: text("glaeubiger_id").notNull().default(""),
    kontenrahmen: kontenrahmenEnum("kontenrahmen").notNull().default("SKR03"),
    /** Einzelunternehmen oder Kapitalgesellschaft (GmbH, UG); fest ab der ersten Buchung (drizzle/0096) */
    rechtsform: text("rechtsform", { enum: RECHTSFORM_KEYS }).notNull().default("einzelunternehmen"),
    /** GmbH und UG: Sitz laut Gesellschaftsvertrag (leer = Ort der Anschrift), Registergericht und Handelsregisternummer (§ 264 Abs. 1a HGB) */
    sitz: text("sitz").notNull().default(""),
    registergericht: text("registergericht").notNull().default(""),
    registernummer: text("registernummer").notNull().default(""),
    /** GmbH und UG: alle Geschäftsführer, einer je Zeile, und ggf. der Vorsitzende des Aufsichtsrats (§ 35a Abs. 1 GmbHG) */
    geschaeftsfuehrer: text("geschaeftsfuehrer").notNull().default(""),
    aufsichtsratVorsitz: text("aufsichtsrat_vorsitz").notNull().default(""),
    paymentTermDays: smallint("payment_term_days").notNull().default(14),
    /** Vorgabe für das Skonto neuer Rechnungen, je Stufe Frist in Tagen und Satz in Basispunkten; leer = kein Skonto */
    skonto: jsonb("skonto").$type<SkontoStufe[]>().notNull().default([]),
    defaultFormat: invoiceFormatEnum("default_format").notNull().default("zugferd"),
    /** Vorgabe für die Einleitung über den Positionen neuer Rechnungen bzw. Angebote; im Beleg änderbar */
    invoiceIntro: text("invoice_intro").notNull().default(""),
    quoteIntro: text("quote_intro").notNull().default(""),
    /** Vorlagen für den Zahlungsplan im Angebot, z. B. „30/40/30“ und „50/50“ */
    paymentPlanTemplates: jsonb("payment_plan_templates").$type<PlanTemplate[]>().notNull().default(DEFAULT_PLAN_TEMPLATES),
    /** Kleinunternehmer nach § 19 UStG: Rechnungen ohne Umsatzsteuer, keine Voranmeldung, kein Vorsteuerabzug */
    kleinunternehmer: boolean("kleinunternehmer").notNull().default(false),
    /** Für die Anlage EÜR: Einkunftsart und Art des Betriebs */
    einkunftsart: text("einkunftsart", { enum: ["gewerbe", "selbstaendig"] }),
    taetigkeit: text("taetigkeit").notNull().default(""),
    /** Nummernformate mit Platzhaltern {JJJJ}, {JJ}, {MM}, {N…} (packages/core/src/number-format.ts) */
    invoiceNumberFormat: text("invoice_number_format").notNull().default("{JJJJ}-{NNN}"),
    quoteNumberFormat: text("quote_number_format").notNull().default("AN-{JJJJ}-{NNN}"),
    /** Zähler je Kreis: false = beginnt jedes Jahr bei 1, true = läuft über den Jahreswechsel weiter (#328) */
    invoiceCounterRunning: boolean("invoice_counter_running").notNull().default(false),
    quoteCounterRunning: boolean("quote_counter_running").notNull().default(false),
    /** Kundennummern automatisch, z. B. "K-{NNNN}"; leer = von Hand. Der Zähler läuft durch, ohne Jahr */
    customerNumberFormat: text("customer_number_format").notNull().default(""),
    customerNumberNext: integer("customer_number_next").notNull().default(1),
    /** Für den DATEV-Export: Nummern bei der Steuerberatung */
    datevBeraterNr: text("datev_berater_nr").notNull().default(""),
    datevMandantNr: text("datev_mandant_nr").notNull().default(""),
    /**
     * DATEV-Personenkonten im Buchungsstapel ab diesem Jahr (#327); null = Sammelkonten. Gilt ab einem Jahresbeginn; eine
     * Änderung, die abgelaufene oder laufende Jahre mit Buchungen trifft, braucht eine ausdrückliche Bestätigung.
     */
    datevPersonenkontenAb: integer("datev_personenkonten_ab"),
    /**
     * Voranmeldung und EÜR aus dem Journal ab diesem Jahr (#542, docs/adr/journal-als-quelle.md); null = ab dem Jahr der ersten
     * Buchung. Davor rechnen sie aus den Nebenbüchern. Bestehende Instanzen beginnen mit dem Jahr nach dem Update (Migration).
     */
    journalAb: integer("journal_ab"),
    /** Persönliche Angaben für ELSTER (Bankverbindung, Einkommensteuer): Person A, ggf. Ehegatte B */
    taxpayer: jsonb("taxpayer").$type<TaxpayerData>().notNull().default({}),
    /** Vorgabe für den Privatanteil in Prozent je Belegkategorie, z. B. { telefon: 20 } */
    privateShares: jsonb("private_shares").$type<Record<string, number>>().notNull().default({}),
    /**
     * Mahnwesen: Basiszinssatz in Basispunkten (null = keine Verzugszinsen), Mahngebühr je Stufe in Cent,
     * Zahlungsfrist in Tagen. autoBaseRate: Basiszinssatz von der Bundesbank automatisch abrufen (ausdrücklich
     * einzuschalten); baseRateSince: Halbjahr (JJJJ-01 oder JJJJ-07), für das der Abruf den Satz bestätigt hat.
     * Beide fehlen in älteren Zeilen.
     */
    dunning: jsonb("dunning")
      .$type<{
        baseRate: number | null;
        fees: Record<"1" | "2" | "3", number>;
        deadlineDays: number;
        autoBaseRate?: boolean;
        baseRateSince?: string | null;
      }>()
      .notNull()
      .default({ baseRate: null, fees: { "1": 0, "2": 0, "3": 0 }, deadlineDays: 10 }),
    /** SHA-256 des geheimen Tokens im Kalender-Abo der Fristen; null = kein Abo */
    calendarTokenHash: text("calendar_token_hash"),
    calendarTokenCreatedBy: text("calendar_token_created_by"),
    calendarTokenResponsibleId: text("calendar_token_responsible_id"),
    calendarTokenDisabledAt: timestamp("calendar_token_disabled_at", { withTimezone: true }),
    calendarTokenDisabledReason: text("calendar_token_disabled_reason"),
    /** Zugang mit API-Tokens für KI-Assistenten über MCP (/api/mcp) und die REST-API (/api/v1); ausdrücklich einzuschalten, standardmäßig aus */
    mcpEnabled: boolean("mcp_enabled").notNull().default(false),
    /** Das Finanzamt hat den Tageskurs statt der monatlichen USt-Umrechnungskurse gestattet (§ 16 Abs. 6 Satz 3 UStG) */
    tageskurs: boolean("tageskurs").notNull().default(false),
    /** Datenschutzhinweise der Finanzverwaltung vor der ersten Nutzung von ERiC bestätigt (ERiC-Lizenz § 5) */
    elsterDatenschutzAt: timestamp("elster_datenschutz_at", { withTimezone: true }),
    /** Nur bewusstes Speichern der Firmendaten; Verwaltungsupdates bestätigen keinen Steuerstatus. */
    companySavedAt: timestamp("firmendaten_gespeichert_at", { withTimezone: true }),
    /**
     * Zeichen der Firma in der Navigation, getrennt von der Beleggestaltung: eigene Farbe des „H“ (#RRGGBB; null = Farbe
     * des Themes) oder, mit navLogo, das Logo der Belege. Fehlt das Logo, gilt wieder die Farbe bzw. das Theme.
     */
    navColor: text("nav_color"),
    navLogo: boolean("nav_logo").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("company_single_row", sql`${t.id} = 1`),
    check("company_rechtsform", sql`${t.rechtsform} in ('einzelunternehmen', 'gmbh', 'ug')`),
    check("company_nav_color", sql`${t.navColor} ~ '^#[0-9A-F]{6}$'`),
  ],
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
    /** Steuerfreie Lieferungen mit Vorsteuerabzug: innergemeinschaftlich (41), Ausfuhr (43) */
    kz41: integer("kz41").notNull().default(0),
    kz43: integer("kz43").notNull().default(0),
    /** Innergemeinschaftlicher Erwerb: Bemessungsgrundlagen 89/93, Vorsteuer daraus 61 */
    kz89: integer("kz89").notNull().default(0),
    kz93: integer("kz93").notNull().default(0),
    kz61: integer("kz61").notNull().default(0),
    /** Entstandene Einfuhrumsatzsteuer (§ 15 Abs. 1 Satz 1 Nr. 2 UStG) */
    kz62: integer("kz62").notNull().default(0),
    /** Abzug der Sondervorauszahlung (Dauerfristverlängerung) in der letzten Voranmeldung des Jahres */
    kz39: integer("kz39").notNull().default(0),
    kz83: integer("kz83").notNull().default(0),
    status: vatReturnStatusEnum("status").notNull().default("draft"),
    /** Berichtigte Anmeldung (Kz 10) */
    berichtigt: boolean("berichtigt").notNull().default(false),
    /** Kennzahlen aus den Buchungen berechnet oder von Hand überschrieben */
    source: text("source", { enum: ["berechnet", "manuell"] })
      .notNull()
      .default("manuell"),
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
      kz41?: number;
      kz43?: number;
      kz89?: number;
      kz93?: number;
      kz61?: number;
      kz62?: number;
      kz39?: number;
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
    // Zeitraum wie im ELSTER-Feld Zeitraum: 1–12 Monate, 41–44 Kalendervierteljahre
    check("vat_returns_month", sql`${t.month} between 1 and 12 or ${t.month} between 41 and 44`),
    foreignKey({ name: "vat_returns_corrects_fk", columns: [t.correctsId], foreignColumns: [t.id] }),
    // höchstens ein Entwurf je Zeitraum
    uniqueIndex("vat_returns_one_draft_per_period").on(t.year, t.month).where(sql`${t.status} = 'draft'`),
  ],
);

/**
 * Voranmeldungszeitraum (§ 18 Abs. 2 UStG), wie ihn das Finanzamt festgelegt hat: ab Jahr und Monat (1, 4, 7 oder 10)
 * monatlich, vierteljährlich oder keine Voranmeldung. Ein Jahr ohne Zeile übernimmt die letzte Einstellung davor, ganz
 * ohne Zeile gilt monatlich.
 */
export const vatFrequencies = pgTable(
  "vat_frequencies",
  {
    year: smallint("year").notNull(),
    fromMonth: smallint("from_month").notNull().default(1),
    frequency: text("frequency", { enum: ["monatlich", "vierteljaehrlich", "keine"] }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.year, t.fromMonth] }), check("vat_frequencies_from_month", sql`${t.fromMonth} in (1, 4, 7, 10)`)],
);

/**
 * Dauerfristverlängerung je Jahr (§ 46–48 UStDV): besteht sie, und welche Sondervorauszahlung ist angemeldet? Gesetzt
 * mit der Echtübermittlung des Antrags oder von Hand, wenn der Antrag außerhalb von Haben gestellt wurde. Ein Jahr ohne
 * Zeile übernimmt die letzte davor.
 */
export const vatExtensions = pgTable("vat_extensions", {
  year: smallint("year").primaryKey(),
  active: boolean("active").notNull(),
  /** Angemeldete Sondervorauszahlung in Cent (volle Euro); null bei vierteljährlicher Abgabe oder ohne Anmeldung */
  sondervorauszahlung: integer("sondervorauszahlung"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Prüfungen und Übermittlungen des Antrags auf Dauerfristverlängerung bzw. der Sondervorauszahlung (USt 1 H), nur anhängen */
export const vatExtensionSubmissions = pgTable(
  "vat_extension_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    year: smallint("year").notNull(),
    /** Gemeldete Sondervorauszahlung (Kz 38) in Cent; null beim Antrag ohne Sondervorauszahlung (vierteljährlich) */
    kz38: integer("kz38"),
    /** Berichtigte Anmeldung der Sondervorauszahlung (Kz 10) */
    berichtigt: boolean("berichtigt").notNull().default(false),
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
  },
  (t) => [index("vat_extension_submissions_year").on(t.year), check("vat_extension_submissions_kz38", sql`${t.kz38} is null or ${t.kz38} >= 0`)],
);

/**
 * Zusammenfassende Meldung (§ 18a UStG) an das BZSt: jede Prüfung und Übermittlung, nur anhängen. Eine echt übermittelte
 * Meldung bleibt so unverändert; eine Korrektur ist eine neue Zeile als Berichtigung mit den geänderten Meldezeilen.
 */
export const zmSubmissions = pgTable(
  "zm_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    year: smallint("year").notNull(),
    /** Meldezeitraum wie in vat_returns: 1–12 Monate, 41–44 Kalendervierteljahre */
    month: smallint("month").notNull(),
    /** Berichtigte Meldung (meldeart 11) */
    berichtigt: boolean("berichtigt").notNull().default(false),
    /** Gemeldete Zeilen: USt-IdNr., Art (L, S, D) und Betrag in Cent; gemeldet in vollen Euro */
    zeilen: jsonb("zeilen").$type<{ ustId: string; art: "L" | "S" | "D"; betrag: number }[]>().notNull(),
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
  },
  (t) => [
    index("zm_submissions_period").on(t.year, t.month),
    check("zm_submissions_month", sql`(${t.month} between 1 and 12) or (${t.month} between 41 and 44)`),
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
 * Abgabevermerk einer Voranmeldung, die außerhalb von Haben abgegeben wurde (XML-Import in Mein ELSTER, Erweiterung,
 * KI-Assistent): Tag der Abgabe, Transferticket, die dort gemeldete Zahllast (gleich Kz 83 der Anmeldung) und das
 * Übermittlungsprotokoll als PDF im Dokumentenspeicher (SHA-256, wie Rechnungsanhänge). Mit dem Vermerk ist die
 * Anmeldung festgeschrieben wie nach einer Übermittlung über ERiC; nur anhängen, je Anmeldung höchstens einer.
 */
export const vatReturnFilings = pgTable(
  "vat_return_filings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vatReturnId: uuid("vat_return_id")
      .notNull()
      .references(() => vatReturns.id),
    filedOn: date("filed_on", { mode: "string" }).notNull(),
    transferTicket: text("transfer_ticket").notNull(),
    kz83: integer("kz83").notNull(),
    filename: text("filename").notNull(),
    sha256: text("sha256").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("vat_return_filings_return").on(t.vatReturnId), index("vat_return_filings_sha256").on(t.sha256)],
);

/**
 * Seit wann abgegebene Voranmeldungen offene Posten sind: der Zeitpunkt der Migration, die die Funktion einführt
 * (0138, auf frischen Installationen also die Installation). Früher über ERiC gesendete Anmeldungen (Altbestand) werden
 * erst mit einer Zahlung mit Bezug ein Posten. Eine Zeile, nur anhängen.
 */
export const vatItemsSince = pgTable(
  "vat_items_since",
  {
    id: integer("id").primaryKey().default(1),
    since: timestamp("since", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("vat_items_since_single", sql`${t.id} = 1`)],
);

/**
 * Prüfungen und Übermittlungen der Jahreserklärungen (Umsatzsteuererklärung, Anlage EÜR), nur anhängen.
 * `figures` hält die gesendeten Werte fest, unabhängig davon, wie sich die Buchungen später ändern.
 * `kind = 'vermerk'` dokumentiert eine außerhalb von Haben abgegebene Erklärung mit Tag, Ticket und Protokoll.
 */
export const annualSubmissions = pgTable(
  "annual_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** GmbH und UG: kst Körperschaftsteuer, gewst Gewerbesteuer, ebilanz E-Bilanz (§ 5b EStG) */
    form: text("form", { enum: ["ust", "euer", "est", "kst", "gewst", "ebilanz"] }).notNull(),
    year: smallint("year").notNull(),
    kind: text("kind", { enum: ["validate", "test", "send", "vermerk"] }).notNull(),
    ok: boolean("ok").notNull(),
    code: integer("code").notNull(),
    message: text("message").notNull(),
    transferTicket: text("transfer_ticket"),
    /** Abgabe außerhalb von Haben: Tag laut Übermittlungsprotokoll und Begründung */
    filedOn: date("filed_on", { mode: "string" }),
    note: text("note"),
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
    // Je Erklärung und Jahr höchstens ein Vermerk auf eine Abgabe außerhalb von Haben
    uniqueIndex("annual_submissions_vermerk").on(t.form, t.year).where(sql`${t.kind} = 'vermerk'`),
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

/** Angaben einer GmbH oder UG zu Körperschaft- und Gewerbesteuer je Jahr (Hebesatz, Verlustvorträge); änderbar, mit Audit */
export const corporateTaxInputs = pgTable("corporate_tax_inputs", {
  year: smallint("year").primaryKey(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Restlaufzeiten der Forderungen und Verbindlichkeiten einer GmbH oder UG zum 31.12. des Jahres, wie die Nutzerin sie
 * bestätigt hat (§ 268 Abs. 4 und 5 HGB): je Konto Betrag und Teil mit mehr als einem Jahr, für das Jahr und die
 * Vorjahresspalte der Bilanz. Änderbar, jede Änderung steht im Audit-Log.
 */
export const residualTerms = pgTable("residual_terms", {
  year: smallint("year").primaryKey(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Ein Gesellschafter in einer Ausschüttung: Anteil, Beträge und Kirchensteuerabzugsmerkmal zum Zeitpunkt des Beschlusses */
export interface AusschuettungEmpfaenger {
  name: string;
  /** Hundertstel Prozent */
  anteil: number;
  brutto: number;
  ausEinlagekonto: number;
  ertrag: number;
  kapest: number;
  soli: number;
  kist: number;
  netto: number;
  kirchensteuer: 0 | 8 | 9;
  religionsschluessel: string | null;
}

/**
 * Gewinnausschüttungen einer GmbH oder UG (Gewinnverwendungsbeschluss) mit Steuerabzug je Gesellschafter. Gebucht als
 * Gewinnvortrag an Gesellschafter-Verrechnungskonto und Einbehaltungen; ein Storno ist eine Gegenbuchung (reverses_id).
 * Nur anhängen, mit Audit.
 */
export const dividends = pgTable("dividends", {
  id: uuid("id").primaryKey().defaultRandom(),
  beschlussDate: date("beschluss_date", { mode: "string" }).notNull(),
  /** Im Beschluss bestimmter Tag der Auszahlung; ohne: Zufluss am Tag nach dem Beschluss (§ 44 Abs. 2 Satz 2 EStG) */
  auszahlungstag: date("auszahlungstag", { mode: "string" }),
  zufluss: date("zufluss", { mode: "string" }).notNull(),
  /** Geschäftsjahr, dessen Gewinn der Beschluss ausschüttet: „für … (Zeitraum)“ in Muster II der Steuerbescheinigung; leer bei älteren Buchungen */
  geschaeftsjahr: integer("geschaeftsjahr"),
  brutto: integer("brutto").notNull(),
  empfaenger: jsonb("empfaenger").$type<AusschuettungEmpfaenger[]>().notNull(),
  entryId: uuid("entry_id")
    .notNull()
    .unique()
    .references(() => journalEntries.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Prüfungen und Übermittlungen der Kapitalertragsteuer-Anmeldung je Ausschüttung; höchstens eine erfolgreiche Echtübermittlung */
export const kapestSubmissions = pgTable(
  "kapest_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dividendId: uuid("dividend_id")
      .notNull()
      .references(() => dividends.id),
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
  },
  (t) => [
    index("kapest_submissions_dividend").on(t.dividendId),
    uniqueIndex("kapest_submissions_sent").on(t.dividendId).where(sql`${t.kind} = 'send' and ${t.ok}`),
  ],
);

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

/**
 * Zugang für E-Mails von Haben (Rechnungen, Erinnerungen an Fristen), genau eine Zeile (id = 1): SMTP oder Microsoft Graph
 * (`transport`). Bei `smtp` sind Server, Port, Verschlüsselung und Benutzer gesetzt, bei `graph` Tenant, Client und Anmeldeart.
 */
export const mailSettings = pgTable(
  "mail_settings",
  {
    id: smallint("id").primaryKey().default(1),
    /** Versandweg; bestehende Zeilen sind SMTP */
    transport: text("transport", { enum: ["smtp", "graph"] })
      .notNull()
      .default("smtp"),
    host: text("host"),
    port: integer("port"),
    /** true: TLS ab Verbindungsaufbau (meist Port 465); false: STARTTLS (meist Port 587) */
    secure: boolean("secure"),
    username: text("username"),
    /**
     * Das eine Geheimnis des Versandwegs, AES-256-GCM-verschlüsselt wie das Zertifikat; bleibt aus dem Audit-Log:
     * bei SMTP das Passwort, bei Graph das Client Secret oder der private Schlüssel des Zertifikats (PEM)
     */
    ciphertext: bytea("ciphertext"),
    /** Microsoft Graph: Verzeichnis (Tenant) der Entra-ID-App, Anwendungs-ID (Client) und Art der Anmeldung */
    graphTenantId: text("graph_tenant_id"),
    graphClientId: text("graph_client_id"),
    graphAuth: text("graph_auth", { enum: ["secret", "certificate"] }),
    /** SHA-256-Fingerabdruck des Zertifikats (hex), nur bei `certificate`; kein Geheimnis */
    graphThumbprint: text("graph_thumbprint"),
    /** Postfach, aus dem gesendet wird (UPN oder Objekt-ID), wenn es von `from_address` abweicht; leer: `from_address` */
    graphMailbox: text("graph_mailbox"),
    fromAddress: text("from_address").notNull(),
    /** Name vor der Absenderadresse; leer: der Firmenname, ohne den „Haben“ (senderName in mail.ts) */
    fromName: text("from_name").notNull().default(""),
    /** Empfänger der Erinnerungen */
    reminderTo: text("reminder_to").notNull(),
    remindersEnabled: boolean("reminders_enabled").notNull().default(true),
    /** Erinnern so viele Tage vor einer Frist, 0 = am Tag selbst */
    reminderDays: smallint("reminder_days").array().notNull().default(sql`'{7,1}'::smallint[]`),
    /**
     * Vorlagen für Rechnungen, Angebote und Mahnungen je Art und Sprache („abschlag:en“ → Betreff und Text); fehlt eine,
     * gilt die allgemeine der Gruppe, sonst der Standardtext (MAIL_TEMPLATE_KINDS in @haben/core)
     */
    templates: jsonb("templates").$type<MailTemplates>().notNull().default({}),
    /** Kopf der Kette im Audit-Log wöchentlich an reminder_to, damit er außerhalb des Servers liegt */
    pruefwertMail: boolean("pruefwert_mail").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("mail_settings_single_row", sql`${t.id} = 1`),
    check(
      "mail_settings_transport",
      sql`(${t.transport} = 'smtp' and ${t.host} is not null and ${t.port} is not null and ${t.secure} is not null and ${t.username} is not null and ${t.ciphertext} is not null)
        or (${t.transport} = 'graph' and ${t.graphTenantId} is not null and ${t.graphClientId} is not null and ${t.graphAuth} is not null and ${t.ciphertext} is not null
        and (${t.graphAuth} <> 'certificate' or ${t.graphThumbprint} is not null))`,
    ),
  ],
);

/**
 * Zugang zu Enable Banking für den Kontoabruf, eingetragen in den Einstellungen; genau eine Zeile (id = 1).
 * Geht vor ENABLE_BANKING_APP_ID/ENABLE_BANKING_KEY aus der Umgebung.
 */
export const enableBankingSettings = pgTable(
  "enable_banking_settings",
  {
    id: smallint("id").primaryKey().default(1),
    applicationId: text("application_id").notNull(),
    /** Privater Schlüssel (PEM), AES-256-GCM-verschlüsselt; bleibt aus dem Audit-Log */
    ciphertext: bytea("ciphertext").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("enable_banking_settings_single_row", sql`${t.id} = 1`)],
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
  kind: text("kind", { enum: ["test", "fristen", "rechnung", "mahnung", "angebot", "pruefwert"] }).notNull(),
  /** Versandweg dieses Versuchs; ältere Zeilen sind SMTP */
  transport: text("transport", { enum: ["smtp", "graph"] })
    .notNull()
    .default("smtp"),
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
export const pauschalen = pgTable(
  "pauschalen",
  {
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
  },
  (t) => [foreignKey({ name: "pauschalen_reverses_fk", columns: [t.reversesId], foreignColumns: [t.id] })],
);

/**
 * Kassenbuch: jede Bewegung der Barkasse mit fortlaufender Nummer, nur anhängen. Bar bezahlte Belege
 * stehen hier mit ihrem Beleg, Bareinnahmen auf Ausgangsrechnungen mit ihrer Rechnung; Einlagen, Entnahmen und
 * Geldtransit von und zur Bank ohne Beleg. Korrekturen nur per Storno (Gegenzeile).
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
    kind: text("kind", { enum: ["beleg", "einlage", "entnahme", "abhebung", "einzahlung", "rechnung", "einnahme", "import"] }).notNull(),
    text: text("text").notNull(),
    documentId: uuid("document_id").references(() => documents.id),
    /** Bareinnahme auf eine Ausgangsrechnung (Kasse an Forderungen), auch bei ihrer Gegenzeile; mehrere Zeilen je Rechnung bei Teilzahlungen */
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    /** Bareinnahme: Netto und Steuer je Satz, wie gebucht (settlementTaxShares), und für welche Rechnung; wie bei allocations */
    taxShares: jsonb("tax_shares").$type<TaxShare[]>(),
    taxSharesInvoiceId: uuid("tax_shares_invoice_id"),
    /**
     * Bareinnahme ohne Rechnung (kind „einnahme“, #276): Steuerbehandlung und Satz in Basispunkten, siehe
     * packages/core/src/bareinnahme.ts; Voranmeldung und EÜR lesen sie von hier, die Gegenzeile trägt dieselben Angaben
     */
    taxTreatment: text("tax_treatment", { enum: BAREINNAHME_BEHANDLUNG_KEYS }),
    taxRate: integer("tax_rate"),
    /** Storno: die aufgehobene Zeile */
    reversesId: uuid("reverses_id"),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "cash_entries_einnahme",
      sql`case when ${t.kind} = 'einnahme' then ${t.taxTreatment} is not null and ${t.taxRate} is not null else ${t.taxTreatment} is null and ${t.taxRate} is null end`,
    ),
    uniqueIndex("cash_entries_document").on(t.documentId),
    uniqueIndex("cash_entries_reverses").on(t.reversesId),
    index("cash_entries_invoice").on(t.invoiceId),
    check("cash_entries_invoice_kind", sql`(${t.kind} = 'rechnung') = (${t.invoiceId} is not null)`),
    foreignKey({ name: "cash_entries_reverses_fk", columns: [t.reversesId], foreignColumns: [t.id] }),
  ],
);

/**
 * Jede Änderung mit altem und neuem Wert, per Trigger befüllt, nur anhängen. Jeder Eintrag ist mit seinem
 * Vorgänger verkettet: row_hash = SHA-256(prev_hash || Inhalt), berechnet vom Trigger in der Datenbank.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actor: text("actor"),
    tableName: text("table_name").notNull(),
    rowId: text("row_id"),
    action: text("action", { enum: ["INSERT", "UPDATE", "DELETE"] }).notNull(),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    /** Position in der Kette, lückenlos ab 1 in der Reihenfolge der Verkettung */
    seq: bigint("seq", { mode: "number" }).notNull(),
    prevHash: bytea("prev_hash").notNull(),
    rowHash: bytea("row_hash").notNull(),
  },
  (t) => [index("audit_log_at").on(t.at), index("audit_log_row").on(t.tableName, t.rowId), uniqueIndex("audit_log_seq").on(t.seq)],
);

/** Kopf der Kette im Audit-Log, genau eine Zeile; nur der Trigger auf audit_log schreibt sie fort. */
export const auditChain = pgTable(
  "audit_chain",
  {
    id: smallint("id").primaryKey().default(1),
    seq: bigint("seq", { mode: "number" }).notNull(),
    hash: bytea("hash").notNull(),
  },
  (t) => [check("audit_chain_single_row", sql`${t.id} = 1`)],
);

/**
 * Siegel festgeschriebener Datensätze: SHA-256 über die Zeile und ihre abhängigen Zeilen (Buchungszeilen,
 * Positionen, Steuerbeträge), angelegt per Trigger beim Festschreiben; für nur anhängbare Tabellen (Kassenbuch, Zuordnungen,
 * Pauschalen, AfA) beim Einfügen. Steht über das Audit-Log in der Kette.
 * Nur anhängen.
 */
export const seals = pgTable(
  "seals",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tableName: text("table_name", {
      enum: ["journal_entries", "invoices", "documents", "vat_returns", "cash_entries", "allocations", "pauschalen", "asset_depreciations"],
    }).notNull(),
    rowId: uuid("row_id").notNull(),
    /** Spalten je Tabelle, über die der Hash gebildet ist; spätere neue Spalten bleiben außen vor */
    columns: jsonb("columns").$type<Record<string, string[]>>().notNull(),
    digest: text("digest").notNull(),
    /** true: nachträglich für schon festgeschriebene Datensätze angelegt, nicht beim Festschreiben */
    genesis: boolean("genesis").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("seals_row").on(t.tableName, t.rowId)],
);

/** Kunden und Lieferanten. Jede Änderung legt per Trigger eine Version in contact_versions ab. */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kundennummer: text("kundennummer"),
    /** Rollen: ein Kontakt kann Kunde, Lieferant oder beides sein; bestehende Kontakte sind Kunden */
    isCustomer: boolean("is_customer").notNull().default(true),
    isSupplier: boolean("is_supplier").notNull().default(false),
    /** Nummer beim Lieferanten bzw. eigene Lieferantennummer, frei */
    lieferantennummer: text("lieferantennummer"),
    name: text("name").notNull(),
    strasse: text("strasse").notNull().default(""),
    plz: text("plz").notNull().default(""),
    ort: text("ort").notNull().default(""),
    land: text("land").notNull().default("DE"),
    email: text("email").notNull().default(""),
    /** Telefonnummer, wie eingegeben (#322) */
    telefon: text("telefon").notNull().default(""),
    ustId: text("ust_id").notNull().default(""),
    iban: text("iban").notNull().default(""),
    leitwegId: text("leitweg_id").notNull().default(""),
    defaultFormat: invoiceFormatEnum("default_format"),
    /** Skonto für Rechnungen an diesen Kunden; null = Vorgabe aus den Firmendaten, leer = kein Skonto */
    skonto: jsonb("skonto").$type<SkontoStufe[]>(),
    /** Sprache von Rechnungen und Angeboten an diesen Kontakt */
    language: text("language", { enum: ["de", "en"] })
      .notNull()
      .default("de"),
    /** Herkunft aus dem Lexoffice-Import, damit alte Rechnungen und Belege ihm zugeordnet bleiben */
    lexofficeId: text("lexoffice_id").unique(),
    /** Herkunft aus dem sevDesk-Import */
    sevdeskId: text("sevdesk_id").unique(),
    /**
     * DATEV-Personenkonten für den Buchungsstapel (#327), getrennt von Kunden- und Lieferantennummer; beide an einem
     * Kontakt möglich. Bereiche bei vierstelligen Sachkonten nach DATEV-Kontenrahmen SKR 03/04 2026, S. 36.
     */
    debitorNr: integer("debitor_nr").unique(),
    kreditorNr: integer("kreditor_nr").unique(),
    /** Stundensatz in Cent für Leistungseinträge (#417); null = keiner hinterlegt */
    hourlyRateCents: integer("hourly_rate_cents"),
    version: integer("version").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("contacts_debitor_nr_bereich", sql`${t.debitorNr} between 10000 and 69999`),
    check("contacts_kreditor_nr_bereich", sql`${t.kreditorNr} between 70000 and 99999`),
  ],
);

/**
 * Eigene Sachkonten (#270, Stufe 1): ein Aufwandskonto mit eigener Nummer und eigenem Namen. Für Steuer, EÜR und E-Bilanz
 * zählt es wie seine Elternkategorie (`parent_category`). Nummer, Kontenrahmen und Elternkategorie ändern sich nie (Trigger,
 * drizzle/0211); wer sich vertippt, löscht das Konto, solange nichts darauf zeigt, und legt es neu an. Der Name ist änderbar.
 */
export const ownAccounts = pgTable(
  "own_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kontenrahmen: kontenrahmenEnum("kontenrahmen").notNull(),
    account: text("account").notNull(),
    name: text("name").notNull(),
    parentCategory: text("parent_category").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("own_accounts_nummer", sql`${t.account} ~ '^[0-9]{4}$'`),
    check("own_accounts_name", sql`length(btrim(${t.name})) between 1 and 80`),
    uniqueIndex("own_accounts_nummer_key").on(t.kontenrahmen, t.account),
  ],
);

/**
 * Abrechenbare Leistungen (#417): ein Zeiteintrag je Kunde. Die Dauer steht in Minuten, der Stundensatz als Kopie vom
 * Anlegen (Cent; null = keiner bekannt). Einträge von außen (Kimai, Toggl) tragen Quelle und Kennung, damit ein zweiter
 * Abruf nichts verdoppelt.
 */
export const serviceEntries = pgTable(
  "service_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    workedOn: date("worked_on", { mode: "string" }).notNull(),
    minutes: integer("minutes").notNull(),
    description: text("description").notNull().default(""),
    hourlyRateCents: integer("hourly_rate_cents"),
    /** Erfasst, kommt aber nie in einen Rechnungsentwurf (z. B. interne Zeit) */
    nonBillable: boolean("non_billable").notNull().default(false),
    /** Abrechenbare Dauer in Minuten, wenn sie von der erfassten abweicht; null = die erfasste */
    billableMinutes: integer("billable_minutes"),
    /** Projekt als freier Text, nur zum Gruppieren und Filtern; keine Projektverwaltung */
    project: text("project").notNull().default(""),
    externalSource: text("external_source"),
    externalId: text("external_id"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("service_entries_minutes", sql`${t.minutes} between 1 and 1440`),
    check("service_entries_billable_minutes", sql`${t.billableMinutes} is null or ${t.billableMinutes} between 1 and 1440`),
    check("service_entries_rate", sql`${t.hourlyRateCents} is null or ${t.hourlyRateCents} >= 0`),
    check("service_entries_extern", sql`(${t.externalSource} is null) = (${t.externalId} is null)`),
    uniqueIndex("service_entries_extern_key").on(t.externalSource, t.externalId),
    index("service_entries_contact").on(t.contactId, t.workedOn),
  ],
);

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

/**
 * Ansprechpartner eines Kontakts (#424): Name, E-Mail, Telefon und Funktion. Änderbar (ein Tippfehler), nicht löschbar:
 * Wer nicht mehr dabei ist, wird deaktiviert. Im Entwurf von Rechnung und Angebot wählbar; beim Festschreiben steht der
 * Stand als `ansprechpartner` im Käufer des Belegs, spätere Änderungen an der Person berühren ihn nicht.
 */
export const contactPersons = pgTable(
  "contact_persons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    name: text("name").notNull(),
    email: text("email").notNull().default(""),
    telefon: text("telefon").notNull().default(""),
    /** Funktion oder Abteilung, nur in Haben; EN 16931 kennt dafür keinen Term */
    funktion: text("funktion").notNull().default(""),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    /** Wer angelegt hat (Benutzer-ID wie im Audit-Log) */
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contact_persons_contact").on(t.contactId), check("contact_persons_name", sql`length(btrim(${t.name})) > 0`)],
);

/**
 * SEPA-Lastschriftmandate eines Kunden (#445): nur anhängen. Was sich am Mandat ändert, ist ein neues Mandat; ein
 * Widerruf steht in sepa_mandate_revocations, das unterschriebene Mandat als PDF in sepa_mandate_files.
 */
export const sepaMandates = pgTable(
  "sepa_mandates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    /**
     * Mandatsreferenz (AT-M001), je Gläubiger eindeutig. Groß- und Kleinschreibung zählen nicht (DK, Anlage 3 V3.9,
     * Kap. 2.2.2), daher der eindeutige Index auf lower(reference)
     */
    reference: text("reference").notNull(),
    /** Datum der Unterschrift (AT-M007, DtOfSgntr) */
    signedOn: date("signed_on", { mode: "string" }).notNull(),
    /** Basislastschrift (CORE) oder Firmenlastschrift (B2B) */
    scheme: text("scheme", { enum: ["CORE", "B2B"] }).notNull(),
    /** Sequenz des ersten Einzugs aus Haben: FRST für ein neues Mandat, RCUR, wenn schon vor Haben eingezogen wurde */
    firstSequence: text("first_sequence", { enum: ["FRST", "RCUR"] }).notNull(),
    /** Letzter Einzug vor Haben (für den Verfall nach 36 Monaten); null = keiner oder unbekannt */
    lastCollectionBefore: date("last_collection_before", { mode: "string" }),
    /** Zahlungspflichtiger: Kontoinhaber, IBAN, BIC (optional) */
    debtorName: text("debtor_name").notNull(),
    debtorIban: text("debtor_iban").notNull(),
    debtorBic: text("debtor_bic").notNull().default(""),
    /** Wer angelegt hat (Benutzer-ID wie im Audit-Log) */
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sepa_mandates_reference").on(sql`lower(${t.reference})`),
    index("sepa_mandates_contact").on(t.contactId),
    check("sepa_mandates_scheme", sql`${t.scheme} in ('CORE', 'B2B')`),
    check("sepa_mandates_first_sequence", sql`${t.firstSequence} in ('FRST', 'RCUR')`),
    check("sepa_mandates_reference_format", sql`${t.reference} ~ '^[A-Za-z0-9+?/:().,'' -]{1,35}$'`),
    check("sepa_mandates_last_collection", sql`${t.lastCollectionBefore} is null or ${t.lastCollectionBefore} >= ${t.signedOn}`),
    // Ein Einzug vor Haben heißt: der nächste ist eine Folgelastschrift
    check("sepa_mandates_rcur_with_collection", sql`${t.lastCollectionBefore} is null or ${t.firstSequence} = 'RCUR'`),
  ],
);

/** Unterschriebenes Mandat als PDF im Dokumentenspeicher; nur anhängen, das jüngste gilt */
export const sepaMandateFiles = pgTable(
  "sepa_mandate_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mandateId: uuid("mandate_id")
      .notNull()
      .references(() => sepaMandates.id),
    filename: text("filename").notNull(),
    sha256: text("sha256").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sepa_mandate_files_mandate").on(t.mandateId), index("sepa_mandate_files_sha256").on(t.sha256)],
);

/** Widerruf eines Mandats durch den Kunden; je Mandat höchstens einer, nur anhängen */
export const sepaMandateRevocations = pgTable(
  "sepa_mandate_revocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mandateId: uuid("mandate_id")
      .notNull()
      .references(() => sepaMandates.id),
    /** Ab diesem Tag kein Einzug mehr */
    revokedOn: date("revoked_on", { mode: "string" }).notNull(),
    reason: text("reason").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sepa_mandate_revocations_mandate").on(t.mandateId)],
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
    /** Kreis des Zählers: Jahr des Belegdatums, 0 = durchlaufender Zähler (counterCircle) */
    numberYear: smallint("number_year"),
    numberCounter: integer("number_counter"),
    contactId: uuid("contact_id").references(() => contacts.id),
    contactVersion: integer("contact_version"),
    issueDate: date("issue_date", { mode: "string" }).notNull(),
    serviceFrom: date("service_from", { mode: "string" }),
    serviceTo: date("service_to", { mode: "string" }),
    paymentTermDays: smallint("payment_term_days").notNull().default(14),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    /**
     * Skonto in den Zahlungsbedingungen, je Stufe Frist in Tagen ab dem Rechnungsdatum und Satz in Basispunkten vom
     * ganzen Betrag; im PDF mit Datum und Betrag, in der E-Rechnung als #SKONTO# in BT-20. Leer = ohne Abzug
     */
    skonto: jsonb("skonto").$type<SkontoStufe[]>().notNull().default([]),
    format: invoiceFormatEnum("format").notNull().default("zugferd"),
    /** Einleitung über den Positionen (Kopftext) */
    intro: text("intro").notNull().default(""),
    /** Hinweis unter den Summen (Fußtext) */
    note: text("note").notNull().default(""),
    /**
     * Referenzen nach EN 16931 (#389), leer = keine: Bestellnummer des Kunden (BT-13), eigene Auftragsnummer (BT-14) und
     * Lieferschein (BT-16). Im XML an ihrem eigenen Feld, im PDF im Kopfblock.
     */
    buyerOrderReference: text("buyer_order_reference").notNull().default(""),
    sellerOrderReference: text("seller_order_reference").notNull().default(""),
    despatchAdviceReference: text("despatch_advice_reference").notNull().default(""),
    /** Sprache des PDFs */
    language: text("language", { enum: ["de", "en"] })
      .notNull()
      .default("de"),
    /** Währung der Rechnung; bei Fremdwährung sind net/tax/gross und invoice_taxes in Euro umgerechnet */
    currency: text("currency").notNull().default("EUR"),
    exchangeRate: numeric("exchange_rate", { precision: 12, scale: 6 }),
    exchangeRateSource: text("exchange_rate_source", { enum: EXCHANGE_RATE_SOURCE_KEYS }),
    exchangeRateDate: date("exchange_rate_date", { mode: "string" }),
    /** Umsatzsteuerliche Behandlung; außer „regulaer“ stehen alle Positionen auf 0 % */
    taxTreatment: text("tax_treatment", { enum: TAX_TREATMENT_KEYS }).notNull().default("regulaer"),
    /** Eigener Befreiungsgrund auf der Rechnung, sonst der Standardtext der Behandlung */
    exemptionReason: text("exemption_reason").notNull().default(""),
    /** Preise netto oder brutto inkl. USt; brutto nur bei regulärer Besteuerung */
    priceMode: text("price_mode", { enum: PRICE_MODES }).notNull().default("netto"),
    correctsId: uuid("corrects_id"),
    /** Abschlags- oder Schlussrechnung; nur bei kind „rechnung“ */
    variant: text("variant", { enum: ["abschlag", "schluss"] }),
    /** null: vor #622 festgeschriebener Abschlag; dessen bisherige Versteuerung bleibt erhalten. */
    advanceType: text("advance_type", { enum: ["anzahlung", "teilleistung"] }),
    /** Angebot, aus dem bzw. zu dem die Rechnung entstanden ist; die Schlussrechnung zieht dessen Abschläge ab */
    quoteId: uuid("quote_id").references((): AnyPgColumn => quotes.id),
    /** Abschlagsrechnung zu einer Zeile des Zahlungsplans im Angebot (Index ab 0) */
    paymentPlanRow: smallint("payment_plan_row"),
    /**
     * Gesamtrabatt wie eingegeben: Prozent in Basispunkten oder fester Betrag in Cent im Preismodus; höchstens eins. Der
     * Abzug je Satz steckt in invoice_taxes (Bemessungsgrundlage nach Rabatt) und folgt aus Zeilennetto minus Grundlage.
     */
    discountPercent: integer("discount_percent"),
    discountAmount: integer("discount_amount"),
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
    /** Zahlungsart (#445): Überweisung oder Einzug per SEPA-Lastschrift mit dem Mandat; eingezogen wird am Fälligkeitstag */
    paymentMethod: text("payment_method", { enum: PAYMENT_METHODS }).notNull().default("ueberweisung"),
    sepaMandateId: uuid("sepa_mandate_id").references(() => sepaMandates.id),
    /** Gewählter Ansprechpartner des Kunden (#424); der festgeschriebene Stand steht im Käufer */
    contactPersonId: uuid("contact_person_id").references(() => contactPersons.id),
    recurringId: uuid("recurring_id"),
    recurringDate: date("recurring_date", { mode: "string" }),
    /** Offene Rechnung aus Lexoffice übernommen: Original-PDF, Eröffnungsbuchung statt Erlösbuchung */
    lexofficeVoucherId: uuid("lexoffice_voucher_id").unique(),
    /**
     * Vorgang außerhalb von Haben, aus dem ein Entwurf über die REST-API entstanden ist (#199): Plattform, etwa „etsy“,
     * und deren Bestellnummer. Zusammen eindeutig, damit derselbe Vorgang nicht doppelt angelegt wird. Fließt wie jede
     * Spalte ab dem Festschreiben ins Siegel ein und ist danach gesperrt.
     */
    externalSource: text("external_source"),
    externalId: text("external_id"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("invoices_payment_method", sql`${t.paymentMethod} in ('ueberweisung', 'lastschrift')`),
    // Lastschrift nur mit Mandat, Überweisung ohne
    check("invoices_lastschrift_mandat", sql`(${t.paymentMethod} = 'lastschrift') = (${t.sepaMandateId} is not null)`),
    // Externe Referenz nur vollständig: Plattform und Bestellnummer zusammen
    check("invoices_external_ref_pair", sql`(${t.externalSource} is null) = (${t.externalId} is null)`),
    uniqueIndex("invoices_external_ref").on(t.externalSource, t.externalId),
    check("invoices_final_has_number", sql`${t.status} = 'draft' or (${t.number} is not null and ${t.lockedAt} is not null)`),
    check("invoices_variant_kind", sql`${t.variant} is null or ${t.kind} = 'rechnung'`),
    check("invoices_advance_type", sql`${t.advanceType} is null or (${t.variant} = 'abschlag' and ${t.advanceType} in ('anzahlung', 'teilleistung'))`),
    check("invoices_quote_kind", sql`${t.quoteId} is null or ${t.kind} = 'rechnung'`),
    check("invoices_plan_row", sql`${t.paymentPlanRow} is null or (${t.variant} = 'abschlag' and ${t.quoteId} is not null and ${t.paymentPlanRow} >= 0)`),
    check("invoices_discount", sql`${t.discountPercent} is null or ${t.discountAmount} is null`),
    check("invoices_discount_percent", sql`${t.discountPercent} is null or ${t.discountPercent} between 1 and 10000`),
    // Storno und Korrektur verweisen immer auf das Original
    check("invoices_corrects_original", sql`${t.kind} = 'rechnung' or ${t.correctsId} is not null`),
    uniqueIndex("invoices_number_counter").on(t.numberYear, t.numberCounter),
    uniqueIndex("invoices_recurring_date").on(t.recurringId, t.recurringDate),
    index("invoices_corrects").on(t.correctsId),
    index("invoices_quote").on(t.quoteId),
    // höchstens ein festgeschriebenes Storno je Rechnung
    uniqueIndex("invoices_one_storno").on(t.correctsId).where(sql`${t.kind} = 'storno' and ${t.status} = 'final'`),
    foreignKey({ name: "invoices_corrects_fk", columns: [t.correctsId], foreignColumns: [t.id] }),
    // in 0011 und 0018 von Hand angelegt
    foreignKey({ name: "invoices_recurring_fk", columns: [t.recurringId], foreignColumns: [recurringInvoices.id] }),
    foreignKey({ name: "invoices_lexoffice_voucher_fk", columns: [t.lexofficeVoucherId], foreignColumns: [lexofficeVouchers.id] }),
  ],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    /** Bezeichnung der Position, eine Zeile (BT-153) */
    description: text("description").notNull(),
    /** Beschreibung unter der Bezeichnung, mehrzeilig (BT-154); leer = keine */
    detail: text("detail").notNull().default(""),
    /** Artikelnummer des Verkäufers (BT-155), beim Einfügen aus dem Artikel kopiert; leer = keine (#388) */
    itemNumber: text("item_number").notNull().default(""),
    /** Tausendstel */
    quantity: integer("quantity").notNull(),
    unit: text("unit").notNull(),
    /** Wie eingegeben: netto oder brutto, je nach Preismodus der Rechnung */
    unitPrice: integer("unit_price").notNull(),
    taxRate: smallint("tax_rate").notNull(),
    /** Zeilennetto; bei Bruttopreisen der Anteil an der Bemessungsgrundlage des Satzes */
    net: integer("net").notNull(),
    /** Schlussrechnung: Abzug dieser Abschlagsrechnung; erzeugt Haben, nicht der Editor */
    deductionOf: uuid("deduction_of").references(() => invoices.id),
    /** Positionsrabatt wie eingegeben: Prozent in Basispunkten oder fester Betrag in Cent im Preismodus; net ist nach Rabatt */
    discountPercent: integer("discount_percent"),
    discountAmount: integer("discount_amount"),
  },
  (t) => [
    index("invoice_lines_invoice").on(t.invoiceId),
    check("invoice_lines_discount", sql`${t.discountPercent} is null or ${t.discountAmount} is null`),
    check("invoice_lines_discount_percent", sql`${t.discountPercent} is null or ${t.discountPercent} between 1 and 10000`),
  ],
);

/**
 * Netto und Umsatzsteuer je Steuersatz, einmal beim Speichern berechnet. Voranmeldung, Zahlungsbuchung,
 * Auswertungen, PDF und XML lesen nur diese Werte; mit der Rechnung festgeschrieben.
 */
export const invoiceTaxes = pgTable(
  "invoice_taxes",
  {
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    /** Basispunkte: 1900 = 19 % */
    rate: smallint("rate").notNull(),
    base: integer("base").notNull(),
    tax: integer("tax").notNull(),
    /** Nur bei Fremdwährung: Bemessungsgrundlage und Steuer in der Währung der Rechnung, wie auf PDF und XML */
    originalBase: bigint("original_base", { mode: "number" }),
    originalTax: bigint("original_tax", { mode: "number" }),
  },
  (t) => [primaryKey({ columns: [t.invoiceId, t.rate] })],
);

/**
 * Zusätzliche PDF-Anhänge einer Ausgangsrechnung (#272), etwa Stundenzettel oder Leistungsnachweise. Die Datei liegt
 * wie bei Belegen unter ihrem SHA-256 im Dokumentenspeicher; mit der Rechnung festgeschrieben und versiegelt. PDF und
 * XML der Rechnung bleiben davon unberührt.
 */
export const invoiceAttachments = pgTable(
  "invoice_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sha256: text("sha256").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Dieselbe Datei hängt höchstens einmal an derselben Rechnung
    uniqueIndex("invoice_attachments_file").on(t.invoiceId, t.sha256),
    // Für die Frage, ob eine Datei im Speicher noch gebraucht wird
    index("invoice_attachments_sha256").on(t.sha256),
  ],
);

/** Letzte vergebene laufende Nummer je Jahr (0 = durchlaufender Zähler); lückenlos, weil nur beim Festschreiben gezogen */
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
    /** Kreis des Zählers: Jahr des Belegdatums, 0 = durchlaufender Zähler (counterCircle) */
    numberYear: smallint("number_year"),
    numberCounter: integer("number_counter"),
    contactId: uuid("contact_id").references(() => contacts.id),
    contactVersion: integer("contact_version"),
    /** Gewählter Ansprechpartner des Kunden (#424); der festgeschriebene Stand steht im Käufer */
    contactPersonId: uuid("contact_person_id").references(() => contactPersons.id),
    issueDate: date("issue_date", { mode: "string" }).notNull(),
    validUntil: date("valid_until", { mode: "string" }).notNull(),
    serviceFrom: date("service_from", { mode: "string" }),
    serviceTo: date("service_to", { mode: "string" }),
    /** Einleitung über den Positionen (Kopftext) */
    intro: text("intro").notNull().default(""),
    note: text("note").notNull().default(""),
    /**
     * Referenzen nach EN 16931 (#389), leer = keine: Bestellnummer des Kunden (BT-13), eigene Auftragsnummer (BT-14) und
     * Lieferschein (BT-16). Gehen in die Rechnung aus dem Angebot über.
     */
    buyerOrderReference: text("buyer_order_reference").notNull().default(""),
    sellerOrderReference: text("seller_order_reference").notNull().default(""),
    despatchAdviceReference: text("despatch_advice_reference").notNull().default(""),
    language: text("language", { enum: ["de", "en"] })
      .notNull()
      .default("de"),
    taxTreatment: text("tax_treatment", { enum: TAX_TREATMENT_KEYS }).notNull().default("regulaer"),
    exemptionReason: text("exemption_reason").notNull().default(""),
    /** Preise netto oder brutto inkl. USt, wie bei der Rechnung */
    priceMode: text("price_mode", { enum: PRICE_MODES }).notNull().default("netto"),
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
    /** Gesamtrabatt wie bei der Rechnung: Prozent in Basispunkten oder fester Betrag in Cent, höchstens eins */
    discountPercent: integer("discount_percent"),
    discountAmount: integer("discount_amount"),
    /** Zahlungsplan: je Zeile Prozent, fester Betrag (im Preismodus) oder Rest, mit Fälligkeit als Text; leer = keiner */
    paymentPlan: jsonb("payment_plan").$type<PaymentPlanRow[]>().notNull().default([]),
    /** Zahlungsplan auch in der Auftragsbestätigung */
    paymentPlanInConfirmation: boolean("payment_plan_in_confirmation").notNull().default(false),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("quotes_final_has_number", sql`${t.status} = 'draft' or (${t.number} is not null and ${t.lockedAt} is not null)`),
    check("quotes_decision_final", sql`${t.decision} is null or ${t.status} = 'final'`),
    check("quotes_discount", sql`${t.discountPercent} is null or ${t.discountAmount} is null`),
    check("quotes_discount_percent", sql`${t.discountPercent} is null or ${t.discountPercent} between 1 and 10000`),
    uniqueIndex("quotes_number_counter").on(t.numberYear, t.numberCounter),
  ],
);

export const quoteLines = pgTable(
  "quote_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    /** Bezeichnung der Position, eine Zeile */
    description: text("description").notNull(),
    /** Beschreibung unter der Bezeichnung, mehrzeilig; leer = keine */
    detail: text("detail").notNull().default(""),
    /** Artikelnummer des Verkäufers wie bei der Rechnung; geht in die Rechnung aus dem Angebot über */
    itemNumber: text("item_number").notNull().default(""),
    /** Tausendstel */
    quantity: integer("quantity").notNull(),
    unit: text("unit").notNull(),
    unitPrice: integer("unit_price").notNull(),
    taxRate: smallint("tax_rate").notNull(),
    /** Zeilennetto nach Positionsrabatt */
    net: integer("net").notNull(),
    /** Positionsrabatt wie bei der Rechnung */
    discountPercent: integer("discount_percent"),
    discountAmount: integer("discount_amount"),
    /** Optionale Position oder Alternative zur Hauptposition davor; beide zählen nicht zur Angebotssumme. null = normal */
    kind: text("kind", { enum: QUOTE_LINE_KINDS }),
  },
  (t) => [
    check("quote_lines_discount", sql`${t.discountPercent} is null or ${t.discountAmount} is null`),
    check("quote_lines_discount_percent", sql`${t.discountPercent} is null or ${t.discountPercent} between 1 and 10000`),
    check("quote_lines_kind", sql`${t.kind} is null or ${t.kind} in ('optional', 'alternative')`),
  ],
);

/**
 * Auswahl des Kunden bei optionalen und alternativen Positionen eines festgeschriebenen Angebots: je gewählter Position
 * eine Zeile. Rechnung, Abschläge und Auftragsbestätigung übernehmen danach nur die gewählten (Lexware: „Weiterführen“).
 * Änderbar, bis eine Rechnung zum Angebot festgeschrieben ist (Trigger in drizzle/).
 */
export const quoteChoices = pgTable(
  "quote_choices",
  {
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.quoteId, t.position] })],
);

/**
 * Zusätzliche PDF-Anhänge eines Angebots (#415), etwa AGB, Widerrufsbelehrung oder eine Leistungsbeschreibung. Wie
 * invoice_attachments: die Datei liegt unter ihrem SHA-256 im Dokumentenspeicher; mit dem Angebot festgeschrieben
 * (Trigger in drizzle/). Angebote haben kein Siegel, die Anhänge also auch nicht.
 */
export const quoteAttachments = pgTable(
  "quote_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sha256: text("sha256").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Dieselbe Datei hängt höchstens einmal am selben Angebot
    uniqueIndex("quote_attachments_file").on(t.quoteId, t.sha256),
    // Für die Frage, ob eine Datei im Speicher noch gebraucht wird
    index("quote_attachments_sha256").on(t.sha256),
  ],
);

/**
 * Standardanhänge für Angebote (#415), etwa AGB oder Widerrufsbelehrung, einmal in den Einstellungen hinterlegt. Jedes
 * neue Angebot bekommt sie als eigene Zeilen in quote_attachments; so ist sie beim Senden vorausgewählt und bleibt mit
 * dem Angebot festgeschrieben, auch wenn sich die Einstellung später ändert. Die Datei liegt unter ihrem SHA-256.
 */
export const quoteDefaultAttachments = pgTable(
  "quote_default_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sha256: text("sha256").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Dieselbe Datei höchstens einmal; der Index dient auch der Frage, ob eine Datei im Speicher noch gebraucht wird
  (t) => [uniqueIndex("quote_default_attachments_file").on(t.sha256)],
);

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

/** Briefpapier als Bild hinter Rechnungen, Angeboten und Mahnungen; höchstens eine Zeile */
export const letterheadBackground = pgTable(
  "letterhead_background",
  {
    id: smallint("id").primaryKey().default(1),
    /** PNG oder JPEG; bleibt wie alle Binärdaten aus dem Änderungsprotokoll */
    background: bytea("background").notNull(),
    format: text("format", { enum: ["png", "jpg"] }).notNull(),
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("letterhead_background_single", sql`${t.id} = 1`)],
);

/** Gestaltung der Belege (#113): heute genau ein Standardprofil, die Markenprofile aus #245 werden weitere Zeilen */
export const letterheadProfiles = pgTable(
  "letterhead_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    settings: jsonb("settings").$type<LetterheadDesign>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("letterhead_profiles_default").on(t.isDefault).where(sql`${t.isDefault}`),
    // Die Typst-Vorlagen lesen die Farbe mit rgb(); anderes als #RRGGBB bräche jedes PDF
    check("letterhead_profiles_accent", sql`${t.settings} ->> 'accent' ~ '^#[0-9A-Fa-f]{6}$'`),
  ],
);

/**
 * Eigene Belegvorlagen (#113): Typst-Quelltext mit Namen, für Belege oder Mahnungen. Der Text steht wie alles andere im
 * Änderungsprotokoll. Pakete, die eine Vorlage braucht, sind nur mit Freigabe nutzbar; die Freigabe gilt für genau
 * diesen Quelltext (approved_sha256), eine geänderte Vorlage fragt neu.
 */
export const belegLayouts = pgTable(
  "beleg_layouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    art: text("art", { enum: ["beleg", "mahnung"] }).notNull(),
    source: text("source").notNull(),
    sha256: text("sha256").notNull(),
    /** Version des Feldvertrags, für die das Layout geschrieben ist (LAYOUT_SCHEMA_VERSION) */
    schemaVersion: smallint("schema_version").notNull(),
    /** Pakete, die der Quelltext importiert, z. B. { name: "@preview/cetz", version: "0.3.4" } */
    packages: jsonb("packages").$type<{ name: string; version: string }[]>().notNull().default([]),
    /** SHA-256 des Quelltexts, für den die Pakete freigegeben sind; null = nicht freigegeben */
    approvedSha256: text("approved_sha256"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("beleg_layouts_name").on(t.name), check("beleg_layouts_name_laenge", sql`char_length(${t.name}) between 1 and 60`)],
);

/** Artikel und Leistungen zum Einfügen in Rechnungen und Angebote; Preise in Cent, wie eingegeben */
export const articles = pgTable("articles", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Eigene Artikelnummer, optional */
  number: text("number").notNull().default(""),
  /** Bezeichnung der Position auf Rechnung und Angebot, eine Zeile */
  description: text("description").notNull(),
  /** Beschreibung unter der Bezeichnung, mehrzeilig; leer = keine */
  detail: text("detail").notNull().default(""),
  unit: text("unit").notNull(),
  unitPrice: integer("unit_price").notNull(),
  taxRate: smallint("tax_rate").notNull(),
  /** Preis enthält die Umsatzsteuer; passt das nicht zur Rechnung, wird beim Einfügen umgerechnet */
  priceIncludesTax: boolean("price_includes_tax").notNull().default(false),
  /** Interne Notiz, erscheint nicht auf Belegen */
  note: text("note").notNull().default(""),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const textBlockKinds = ["kopf", "fuss"] as const;
export type TextBlockKind = (typeof textBlockKinds)[number];

/**
 * Textbausteine zum Einfügen in Rechnungen, Angebote und wiederkehrende Rechnungen: Kopftext (Einleitung über den
 * Positionen) oder Fußtext (Hinweis unter den Summen). Eingefügt wird eine Kopie; eine festgeschriebene Rechnung
 * behält ihren Text, auch wenn sich der Baustein später ändert.
 */
export const textBlocks = pgTable(
  "text_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Bezeichnung in der Auswahl, erscheint nicht auf Belegen */
    name: text("name").notNull(),
    kind: text("kind", { enum: textBlockKinds }).notNull(),
    text: text("text").notNull(),
    /** Optional einem Kunden zugeordnet: steht bei dessen Belegen oben in der Auswahl */
    contactId: uuid("contact_id").references(() => contacts.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("text_blocks_contact").on(t.contactId), check("text_blocks_kind", sql`${t.kind} in ('kopf', 'fuss')`)],
);

/** Letzte Angebotsnummer je Jahr (0 = durchlaufender Zähler) */
export const quoteNumberCounters = pgTable("quote_number_counters", {
  year: smallint("year").primaryKey(),
  last: integer("last").notNull(),
});

/** Buchungen. Festgeschrieben ab Entstehung; Korrektur nur per Gegenbuchung. */
export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date", { mode: "string" }).notNull(),
    description: text("description").notNull(),
    sourceType: text("source_type", {
      enum: ["invoice", "document", "allocation", "asset", "pauschale", "kasse", "ausbuchung", "manuell", "eroeffnung", "ausschuettung", "lohn", "import"],
    }).notNull(),
    sourceId: uuid("source_id").notNull(),
    kontenrahmen: kontenrahmenEnum("kontenrahmen").notNull(),
    reversesId: uuid("reverses_id"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("journal_entries_date").on(t.date),
    index("journal_entries_source").on(t.sourceType, t.sourceId),
    foreignKey({ name: "journal_entries_reverses_fk", columns: [t.reversesId], foreignColumns: [t.id] }),
  ],
);

/**
 * Abgeschlossene Geschäftsjahre (GmbH, UG). Nur anhängen; ein Trigger lehnt danach jede Buchung mit Datum im Jahr ab und
 * hält beim Abschluss Zahl und Prüfwert der Buchungen fest (SHA-256 über ihren Inhalt, gerechnet wie ihre Siegel, drizzle/0098).
 */
export const yearClosings = pgTable("year_closings", {
  year: integer("year").primaryKey(),
  entries: integer("entries").notNull().default(0),
  digest: text("digest").notNull().default(""),
  closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
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
    /**
     * Bemessungsgrundlage zum Steuerschlüssel, wenn sie nicht der Betrag der Zeile ist, in Cent mit Vorzeichen (positiv
     * erhöht die Kennzahl): bei Ist-Versteuerung an der Zahlung (Umbuchung der Umsatzsteuer, Anteil zu 0 % an der
     * Forderung, Anteil ohne Steuer an einer Umsatzsteuerzeile ohne Betrag), #542. Ältere Zeilen haben keine; neue Spalten
     * ändern die Siegel nicht.
     */
    basis: integer("basis"),
  },
  (t) => [
    check("journal_lines_one_side", sql`(${t.debit} >= 0 and ${t.credit} >= 0) and (${t.debit} = 0 or ${t.credit} = 0)`),
    index("journal_lines_entry").on(t.entryId),
    index("journal_lines_account").on(t.account),
  ],
);

/**
 * Dauerbelege (Roadmap Platz 8): Vorlage für wiederkehrende Ausgaben wie Miete, Versicherung, Leasing oder Abos. Ein
 * Hintergrundjob legt zu jedem fälligen Termin einen Eingangsbeleg „Zu prüfen“ an (documents.recurring_document_id),
 * mit dem hinterlegten Vertrag bzw. der Dauerrechnung als Datei. Änderungen gelten nur für künftige Belege, die
 * angelegten bleiben, wie sie sind. Beträge in Cent je Steuersatz.
 */
export const recurringDocuments = pgTable(
  "recurring_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** aktiv, pausiert oder beendet (DAUERBELEG_STATUS); beendet ist endgültig */
    status: text("status", { enum: DAUERBELEG_STATUS_KEYS }).notNull().default("aktiv"),
    supplierName: text("supplier_name").notNull(),
    supplierUstId: text("supplier_ust_id").notNull().default(""),
    supplierContactId: uuid("supplier_contact_id").references(() => contacts.id),
    /** Vertrags- oder Kundennummer; steht als Rechnungsnummer an jedem Beleg (Verwendungszweck, Bankabgleich) */
    reference: text("reference").notNull().default(""),
    category: text("category").notNull(),
    payment: text("payment", { enum: ["bank", "privat", "kasse"] })
      .notNull()
      .default("bank"),
    privateShare: smallint("private_share").notNull().default(0),
    amounts: jsonb("amounts").$type<{ taxRate: number; net: number; tax: number }[]>().notNull(),
    /** Das Dokument weist die Umsatzsteuer gesondert aus (Dauerrechnung, Vertrag mit Steuerbetrag); sonst keine Vorsteuer */
    taxShown: boolean("tax_shown").notNull().default(false),
    note: text("note").notNull().default(""),
    /** Monate zwischen zwei Belegen: 1, 3, 6 oder 12 */
    intervalMonths: smallint("interval_months").notNull(),
    /** Tag im Monat, auf den die Termine fallen (31 = Monatsende) */
    anchorDay: smallint("anchor_day").notNull(),
    /** Erster Termin beim Anlegen, nur zur Anzeige */
    startDate: date("start_date", { mode: "string" }).notNull(),
    nextDate: date("next_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    /** Fällig am = Termin plus so viele Tage */
    dueDays: smallint("due_days").notNull().default(0),
    /** Vertrag oder Dauerrechnung im Dokumentenspeicher; jeder Beleg nutzt die Datei, die beim Anlegen hinterlegt war */
    sha256: text("sha256").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("recurring_documents_interval", sql`${t.intervalMonths} in (1, 3, 6, 12)`),
    check("recurring_documents_anchor_day", sql`${t.anchorDay} between 1 and 31`),
    check("recurring_documents_private_share", sql`${t.privateShare} between 0 and 100`),
    check("recurring_documents_due_days", sql`${t.dueDays} between 0 and 120`),
    index("recurring_documents_sha256").on(t.sha256),
  ],
);

export const documentStatusEnum = pgEnum("document_status", ["neu", "gebucht"]);
export const extractionStatusEnum = pgEnum("extraction_status", ["keine", "laeuft", "fertig", "fehler"]);

/**
 * Belege (Eingangsrechnungen, Quittungen). Die Datei liegt im Dateisystem unter ihrem SHA-256;
 * Beträge in Cent, Gutschriften negativ. Beim Buchen gesperrt.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Ablage nach Inhalt; dieselbe Datei gibt es nur noch einmal als Neuerfassung eines stornierten Belegs */
    sha256: text("sha256").notNull(),
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
    /** Aus den Kontakten gewählter Lieferant; Name und USt-IdNr. stehen trotzdem am Beleg, wie sie gebucht wurden */
    supplierContactId: uuid("supplier_contact_id").references(() => contacts.id),
    invoiceNumber: text("invoice_number").notNull().default(""),
    documentDate: date("document_date", { mode: "string" }),
    dueDate: date("due_date", { mode: "string" }),
    category: text("category"),
    payment: text("payment", { enum: ["bank", "privat", "kasse"] })
      .notNull()
      .default("bank"),
    note: text("note").notNull().default(""),
    currency: text("currency").notNull().default("EUR"),
    /** Bei Fremdwährung: 1 EUR = Kurs Fremdwährung (wie die Umsatzsteuer-Umrechnungskurse des BMF); net/tax/gross sind in Euro umgerechnet */
    exchangeRate: numeric("exchange_rate", { precision: 12, scale: 6 }),
    /** Herkunft des Kurses: USt-Umrechnungskurs des Monats, gestatteter Tageskurs oder von Hand; mit Monat bzw. Kursdatum */
    exchangeRateSource: text("exchange_rate_source", { enum: EXCHANGE_RATE_SOURCE_KEYS }),
    exchangeRateDate: date("exchange_rate_date", { mode: "string" }),
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
     * § 13b (eu, drittland) oder innergemeinschaftlicher Erwerb (ig_erwerb, § 1a UStG): Die Steuer schuldest du selbst.
     * Die Beträge tragen die selbst berechnete Steuer, gezahlt wird nur netto (gross = net).
     */
    reverseCharge: text("reverse_charge", { enum: SELF_ASSESSED_TAX_KEYS }),
    /** Offener Beleg aus Lexoffice übernommen: Vorsteuer schon dort angemeldet, Eröffnungsbuchung */
    lexofficeVoucherId: uuid("lexoffice_voucher_id").unique(),
    /**
     * Herkunft eines Belegs aus der REST-API (#104): Quelle, etwa „archiv“, und die Kennung des Dokuments dort. Zusammen
     * eindeutig, damit derselbe Beleg nicht doppelt ankommt. Wird nur beim Anlegen gesetzt; fließt wie jede Spalte ab
     * dem Buchen ins Siegel ein und ist danach gesperrt.
     */
    externalSource: text("external_source"),
    externalId: text("external_id"),
    /**
     * Neuerfassung (#237): der stornierte Beleg, den dieser Entwurf ersetzt. Er nutzt dieselbe Datei; wird nur beim
     * Anlegen gesetzt und ist ab dem Buchen mit dem Beleg gesperrt.
     */
    replacesDocumentId: uuid("replaces_document_id"),
    /**
     * Aus einem Dauerbeleg angelegt: die Vorlage und die Periode (Monatserster des Termins). Je Vorlage und Periode
     * höchstens ein Beleg, auch bei gleichzeitigen Läufen. Die Datei ist der Vertrag der Vorlage, also dieselbe für
     * alle Belege der Vorlage. Nur beim Anlegen gesetzt, ab dem Buchen mit dem Beleg gesperrt und versiegelt.
     */
    recurringDocumentId: uuid("recurring_document_id").references(() => recurringDocuments.id),
    recurringPeriod: date("recurring_period", { mode: "string" }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // in 0011 und 0016 von Hand angelegt
  (t) => [
    check("documents_private_share_range", sql`${t.privateShare} between 0 and 100`),
    foreignKey({ name: "documents_lexoffice_voucher_fk", columns: [t.lexofficeVoucherId], foreignColumns: [lexofficeVouchers.id] }),
    // Externe Referenz nur vollständig: Quelle und Kennung zusammen
    check("documents_external_ref_pair", sql`(${t.externalSource} is null) = (${t.externalId} is null)`),
    uniqueIndex("documents_external_ref").on(t.externalSource, t.externalId),
    // Keine Dubletten beim Hochladen; eine Neuerfassung nutzt dieselbe Datei, je storniertem Beleg höchstens eine
    // Dauerbelege nutzen alle die Datei ihrer Vorlage
    uniqueIndex("documents_sha256").on(t.sha256).where(sql`${t.replacesDocumentId} is null and ${t.recurringDocumentId} is null`),
    check("documents_recurring_pair", sql`(${t.recurringDocumentId} is null) = (${t.recurringPeriod} is null)`),
    uniqueIndex("documents_recurring_period").on(t.recurringDocumentId, t.recurringPeriod),
    uniqueIndex("documents_replaces").on(t.replacesDocumentId),
    foreignKey({ name: "documents_replaces_fk", columns: [t.replacesDocumentId], foreignColumns: [t.id] }),
  ],
);

/**
 * Storno eines gebuchten Belegs (#237): Gegenbuchung im noch nicht gemeldeten Zeitraum der Belegbuchung, sonst am Tag des
 * Stornos; der Beleg selbst bleibt gesperrt und versiegelt.
 * Nur anhängen, mit Siegel; je Beleg höchstens ein Storno.
 */
export const documentCancellations = pgTable("document_cancellations", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .unique()
    .references(() => documents.id),
  /**
   * Buchungsdatum der Gegenbuchung: das Datum der Belegbuchung, solange ihr Zeitraum nicht gemeldet ist, sonst der Tag
   * des Stornos, damit abgegebene Voranmeldungen unberührt bleiben (§ 17 UStG). Der Zeitpunkt des Stornos ist created_at.
   */
  date: date("date", { mode: "string" }).notNull(),
  reason: text("reason").notNull().default(""),
  journalEntryId: uuid("journal_entry_id")
    .notNull()
    .unique()
    .references(() => journalEntries.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
    /** In Euro; bei Fremdwährung aus den Originalbeträgen umgerechnet */
    net: integer("net").notNull(),
    tax: integer("tax").notNull(),
    /** Nur bei Fremdwährung: Beträge in der Währung des Belegs */
    /** bigint: in Währungen wie HUF oder JPY übersteigen schon übliche Beträge den Bereich von integer */
    originalNet: bigint("original_net", { mode: "number" }),
    originalTax: bigint("original_tax", { mode: "number" }),
  },
  (t) => [uniqueIndex("document_amounts_rate").on(t.documentId, t.taxRate)],
);

/**
 * Aufteilung eines Belegs auf mehrere Kontierungszeilen (#271): Kategorie, Steuersatz und Netto je Zeile, dazu der
 * anteilige Betrag der Vorsteuer des Satzes (allocateSplitTax). Ohne Zeilen gilt documents.category. Gesperrt mit dem
 * Beleg und Teil seines Siegels.
 */
export const documentSplits = pgTable(
  "document_splits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** Reihenfolge wie eingegeben, ab 1 */
    position: smallint("position").notNull(),
    category: text("category").notNull(),
    taxRate: smallint("tax_rate").notNull(),
    net: integer("net").notNull(),
    tax: integer("tax").notNull(),
  },
  (t) => [uniqueIndex("document_splits_position").on(t.documentId, t.position)],
);

/** Bankkonten; der Import ordnet Umsätze über die IBAN zu. */
export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Bei Zahlungsdienstleistern leer: deren Guthaben hat keine IBAN, importiert wird in das gewählte Konto */
    iban: text("iban").unique(),
    /** Wofür das Konto dient (ACCOUNT_PURPOSES); steuert Vorschläge im Bankabgleich und die Vorbelegung beim Finanzamt */
    purpose: text("purpose", { enum: ["geschaeft", "steuer", "ruecklage", "privat", "zahlungsdienstleister"] })
      .notNull()
      .default("geschaeft"),
    /** Nur Zahlungsdienstleister: Anbieter (PAYMENT_PROVIDERS) und Nummer des Verrechnungskontos (1361 … bzw. 1461 …) */
    provider: text("provider", { enum: ["paypal", "stripe", "shopify", "etsy", "ebay", "sumup", "googleplay", "appstore", "sonstige"] }),
    ledgerIndex: smallint("ledger_index").unique(),
    /** Gehört nicht zu dieser Firma (#462): ausgeblendet, kein Abruf, kein Import; nur solange kein Umsatz zugeordnet oder verrechnet ist */
    excludedAt: timestamp("excluded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("bank_accounts_purpose", sql`${t.purpose} in ('geschaeft', 'steuer', 'ruecklage', 'privat', 'zahlungsdienstleister')`),
    // Zahlungsdienstleister: Anbieter und Verrechnungskonto, keine IBAN; alle anderen: IBAN, kein Anbieter
    check(
      "bank_accounts_provider",
      sql`(${t.purpose} = 'zahlungsdienstleister' and ${t.provider} is not null and ${t.ledgerIndex} between 1 and 9 and ${t.iban} is null)
      or (${t.purpose} <> 'zahlungsdienstleister' and ${t.provider} is null and ${t.ledgerIndex} is null and ${t.iban} is not null)`,
    ),
  ],
);

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
  /** Erster Abruf eines Kontos ohne Umsätze in Haben ab diesem Tag statt ab Jahresbeginn (Umzug unter dem Jahr) */
  fetchFrom?: string;
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
  status: text("status", { enum: ["wartet", "aktiv", "abgelaufen", "widerrufen", "fehler"] })
    .notNull()
    .default("wartet"),
  state: text("state").unique(),
  ciphertext: bytea("ciphertext"),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  /** Beim Verbinden gewählt: erster Abruf neuer Konten ab diesem Tag; geht beim Abschluss an die Konten */
  fetchFrom: date("fetch_from", { mode: "string" }),
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
    /** Kennung der Überweisung (EndToEndId), soweit die Datei sie nennt; ordnet Überweisungen aus Haben ihrem Beleg zu */
    endToEndId: text("end_to_end_id"),
    dedupHash: text("dedup_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("bank_transactions_dedup").on(t.bankAccountId, t.dedupHash), index("bank_transactions_account_date").on(t.bankAccountId, t.bookingDate)],
);

/**
 * Erzeugte SEPA-Überweisungsdateien (pain.001) für offene Belege, nur anhängen. Gebucht wird dabei nichts: Bezahlt ist
 * ein Beleg erst, wenn der Bankabgleich die Abbuchung zuordnet.
 */
export const sepaTransfers = pgTable("sepa_transfers", {
  id: uuid("id").primaryKey().defaultRandom(),
  bankAccountId: uuid("bank_account_id")
    .notNull()
    .references(() => bankAccounts.id),
  /** MsgId der Datei, zugleich Dateiname */
  messageId: text("message_id").notNull().unique(),
  executionDate: date("execution_date", { mode: "string" }).notNull(),
  numberOfTransactions: integer("number_of_transactions").notNull(),
  controlSum: bigint("control_sum", { mode: "number" }).notNull(),
  /** Die Datei, wie sie heruntergeladen wurde */
  xml: text("xml").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Eine Überweisung der Datei je Beleg; die EndToEndId findet der Bankabgleich im Kontoauszug wieder */
export const sepaTransferItems = pgTable(
  "sepa_transfer_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transferId: uuid("transfer_id")
      .notNull()
      .references(() => sepaTransfers.id),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    endToEndId: text("end_to_end_id").notNull().unique(),
    /** Überwiesener Betrag in Cent, nach Skonto */
    amount: integer("amount").notNull(),
    /** Abgezogenes Skonto in Cent; 0 ohne */
    skonto: integer("skonto").notNull().default(0),
    creditorName: text("creditor_name").notNull(),
    creditorIban: text("creditor_iban").notNull(),
    remittance: text("remittance").notNull(),
  },
  (t) => [index("sepa_transfer_items_document").on(t.documentId), check("sepa_transfer_items_amount", sql`${t.amount} > 0 and ${t.skonto} >= 0`)],
);

/** Erzeugte Lastschriftdateien (pain.008, #445) mit Gläubigerkonto, Anzahl, Summe und XML; nur anhängen */
export const sepaDirectDebits = pgTable("sepa_direct_debits", {
  id: uuid("id").primaryKey().defaultRandom(),
  bankAccountId: uuid("bank_account_id")
    .notNull()
    .references(() => bankAccounts.id),
  /** MsgId der Datei, zugleich Dateiname */
  messageId: text("message_id").notNull().unique(),
  numberOfTransactions: integer("number_of_transactions").notNull(),
  controlSum: bigint("control_sum", { mode: "number" }).notNull(),
  /** Die Datei, wie sie heruntergeladen wurde */
  xml: text("xml").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Eine Lastschrift der Datei je Rechnung: Mandat, Sequenz, Fälligkeit und Sammler (PmtInfId). Die Bank schreibt jeden
 * Sammler als eine Summe gut; der Bankabgleich teilt sie über diese Zeilen auf die Rechnungen auf. Zählt als Einzug für
 * den Verfall des Mandats nach 36 Monaten.
 */
export const sepaDirectDebitItems = pgTable(
  "sepa_direct_debit_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    directDebitId: uuid("direct_debit_id")
      .notNull()
      .references(() => sepaDirectDebits.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    mandateId: uuid("mandate_id")
      .notNull()
      .references(() => sepaMandates.id),
    paymentInfoId: text("payment_info_id").notNull(),
    endToEndId: text("end_to_end_id").notNull().unique(),
    scheme: text("scheme", { enum: ["CORE", "B2B"] }).notNull(),
    sequence: text("sequence", { enum: ["FRST", "RCUR"] }).notNull(),
    collectionDate: date("collection_date", { mode: "string" }).notNull(),
    /** Eingezogener Betrag in Cent */
    amount: integer("amount").notNull(),
    debtorName: text("debtor_name").notNull(),
    debtorIban: text("debtor_iban").notNull(),
    remittance: text("remittance").notNull(),
  },
  (t) => [
    index("sepa_direct_debit_items_invoice").on(t.invoiceId),
    index("sepa_direct_debit_items_mandate").on(t.mandateId),
    index("sepa_direct_debit_items_payment_info").on(t.paymentInfoId),
    check("sepa_direct_debit_items_amount", sql`${t.amount} > 0`),
    check("sepa_direct_debit_items_scheme", sql`${t.scheme} in ('CORE', 'B2B')`),
    check("sepa_direct_debit_items_sequence", sql`${t.sequence} in ('FRST', 'RCUR')`),
  ],
);

/**
 * Entscheidung je Beleg, welche IBAN gilt, wenn die E-Rechnung (BT-84) eine andere nennt als der Kontakt (#410): die
 * des Kontakts oder die der E-Rechnung nur für diesen Beleg; hat der Kontakt keine IBAN, die Bestätigung der IBAN aus der
 * E-Rechnung (kontakt_iban leer). Gilt nur für genau dieses Paar; ändert sich eine der
 * beiden, ist neu zu entscheiden. Nur anhängbar, auch nach dem Buchen (Trigger in drizzle/); die jüngste gilt.
 */
export const documentIbanDecisions = pgTable(
  "document_iban_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    /** IBAN im Kontakt beim Entscheiden, ohne Leerzeichen; null = Kontakt ohne IBAN, die der E-Rechnung bestätigt */
    kontaktIban: text("kontakt_iban"),
    /** IBAN aus der E-Rechnung, ohne Leerzeichen */
    rechnungsIban: text("rechnungs_iban").notNull(),
    wahl: text("wahl", { enum: ["kontakt", "e-rechnung"] }).notNull(),
    /** Wer entschieden hat (Benutzer-ID wie im Audit-Log) */
    decidedBy: text("decided_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("document_iban_decisions_document").on(t.documentId),
    check("document_iban_decisions_wahl", sql`${t.wahl} in ('kontakt', 'e-rechnung')`),
    check("document_iban_decisions_abweichend", sql`${t.kontaktIban} is null or ${t.kontaktIban} <> ${t.rechnungsIban}`),
    // Ohne IBAN im Kontakt gibt es nur die Bestätigung der IBAN aus der E-Rechnung
    check("document_iban_decisions_bestaetigt", sql`${t.kontaktIban} is not null or ${t.wahl} = 'e-rechnung'`),
  ],
);

export const allocationKindEnum = pgEnum("allocation_kind", [
  "invoice",
  "document",
  "privat",
  "geldtransit",
  "ustVorauszahlung",
  "gebuehren",
  "mahnerloes",
  "kursdifferenz",
  "kapest",
  "sondervorauszahlung",
  // Zahlungen aus der Lohnabrechnung (docs/lohn-plan.md, PR 4)
  "lohn",
  "lohnsteuer",
  "sozialversicherung",
  // Steuerzahlungen mit Steuerart, Bezugsjahr und Teil; betriebliche Zinserträge (Roadmap Platz 13)
  "steuer",
  "zinsertrag",
  // Auszahlung, Tilgung, Zinsen und Gebühren eines Darlehens (loans)
  "darlehen",
  // Direkt auf eine Einnahme- oder Ausgabekategorie mit Steuersatz (Roadmap Platz 1, #324)
  "kategorie",
  // Private Spende vom Geschäftskonto auf das Privatkonto „Zuwendungen, Spenden“ (Einzelunternehmen)
  "spende",
]);

/**
 * Darlehen, die das Unternehmen aufgenommen hat (packages/core/src/darlehen.ts): Geber und Restlaufzeit bestimmen das
 * Konto, der Zweck das Zinskonto. Ein laufendes Darlehen bringt seine Restschuld zum Stichtag mit. Nach der ersten
 * Zuordnung sind die Grundlagen fest (Trigger), nur der Name bleibt änderbar.
 */
export const loans = pgTable("loans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  lender: text("lender", { enum: DARLEHENSGEBER_KEYS }).notNull(),
  term: text("term", { enum: DARLEHEN_LAUFZEIT_KEYS }).notNull(),
  purpose: text("purpose", { enum: DARLEHEN_ZWECK_KEYS }).notNull(),
  /** Restschuld eines übernommenen Darlehens am Stichtag; 0 bei einem neuen */
  openingBalance: integer("opening_balance").notNull().default(0),
  openingDate: date("opening_date", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Zuordnung eines Bankumsatzes (ganz oder teilweise) zu Rechnung, Beleg oder einer Buchung ohne Beleg.
 * Nur anhängen; aufgehoben wird per Gegenzeile mit negativem Betrag (reversesId).
 */
export const allocations = pgTable(
  "allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => bankTransactions.id),
    kind: allocationKindEnum("kind").notNull(),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    documentId: uuid("document_id").references(() => documents.id),
    /** Mit dem Vorzeichen des Umsatzes; Teile einer Aufteilung auch mit umgekehrtem (z. B. Gebühr in einer Auszahlung) */
    amount: integer("amount").notNull(),
    /** Teile einer Aufteilung (Splitbuchung) tragen dieselbe ID und werden nur zusammen aufgehoben */
    splitId: uuid("split_id"),
    reversesId: uuid("reverses_id"),
    /**
     * Rechnung: Netto und Steuer je Satz, wie gebucht (settlementTaxShares). Voranmeldung und EÜR lesen diese Werte, damit
     * alle Zahlungen zusammen genau die Steuer der Rechnung ergeben. Ältere Zuordnungen ohne: aus dem Betrag gerechnet.
     */
    taxShares: jsonb("tax_shares").$type<TaxShare[]>(),
    /** Rechnung, für die taxShares gerechnet sind; hängt die Zuordnung woanders, gilt der Anteil nicht (recordedTaxShares) */
    taxSharesInvoiceId: uuid("tax_shares_invoice_id"),
    /**
     * Nur bei „Umsatzsteuer an das Finanzamt“: die Voranmeldung, deren Zahllast bzw. Erstattung die Zahlung betrifft
     * (offener Posten). Gebucht wird wie ohne Bezug; ältere Zuordnungen haben keinen.
     */
    vatReturnId: uuid("vat_return_id").references(() => vatReturns.id),
    /**
     * Nur bei Steuerzahlungen (kind „steuer“): Steuerart, Bezugsjahr und Teil (Steuer oder Nebenleistung), siehe
     * packages/core/src/steuerzahlung.ts. Mit der Zeile gesperrt und versiegelt; die Gegenzeile trägt dieselben Angaben.
     */
    taxType: text("tax_type", { enum: STEUERART_KEYS }),
    taxYear: integer("tax_year"),
    taxItem: text("tax_item", { enum: STEUER_POSTEN_KEYS }),
    /** Nur bei Darlehen (kind „darlehen“): das Darlehen und der Teil (Auszahlung, Tilgung, Zinsen, Gebühren) */
    loanId: uuid("loan_id").references(() => loans.id),
    loanPart: text("loan_part", { enum: DARLEHEN_TEIL_KEYS }),
    /**
     * Nur bei „Direkt buchen“ auf eine Kategorie (kind „kategorie“): Einnahme- oder Ausgabekategorie und Steuersatz in
     * Basispunkten, siehe packages/core/src/direkt-kategorie.ts. Voranmeldung und EÜR lesen sie von hier; die Gegenzeile
     * trägt dieselben Angaben. Kein Enum: Die Ausgabekategorien wachsen, gebuchte Werte bleiben gültig.
     */
    category: text("category").$type<DirektKategorie>(),
    taxRate: integer("tax_rate"),
    /**
     * Rücklastschrift (#445): die zurückgegebene Lastschrift. Die Zuordnung auf die Rechnung ist dann negativ und öffnet
     * sie wieder; die Gegenzeile beim Aufheben trägt denselben Bezug. Nur an Zuordnungen auf eine Rechnung.
     */
    directDebitItemId: uuid("direct_debit_item_id").references((): AnyPgColumn => sepaDirectDebitItems.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("allocations_direct_debit", sql`${t.directDebitItemId} is null or ${t.kind}::text = 'invoice'`),
    index("allocations_direct_debit").on(t.directDebitItemId),
    check("allocations_target", sql`(${t.kind} <> 'invoice' or ${t.invoiceId} is not null) and (${t.kind} <> 'document' or ${t.documentId} is not null)`),
    // Als Text verglichen: Ein neuer Wert des Enums ist in der Transaktion, die ihn anlegt, noch nicht verwendbar
    check(
      "allocations_tax",
      sql`case when ${t.kind}::text = 'steuer' then ${t.taxType} is not null and ${t.taxYear} is not null and ${t.taxItem} is not null else ${t.taxType} is null and ${t.taxYear} is null and ${t.taxItem} is null end`,
    ),
    check("allocations_vat_return_kind", sql`${t.vatReturnId} is null or ${t.kind} = 'ustVorauszahlung'`),
    check(
      "allocations_kategorie",
      sql`case when ${t.kind}::text = 'kategorie' then ${t.category} is not null and ${t.taxRate} is not null else ${t.category} is null and ${t.taxRate} is null end`,
    ),
    check(
      "allocations_loan",
      sql`case when ${t.kind}::text = 'darlehen' then ${t.loanId} is not null and ${t.loanPart} is not null else ${t.loanId} is null and ${t.loanPart} is null end`,
    ),
    index("allocations_loan").on(t.loanId),
    index("allocations_vat_return").on(t.vatReturnId),
    index("allocations_transaction").on(t.transactionId),
    index("allocations_invoice").on(t.invoiceId),
    index("allocations_document").on(t.documentId),
    index("allocations_split").on(t.splitId),
    foreignKey({ name: "allocations_reverses_fk", columns: [t.reversesId], foreignColumns: [t.id] }),
  ],
);

/**
 * Verrechnung zweier gegenläufiger Umsätze desselben Kontos, die sich aufheben (#457), etwa +1,00 € und −1,00 € einer
 * Kartenprüfung. Beide gelten danach als erledigt, ohne Buchung und ohne Wirkung auf Voranmeldung und EÜR; die Umsätze
 * selbst bleiben unverändert. Nur anhängen; aufgehoben wird per Gegenzeile (reversesId) mit denselben Umsätzen. Der
 * Trigger in drizzle/ prüft Summe null, dasselbe Konto, keine Zuordnung und höchstens eine gültige Verrechnung je Umsatz.
 */
export const bankNeutralizations = pgTable(
  "bank_neutralizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => bankTransactions.id),
    counterTransactionId: uuid("counter_transaction_id")
      .notNull()
      .references(() => bankTransactions.id),
    /** Begründung, etwa „PayPal-Autorisierung mit automatischer Rückbuchung“; Pflicht bei der Verrechnung, bei der Gegenzeile frei */
    note: text("note").notNull().default(""),
    reversesId: uuid("reverses_id"),
    /** Wer verrechnet bzw. aufgehoben hat (Benutzer-ID wie im Audit-Log) */
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("bank_neutralizations_two", sql`${t.transactionId} <> ${t.counterTransactionId}`),
    check("bank_neutralizations_note", sql`${t.reversesId} is not null or length(btrim(${t.note})) > 0`),
    index("bank_neutralizations_transaction").on(t.transactionId),
    index("bank_neutralizations_counter").on(t.counterTransactionId),
    uniqueIndex("bank_neutralizations_reverses").on(t.reversesId),
    foreignKey({ name: "bank_neutralizations_reverses_fk", columns: [t.reversesId], foreignColumns: [t.id] }),
  ],
);

/**
 * Ausbuchung des Rests einer Rechnung oder eines Belegs (§ 17 UStG): gewährtes Skonto, Forderungsausfall,
 * erhaltenes Skonto. Zählt wie eine Zahlung zum Erledigten (Vorzeichen wie eine Zahlung: Rechnung positiv,
 * Beleg negativ), bewegt aber kein Geld. Nur anhängen; aufgehoben wird per Gegenzeile (reversesId).
 */
export const writeOffs = pgTable(
  "write_offs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: ["skonto", "forderungsausfall", "skontoErhalten", "kursdifferenz"] }).notNull(),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    documentId: uuid("document_id").references(() => documents.id),
    date: date("date", { mode: "string" }).notNull(),
    amount: integer("amount").notNull(),
    /** Zahlung, mit der zusammen ausgebucht wurde (Rest als Skonto); wird mit deren Zuordnung aufgehoben */
    transactionId: uuid("transaction_id").references(() => bankTransactions.id),
    /** Ebenso bei einer Bareinnahme: die Zeile im Kassenbuch; wird mit deren Storno aufgehoben */
    cashEntryId: uuid("cash_entry_id").references(() => cashEntries.id),
    reversesId: uuid("reverses_id"),
    /** Rechnung: Netto und Steuer je Satz, wie gebucht, und für welche Rechnung (wie bei allocations) */
    taxShares: jsonb("tax_shares").$type<TaxShare[]>(),
    taxSharesInvoiceId: uuid("tax_shares_invoice_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "write_offs_target",
      sql`(${t.kind} = 'skontoErhalten' and ${t.documentId} is not null and ${t.invoiceId} is null) or (${t.kind} in ('skonto', 'forderungsausfall') and ${t.invoiceId} is not null and ${t.documentId} is null) or (${t.kind} = 'kursdifferenz' and (${t.invoiceId} is null) <> (${t.documentId} is null) and ${t.transactionId} is not null)`,
    ),
    index("write_offs_invoice").on(t.invoiceId),
    index("write_offs_document").on(t.documentId),
    index("write_offs_transaction").on(t.transactionId),
    index("write_offs_cash_entry").on(t.cashEntryId),
    check("write_offs_payment", sql`${t.transactionId} is null or ${t.cashEntryId} is null`),
    foreignKey({ name: "write_offs_reverses_fk", columns: [t.reversesId], foreignColumns: [t.id] }),
  ],
);

/**
 * Verrechnung zweier Eingangsbelege ohne Zahlung: eine Gutschrift des Lieferanten gleicht eine
 * Rechnung aus (#274). Wie bank_neutralizations bewegt sie kein Geld und erfindet keinen Bankumsatz;
 * festgehalten wird nur, dass sich zwei offene Posten gegenseitig erledigen. Je Verrechnung zwei
 * Zeilen, damit jede Seite für sich als erledigt zählt: die eine mit negativem Betrag beim Beleg,
 * die andere mit positivem beim Gegenbeleg. Nur anhängen, aufgehoben wird per Gegenzeile.
 */
export const documentSettlements = pgTable(
  "document_settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Beleg, dessen offener Betrag sich mit dieser Zeile ändert */
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    /** Beleg, gegen den verrechnet wird */
    counterDocumentId: uuid("counter_document_id")
      .notNull()
      .references(() => documents.id),
    /**
     * Kennung des Paars: beide Zeilen einer Verrechnung tragen dieselbe. Die Aufhebung findet damit genau dieses Paar,
     * auch wenn zwischen denselben Belegen mehrfach derselbe Betrag verrechnet wurde; die Gegenzeilen einer Aufhebung
     * bilden ein neues Paar.
     */
    settlementId: uuid("settlement_id").notNull().defaultRandom(),
    date: date("date", { mode: "string" }).notNull(),
    /** Vorzeichen wie eine Zahlung: negativ beim Beleg, positiv bei der Gutschrift */
    amount: integer("amount").notNull(),
    note: text("note").notNull().default(""),
    reversesId: uuid("reverses_id"),
    /** Wer verrechnet bzw. aufgehoben hat (Benutzer-ID wie im Audit-Log) */
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("document_settlements_two", sql`${t.documentId} <> ${t.counterDocumentId}`),
    check("document_settlements_amount", sql`${t.amount} <> 0`),
    index("document_settlements_document").on(t.documentId),
    index("document_settlements_counter").on(t.counterDocumentId),
    index("document_settlements_settlement").on(t.settlementId),
    /** Je Paar höchstens eine Zeile pro Beleg: genau zwei Zeilen, eine je Seite */
    uniqueIndex("document_settlements_settlement_document").on(t.settlementId, t.documentId),
    uniqueIndex("document_settlements_reverses").on(t.reversesId),
    foreignKey({ name: "document_settlements_reverses_fk", columns: [t.reversesId], foreignColumns: [t.id] }),
  ],
);

/**
 * Umsatzsteuer-Umrechnungskurse (§ 16 Abs. 6 UStG) je Währung und Monat: 1 EUR = rate. Abgerufen vom BMF oder von Hand
 * eingetragen. Belege und Rechnungen speichern den verwendeten Kurs selbst; ein später geänderter Kurs ändert sie nicht.
 */
export const exchangeRates = pgTable(
  "exchange_rates",
  {
    currency: text("currency").notNull(),
    /** JJJJ-MM */
    month: text("month").notNull(),
    rate: numeric("rate", { precision: 12, scale: 6 }).notNull(),
    source: text("source", { enum: ["bmf", "manuell"] }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.currency, t.month] }),
    check("exchange_rates_currency", sql`${t.currency} ~ '^[A-Z]{3}$' and ${t.currency} <> 'EUR'`),
    check("exchange_rates_month", sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("exchange_rates_rate", sql`${t.rate} > 0`),
  ],
);

/**
 * Original-Exporte und Nachweise (DATEV, IDEA, ELSTER-Protokolle, Kontoauszüge) unverändert unter ihrem SHA-256.
 * Nur anhängen.
 */
export const archiveFiles = pgTable(
  "archive_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: ["datev", "idea", "elster", "kontoauszug", "storebericht", "sonstiges"] }).notNull(),
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

/**
 * Personenkonten, die ein DATEV-Export schon geschrieben hat (#327), je Kontakt und Rolle die erste Ausgabe. Nur anhängen;
 * ab hier ist die Nummer am Kontakt fest (Trigger in 0172), damit spätere Stapel dasselbe Konto tragen wie frühere.
 */
export const datevPersonenkonten = pgTable(
  "datev_personenkonten",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    rolle: text("rolle", { enum: ["debitor", "kreditor"] }).notNull(),
    nummer: integer("nummer").notNull(),
    /** Jahr des Stapels, in dem die Nummer zuerst stand */
    jahr: integer("jahr").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("datev_personenkonten_kontakt").on(t.contactId, t.rolle),
    uniqueIndex("datev_personenkonten_nummer").on(t.rolle, t.nummer),
    check("datev_personenkonten_rolle", sql`${t.rolle} in ('debitor', 'kreditor')`),
  ],
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

/** App-Stores, deren Finanzberichte Haben abruft (Google Play Console, App Store Connect) */
export const STORES = ["googleplay", "appstore"] as const;
export type Store = (typeof STORES)[number];

/** Nicht geheime Angaben eines Store-Zugangs; das Geheimnis (Servicekonto-JSON bzw. .p8) steht nur in ciphertext */
export type StoreConfig = (
  | { store: "googleplay"; bucket: string; clientEmail: string }
  | { store: "appstore"; issuerId: string; keyId: string; vendorNumber: string }
) & {
  /** Kontakt der Store-Gesellschaft (Google Commerce Ltd, Apple Distribution International Ltd …) für die Rechnungsentwürfe */
  contactId?: string;
};

/**
 * Zugang zu den Finanzberichten eines App-Stores, eine Zeile je Store. Der Abruf legt die Berichte unverändert ins Archiv
 * (store_reports); fetch_from ist der älteste Berichtsmonat, den der nächste Abruf noch sucht.
 */
export const storeConnections = pgTable(
  "store_connections",
  {
    store: text("store", { enum: STORES }).primaryKey(),
    config: jsonb("config").$type<StoreConfig>().notNull(),
    /** Servicekonto-JSON (Google) bzw. privater Schlüssel .p8 (Apple), AES-256-GCM-verschlüsselt; bleibt aus dem Audit-Log */
    ciphertext: bytea("ciphertext").notNull(),
    /** Erster Berichtsmonat (Tag 1), den der Abruf noch sucht */
    fetchFrom: date("fetch_from").notNull(),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("store_connections_store", sql`${t.store} in ('googleplay', 'appstore')`),
    check("store_connections_config", sql`${t.config}->>'store' = ${t.store}`),
  ],
);

/**
 * Abgerufene Finanzberichte der App-Stores, je Store, Berichtsart, Monat und Teil genau einer; das Original liegt im
 * Archiv. Nur anhängen: Ein später geänderter Bericht desselben Monats ersetzt den ersten nicht.
 */
export const storeReports = pgTable(
  "store_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    store: text("store", { enum: STORES }).notNull(),
    /** earnings (Google Play, earnings_YYYYMM.zip) oder finance_detail (App Store Connect, FINANCE_DETAIL/Z1) */
    reportKind: text("report_kind", { enum: ["earnings", "finance_detail"] }).notNull(),
    /**
     * Teil des Monats: bei Google der Objektname im Bucket (ein Monat kann aus mehreren Dateien bestehen), bei Apple die
     * Berichtsregion (Z1)
     */
    part: text("part").notNull(),
    /** Berichtsmonat YYYY-MM; bei Apple der Fiskalmonat */
    period: text("period").notNull(),
    sha256: text("sha256").notNull(),
    archiveFileId: uuid("archive_file_id")
      .notNull()
      .references(() => archiveFiles.id),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("store_reports_period").on(t.store, t.reportKind, t.period, t.part),
    check("store_reports_period_format", sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check(
      "store_reports_kind",
      sql`(${t.store} = 'googleplay' and ${t.reportKind} = 'earnings') or (${t.store} = 'appstore' and ${t.reportKind} = 'finance_detail')`,
    ),
  ],
);

/**
 * Auszahlungen der App-Stores: Der Bankeingang wird als Geldtransit mit einem Auszahlungsumsatz im Konto des Stores
 * verbunden, den Haben dafür anlegt; covered nennt die Monatsumsätze (bank_reference), die damit bezahlt sind. Bei
 * Apple gleicht ein weiterer Umsatz die Kursdifferenz zwischen umgerechneten Monatsbeträgen und Zahlung aus. Nur anhängen.
 */
export const storePayouts = pgTable("store_payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  store: text("store", { enum: STORES }).notNull(),
  /** Eingang auf dem Bankkonto */
  bankTransactionId: uuid("bank_transaction_id")
    .notNull()
    .unique()
    .references(() => bankTransactions.id),
  /** Angelegte Auszahlung im Konto des Stores */
  payoutTransactionId: uuid("payout_transaction_id")
    .notNull()
    .unique()
    .references(() => bankTransactions.id),
  /** Angelegte Kursdifferenz im Konto des Stores; null ohne Differenz */
  differenceTransactionId: uuid("difference_transaction_id").references(() => bankTransactions.id),
  covered: text("covered").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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

/** API-Token für sevDesk, AES-256-GCM-verschlüsselt; eine Zeile */
export const sevdeskConnection = pgTable(
  "sevdesk_connection",
  {
    id: smallint("id").primaryKey().default(1),
    ciphertext: bytea("ciphertext").notNull(),
    /** "1.0" oder "2.0" (sevDesk-Update 2.0) */
    bookkeepingVersion: text("bookkeeping_version").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("sevdesk_connection_single_row", sql`${t.id} = 1`)],
);

/** Woher ein Altbestand stammt */
export const LEGACY_SOURCES = ["lexoffice", "sevdesk", "buchhaltungsbutler", "accountable", "import"] as const;
export type LegacySource = (typeof LEGACY_SOURCES)[number];

/**
 * Analyse und offene Posten eines Accountable-Laufs. Steht als JSON am Fortschritt, damit Status und Oberfläche sie ohne
 * erneutes Entpacken lesen; nur der Accountable-Lauf setzt sie. Felder ohne `unknown`, damit die Server Function den
 * Fortschritt ausgeben kann (Screen-Ausgabe verlangt serialisierbare Typen).
 */
export type AccountableProgress = {
  filename: string;
  size: number;
  year: number | null;
  bookings: number;
  vouchers: number;
  withFile: number;
  withoutFile: number;
  privateRows: number;
  missingReceipts: number;
  unknownTaxRows: number;
  invoices: { number: string; documentDate: string; gross: number; text: string; row: number }[];
  openItems: { number: string; supplier: string; gross: number; date: string; reason: string }[];
  /** Wie viele Buchungen ohne Belegdatei; openItems ist gekürzt */
  openItemCount: number;
  archivedFileId?: string;
  archivedAlready?: boolean;
  note?: string;
};

export type LexofficeImportProgress = {
  phase: "kontakte" | "liste" | "belege" | "fertig";
  contacts: number;
  contactsLinked: number;
  listed: number;
  imported: number;
  skipped: number;
  files: number;
  failed: { lexofficeId: string; number: string; message: string }[];
  /** BuchhaltungsButler: Archivdateien mit dem DATEV-Stapel des Exports, auch wenn sie schon vorher im Archiv lagen */
  datevFileIds?: string[];
  /** Accountable: Analyse des Exports und offene Posten; nur beim Accountable-Lauf gesetzt */
  accountable?: AccountableProgress;
};

/** Abrufe über die API; der Fortschritt wird während des Laufs fortgeschrieben. */
export const lexofficeImports = pgTable(
  "lexoffice_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source", { enum: LEGACY_SOURCES }).notNull().default("lexoffice"),
    status: text("status", { enum: ["laeuft", "fertig", "fehler", "abgebrochen"] })
      .notNull()
      .default("laeuft"),
    progress: jsonb("progress").$type<LexofficeImportProgress>().notNull(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  // höchstens ein laufender Abruf, gleich aus welcher Quelle
  (t) => [uniqueIndex("lexoffice_imports_one_running").on(t.status).where(sql`${t.status} = 'laeuft'`)],
);

export type LegacyTaxRow = { rate: number; net: number; tax: number };
export type LegacyCategoryRow = { categoryId: string; name: string; rate: number; net: number; tax: number };
export type LegacyPayment = {
  status: string;
  openAmount: number;
  paidDate: string | null;
  items: { type: string; date: string; amount: number; account?: string | null }[];
  /** Nur gelesen, nie gespeichert: items aus legacy_voucher_payments (sevdesk) bzw. Rechnung und ihr Storno ohne Zahlung */
  history?: "sevdesk" | "import" | "storno";
  /** Nur gelesen: Datum der Stornorechnung bei history "storno" */
  cancelledOn?: string;
};

/** Kaufmännische Dokumente ohne Buchungswirkung. Der Quellstand bleibt unverändert; Dateien sind getrennte Nachträge. */
export const legacyOrderDocuments = pgTable(
  "legacy_order_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalId: text("external_id").notNull().unique(),
    source: text("source", { enum: LEGACY_SOURCES }).notNull().default("sevdesk"),
    importId: uuid("import_id")
      .notNull()
      .references(() => lexofficeImports.id),
    kind: text("kind", { enum: ["AN", "AB", "LI"] }).notNull(),
    number: text("number").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    status: text("status").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id),
    contactName: text("contact_name").notNull(),
    currency: text("currency").notNull(),
    net: integer("net"),
    tax: integer("tax"),
    gross: integer("gross"),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("legacy_order_documents_date").on(t.date)],
);

/** Manuell nachgereichte Original-PDFs; jeder Dateistand bleibt erhalten. */
export const legacyOrderFiles = pgTable(
  "legacy_order_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => legacyOrderDocuments.id),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sha256: text("sha256").notNull(),
    size: integer("size").notNull(),
    origin: text("origin", { enum: ["sevdesk", "manuell", "import"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("legacy_order_files_unique").on(t.orderId, t.sha256)],
);

/** Nachweis jedes begonnenen automatischen PDF-Abrufs, auch wenn kein PDF übernommen werden konnte. */
export const legacyOrderPdfAttempts = pgTable(
  "legacy_order_pdf_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => legacyOrderDocuments.id),
    bookkeepingVersion: text("bookkeeping_version").notNull(),
    before: jsonb("before").$type<Record<string, unknown>>().notNull(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("legacy_order_pdf_attempts_order").on(t.orderId)],
);

/**
 * Rechnungen, Gutschriften und Belege aus Lexoffice, sevDesk oder BuchhaltungsButler mit unveränderten Quelldaten. Nur anhängen.
 * Beträge in Cent, Gutschriften negativ. Bei sevDesk steht in lexoffice_id "<art>/<id>", z. B. "invoice/123".
 */
export const lexofficeVouchers = pgTable(
  "lexoffice_vouchers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lexofficeId: text("lexoffice_id").notNull().unique(),
    source: text("source", { enum: LEGACY_SOURCES }).notNull().default("lexoffice"),
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

/**
 * Einzelzahlungen eines archivierten Belegs, so wie die Quelle sie zugeordnet hat (sevDesk: CheckAccountTransactionLog).
 * Nur anhängen. Die Archivkopie in lexoffice_vouchers bleibt unverändert; ein späterer Abruf ergänzt fehlende Zahlungen.
 * Betrag in Cent mit dem Vorzeichen der Zahlungsrichtung; bei einem geteilten Umsatz nur der diesem Beleg zugeordnete Teil.
 */
export const legacyVoucherPayments = pgTable(
  "legacy_voucher_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    voucherId: uuid("voucher_id")
      .notNull()
      .references(() => lexofficeVouchers.id),
    importId: uuid("import_id")
      .notNull()
      .references(() => lexofficeImports.id),
    source: text("source", { enum: LEGACY_SOURCES }).notNull(),
    /** Kennung der Zuordnung in der Quelle; verhindert doppelte Zahlungen bei erneutem Abruf */
    externalId: text("external_id").notNull(),
    transactionId: text("transaction_id"),
    accountId: text("account_id"),
    accountName: text("account_name"),
    date: date("date").notNull(),
    amount: integer("amount").notNull(),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("legacy_voucher_payments_source_external").on(t.source, t.externalId), index("legacy_voucher_payments_voucher").on(t.voucherId)],
);

/**
 * Kontostamm eines Buchungskontos aus sevDesk (GET /AccountingType/{id}), unverändert. Gutschriften mit `bookingCategory`
 * ACCOUNTING_TYPE folgen zur Laufzeit dessen Kontonummern (#472). Nur anhängen; ein gleicher Stand kommt nur einmal an.
 */
export const sevdeskAccountingTypes = pgTable(
  "sevdesk_accounting_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importId: uuid("import_id")
      .notNull()
      .references(() => lexofficeImports.id),
    accountingTypeId: text("accounting_type_id").notNull(),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sevdesk_accounting_types_stand").on(t.accountingTypeId, sql`md5(${t.raw}::text)`)],
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
    /** Degressive AfA (§ 7 Abs. 2 EStG): fester Satz in Basispunkten, 3000 = 30 % */
    degressiveRate: smallint("degressive_rate"),
    /** Degressive AfA: ab diesem Jahr linear (§ 7 Abs. 3 EStG); auch nach der ersten Buchung für spätere Jahre setzbar */
    linearFromYear: smallint("linear_from_year"),
    /** Erinnerungswert von 1 € bis zum Abgang */
    memoValue: boolean("memo_value").notNull().default(false),
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
    check(
      "assets_degressive_rate",
      sql`(${t.method} = 'degressiv') = (${t.degressiveRate} is not null) and coalesce(${t.degressiveRate}, 1) between 1 and 3000`,
    ),
    check("assets_linear_from_year", sql`${t.linearFromYear} is null or ${t.method} = 'degressiv'`),
    check("assets_elektro_kfz", sql`${t.method} <> 'elektro' or ${t.kind} = 'kfz'`),
    foreignKey({ name: "assets_opening_entry_fk", columns: [t.openingEntryId], foreignColumns: [journalEntries.id] }),
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
    /** Einleitung über den Positionen; Platzhalter wie bei den Positionen */
    intro: text("intro").notNull().default(""),
    note: text("note").notNull().default(""),
    taxTreatment: text("tax_treatment", { enum: TAX_TREATMENT_KEYS }).notNull().default("regulaer"),
    exemptionReason: text("exemption_reason").notNull().default(""),
    /** Preise der Positionen netto oder brutto inkl. USt; geht an jede erzeugte Rechnung */
    priceMode: text("price_mode", { enum: PRICE_MODES }).notNull().default("netto"),
    /** detail: Beschreibung unter der Bezeichnung; fehlt bei Vorlagen von vor dem Feld */
    lines: jsonb("lines")
      .$type<{ description: string; detail?: string; itemNumber?: string; quantity: number; unit: string; unitPrice: number; taxRate: number }[]>()
      .notNull(),
    /** Monate zwischen zwei Rechnungen: 1, 3, 6 oder 12 */
    intervalMonths: smallint("interval_months").notNull(),
    /** Tag im Monat, auf den die Termine fallen (31 = Monatsende) */
    anchorDay: smallint("anchor_day").notNull(),
    nextDate: date("next_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    servicePeriod: text("service_period", { enum: ["laufend", "vorher", "keiner"] })
      .notNull()
      .default("laufend"),
    /** entwurf = nur anlegen, festschreiben = Nummer ziehen und buchen */
    mode: text("mode", { enum: ["entwurf", "festschreiben"] })
      .notNull()
      .default("entwurf"),
    /** Zahlungsart der Rechnungen (#445); bei Lastschrift nimmt jeder Lauf das jüngste am Einzugstag gültige Mandat des Kunden */
    paymentMethod: text("payment_method", { enum: PAYMENT_METHODS }).notNull().default("ueberweisung"),
    /** Nur mit festschreiben: die Rechnung gleich per E-Mail an den Kunden schicken */
    sendByMail: boolean("send_by_mail").notNull().default(false),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("recurring_interval", sql`${t.intervalMonths} in (1, 3, 6, 12)`), check("recurring_anchor_day", sql`${t.anchorDay} between 1 and 31`)],
);

/** Mahnungen und Zahlungserinnerungen mit PDF; wie ein verschicktes Schreiben unveränderlich */
export const dunnings = pgTable(
  "dunnings",
  {
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
  },
  (t) => [
    // in 0020 von Hand angelegt
    check("dunnings_level", sql`${t.level} between 1 and 3`),
    index("dunnings_invoice").on(t.invoiceId),
  ],
);

/**
 * Läufe des Backup-Containers (deploy/backup): tägliches Backup und wöchentlicher Test-Restore. Der Container
 * schreibt nach jedem Lauf eine Zeile, die App zeigt den Stand in den Einstellungen und warnt in der Übersicht.
 * Betriebsdaten, keine Buchungsdaten: ohne Audit-Log und Siegel.
 */
export const backupStatus = pgTable(
  "backup_status",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    kind: text("kind", { enum: ["backup", "restore_check"] }).notNull(),
    ok: boolean("ok").notNull(),
    /** restic-Snapshot des Laufs (beim Test-Restore der geprüfte) */
    snapshot: text("snapshot"),
    /** Backup: Größe der gesicherten Daten in Byte */
    bytes: bigint("bytes", { mode: "number" }),
    /** Zusammenfassung oder Fehlermeldung */
    message: text("message").notNull().default(""),
  },
  (t) => [check("backup_status_kind", sql`${t.kind} in ('backup', 'restore_check')`), index("backup_status_kind_at").on(t.kind, t.at)],
);

/**
 * API-Tokens für KI-Assistenten über MCP (/api/mcp) und die REST-API (/api/v1): widerrufbar, mit Ablaufdatum und Rechten. Gespeichert
 * ist nur der SHA-256 des Tokens; das Token selbst gibt es nur beim Anlegen. Zugangsdaten, keine Buchungsdaten: ohne
 * Audit-Log und Siegel (wie die Passkeys).
 */
export const mcpTokens = pgTable("mcp_tokens", {
  createdBy: text("created_by"),
  responsibleId: text("responsible_id"),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  disabledReason: text("disabled_reason"),
  id: uuid("id").primaryKey().defaultRandom(),
  /** Vom Nutzer vergeben, z. B. „Claude Code am Laptop“ */
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  /** Anfang des Tokens zum Wiedererkennen, z. B. hb_3fK9 */
  prefix: text("prefix").notNull(),
  /** Rechte des Tokens, TOKEN_SCOPES in modules/mcp/tokens.ts: haben:lesen für MCP, kontakte:…, rechnungen:… und belege:… für die REST-API */
  scopes: text("scopes").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

/** Protokoll der Werkzeugaufrufe über MCP: Werkzeug, Zeitpunkt, Zugang und Ergebnis, ohne Inhalte. 90 Tage. */
export const mcpCalls = pgTable(
  "mcp_calls",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    tokenId: uuid("token_id")
      .notNull()
      .references(() => mcpTokens.id, { onDelete: "cascade" }),
    tool: text("tool").notNull(),
    ok: boolean("ok").notNull(),
    durationMs: integer("duration_ms").notNull(),
  },
  (t) => [index("mcp_calls_at").on(t.at)],
);

/**
 * Eigene Seiten (#199): Menüeinträge, die eine Seite außerhalb von Haben im Rahmen zeigen, etwa eine Bestellübersicht aus n8n.
 * Haben gibt der Seite weder Sitzung noch Token; sie greift wie jedes Werkzeug mit eigenem API-Token zu. Einstellungen, keine
 * Buchungsdaten: frei änderbar, jede Änderung steht im Änderungsprotokoll.
 */
export const customPages = pgTable("custom_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Text im Menü und Überschrift der Seite */
  name: text("name").notNull(),
  /** http(s)-Adresse auf einem anderen Host als Haben */
  url: text("url").notNull(),
  /** Menüeintrag öffnet die Seite in einem neuen Tab statt im Rahmen (#636), für Seiten, die das Einbetten verbieten */
  openInNewTab: boolean("open_in_new_tab").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/*
 * Lohn (docs/lohn-plan.md, PR 3): Stammdaten der Mitarbeiter, Lohnläufe je Monat und Abrechnungen je Mitarbeiter. Eine
 * festgeschriebene Abrechnung ist gesperrt und versiegelt wie eine Rechnung; korrigiert wird nur mit Storno
 * (payslip_cancellations) und einer neuen Abrechnung, die auf die stornierte verweist.
 */

export type EmployeeStatusfeststellung = "" | "beantragt" | "versicherungsfrei" | "versicherungspflichtig";

/** Angaben eines Mitarbeiters, wie sie in eine Abrechnung eingehen; die Abrechnung hält sie fest (§ 4 Abs. 1 LStDV) */
export interface PayslipMitarbeiter {
  personalnummer: number;
  vorname: string;
  nachname: string;
  strasse: string;
  plz: string;
  ort: string;
  geburtsdatum: string;
  steuerId: string;
  svNummer: string;
  krankenkasse: string;
  krankenkasseBetriebsnummer: string;
  personengruppe: string;
  beitragsgruppen: string;
  taetigkeitsschluessel: string;
  statusfeststellung: EmployeeStatusfeststellung;
  iban: string;
  lohn: LohnStammdaten;
}

/** Stammdaten der Mitarbeiter; änderbar, jede Änderung im Audit-Log. Abrechnungen halten ihren Stand selbst fest */
export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personalnummer: integer("personalnummer").notNull().unique(),
    vorname: text("vorname").notNull(),
    nachname: text("nachname").notNull(),
    strasse: text("strasse").notNull().default(""),
    plz: text("plz").notNull().default(""),
    ort: text("ort").notNull().default(""),
    geburtsdatum: date("geburtsdatum", { mode: "string" }).notNull(),
    /** Steuerliche Identifikationsnummer, 11 Ziffern */
    steuerId: text("steuer_id").notNull().default(""),
    steuerklasse: smallint("steuerklasse").notNull().default(1),
    /** Faktor im Faktorverfahren in Tausendsteln; 1000 ohne */
    faktor: integer("faktor").notNull().default(1000),
    /** Zahl der Kinderfreibeträge in Tausendsteln (0,5 = 500) */
    kinderfreibetraege: integer("kinderfreibetraege").notNull().default(0),
    /** Kirchensteuermerkmal (ELStAM), null ohne */
    konfession: text("konfession", { enum: Object.keys(KONFESSIONEN) as [Konfession, ...Konfession[]] }),
    art: text("art", { enum: Object.keys(BESCHAEFTIGUNGSARTEN) as [Beschaeftigungsart, ...Beschaeftigungsart[]] }).notNull(),
    /** Vereinbartes Monatsgehalt in Cent, das regelmäßige Entgelt */
    monatsgehalt: integer("monatsgehalt").notNull(),
    krankenversicherung: text("krankenversicherung", { enum: ["gesetzlich", "privat"] })
      .notNull()
      .default("gesetzlich"),
    krankenkasse: text("krankenkasse").notNull().default(""),
    /** Betriebsnummer der Krankenkasse (Einzugsstelle), 8 Ziffern */
    krankenkasseBetriebsnummer: text("krankenkasse_betriebsnummer").notNull().default(""),
    /** Kassenindividueller Zusatzbeitrag in Basispunkten */
    zusatzbeitrag: integer("zusatzbeitrag").notNull().default(0),
    /** Privat versichert: Beitrag zur Basiskranken- und Pflege-Pflichtversicherung im Monat und Zuschuss des Arbeitgebers, Cent */
    pkvBasisbeitrag: integer("pkv_basisbeitrag").notNull().default(0),
    pkvZuschuss: integer("pkv_zuschuss").notNull().default(0),
    kinderlosenzuschlag: boolean("kinderlosenzuschlag").notNull().default(false),
    kinderUnter25: smallint("kinder_unter_25").notNull().default(0),
    /** Umlagesätze der Kasse in Basispunkten; U1 null ohne Teilnahme (im Minijob gelten die Sätze der Minijob-Zentrale) */
    u1Satz: integer("u1_satz"),
    u2Satz: integer("u2_satz").notNull().default(0),
    rvBefreit: boolean("rv_befreit").notNull().default(false),
    pauschsteuer: boolean("pauschsteuer").notNull().default(true),
    personengruppe: text("personengruppe").notNull().default(""),
    beitragsgruppen: text("beitragsgruppen").notNull().default(""),
    taetigkeitsschluessel: text("taetigkeitsschluessel").notNull().default(""),
    /** Versicherungsnummer der Rentenversicherung (§ 147 SGB VI) */
    svNummer: text("sv_nummer").notNull().default(""),
    /** Statusfeststellung (§ 7a SGB IV) für Gesellschafter-Geschäftsführer */
    statusfeststellung: text("statusfeststellung", { enum: ["", "beantragt", "versicherungsfrei", "versicherungspflichtig"] })
      .notNull()
      .default(""),
    eintritt: date("eintritt", { mode: "string" }).notNull(),
    austritt: date("austritt", { mode: "string" }),
    iban: text("iban").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("employees_steuerklasse", sql`${t.steuerklasse} between 1 and 6`),
    check("employees_austritt", sql`${t.austritt} is null or ${t.austritt} >= ${t.eintritt}`),
  ],
);

/** Lohnlauf eines Monats mit dem Tag der Lohnzahlung */
export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    year: integer("year").notNull(),
    month: smallint("month").notNull(),
    zahltag: date("zahltag", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("payroll_runs_month").on(t.year, t.month), check("payroll_runs_month_range", sql`${t.month} between 1 and 12`)],
);

/** Abrechnung je Monat und Mitarbeiter; Entwurf bis zum Festschreiben (locked_at), danach gesperrt und versiegelt */
export const payslips = pgTable(
  "payslips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => payrollRuns.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    year: integer("year").notNull(),
    month: smallint("month").notNull(),
    zahltag: date("zahltag", { mode: "string" }).notNull(),
    mitarbeiter: jsonb("mitarbeiter").$type<PayslipMitarbeiter>().notNull(),
    bestandteile: jsonb("bestandteile").$type<Bestandteil[]>().notNull(),
    brutto: integer("brutto").notNull(),
    steuerBrutto: integer("steuer_brutto").notNull(),
    svBrutto: integer("sv_brutto").notNull(),
    pauschalBrutto: integer("pauschal_brutto").notNull(),
    lohnsteuer: integer("lohnsteuer").notNull(),
    soli: integer("soli").notNull(),
    kirchensteuer: integer("kirchensteuer").notNull(),
    /** Anteile des Beschäftigten und Aufwand des Arbeitgebers (Anteile, Umlagen, Pauschsteuer); Einzelheiten in `sv` */
    svArbeitnehmer: integer("sv_arbeitnehmer").notNull(),
    svArbeitgeber: integer("sv_arbeitgeber").notNull(),
    pauschsteuer: integer("pauschsteuer").notNull(),
    sv: jsonb("sv").$type<SvBeitraege>().notNull(),
    netto: integer("netto").notNull(),
    auszahlung: integer("auszahlung").notNull(),
    steuertage: smallint("steuertage").notNull(),
    svTage: smallint("sv_tage").notNull(),
    stufe: text("stufe", { enum: ["A", "B", "C"] }).notNull(),
    /** Stufe C: Entwurf zum Gegenprüfen; festschreiben erst mit der Bestätigung, dass gegengeprüft ist */
    gegenpruefen: boolean("gegenpruefen").notNull(),
    gegengeprueft: boolean("gegengeprueft").notNull().default(false),
    hinweise: jsonb("hinweise").$type<string[]>().notNull().default([]),
    /** Neue Abrechnung nach einem Storno: die stornierte */
    replacesId: uuid("replaces_id").references((): AnyPgColumn => payslips.id),
    pdf: bytea("pdf"),
    sha256: text("sha256"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payslips_employee_month").on(t.employeeId, t.year, t.month),
    uniqueIndex("payslips_replaces").on(t.replacesId),
    check("payslips_final_has_pdf", sql`${t.lockedAt} is null or (${t.pdf} is not null and ${t.sha256} is not null)`),
    check("payslips_month_range", sql`${t.month} between 1 and 12`),
    check("payslips_gegengeprueft", sql`${t.lockedAt} is null or not ${t.gegenpruefen} or ${t.gegengeprueft}`),
  ],
);

/** Storno einer festgeschriebenen Abrechnung; je Abrechnung höchstens eines, nur anhängbar und versiegelt */
export const payslipCancellations = pgTable("payslip_cancellations", {
  id: uuid("id").primaryKey().defaultRandom(),
  payslipId: uuid("payslip_id")
    .notNull()
    .unique()
    .references(() => payslips.id),
  date: date("date", { mode: "string" }).notNull(),
  reason: text("reason").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/*
 * SV-Meldeportal (docs/lohn-plan.md, PR 6): Haben übermittelt nicht an die Sozialversicherung, es erzeugt nur die
 * Ausfüllliste. Hat der Nutzer einen Beitragsnachweis oder eine Meldung im Portal abgegeben, hält er das hier fest, mit
 * Tag, den Werten der Liste zu diesem Zeitpunkt und auf Wunsch dem Protokoll des Portals als Datei. Nur anhängbar; ein
 * versehentlicher Vermerk wird mit einer neuen Zeile zurückgenommen (`revokes_id`), die alte bleibt sichtbar.
 */
export const svPortalFilings = pgTable(
  "sv_portal_filings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Was abgegeben ist, z. B. `beitragsnachweis:2026-11:15027365` oder `anmeldung:<Mitarbeiter>:2026-11-01` */
    gegenstand: text("gegenstand").notNull(),
    art: text("art", { enum: ["beitragsnachweis", "anmeldung", "sofortmeldung", "abmeldung", "jahresmeldung"] }).notNull(),
    titel: text("titel").notNull(),
    employeeId: uuid("employee_id").references(() => employees.id),
    /** Tag der Abgabe im Portal; bei einer Rücknahme der Tag der Rücknahme */
    datum: date("datum", { mode: "string" }).notNull(),
    /** Felder der Ausfüllliste beim Vermerk, um spätere Änderungen zu erkennen */
    werte: jsonb("werte").$type<SvPortalWert[]>().notNull(),
    notiz: text("notiz").notNull().default(""),
    /** Protokoll aus dem Portal im Dokumentenspeicher (storage.ts) */
    protokollSha256: text("protokoll_sha256"),
    protokollDateiname: text("protokoll_dateiname"),
    protokollMimeType: text("protokoll_mime_type"),
    protokollGroesse: integer("protokoll_groesse"),
    /** Rücknahme eines früheren Vermerks */
    revokesId: uuid("revokes_id").references((): AnyPgColumn => svPortalFilings.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sv_portal_filings_gegenstand").on(t.gegenstand),
    uniqueIndex("sv_portal_filings_revokes").on(t.revokesId),
    check(
      "sv_portal_filings_protokoll",
      sql`(${t.protokollSha256} is null) = (${t.protokollDateiname} is null) and (${t.protokollSha256} is null) = (${t.protokollGroesse} is null) and (${t.protokollSha256} is null) = (${t.protokollMimeType} is null)`,
    ),
  ],
);

/** Ein Feld der Ausfüllliste, wie es beim Vermerk stand */
export interface SvPortalWert {
  abschnitt: string;
  name: string;
  wert: string;
}
/**
 * Anmeldungszeitraum der Lohnsteuer je Jahr (§ 41a Abs. 2 EStG), wenn der Nutzer ihn abweichend vom Vorschlag aus der
 * Lohnsteuer des Vorjahres festlegt (das Finanzamt bestimmt ihn). Ein Jahr ohne Zeile folgt dem Vorschlag.
 */
export const lstaTurnus = pgTable("lsta_turnus", {
  year: smallint("year").primaryKey(),
  turnus: text("turnus", { enum: ["monatlich", "vierteljaehrlich", "jaehrlich"] }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Lohnsteuer-Anmeldung (§ 41a EStG): jede Prüfung und Übermittlung, nur anhängen. Eine echt übermittelte Anmeldung
 * bleibt so unverändert; eine Korrektur ist eine neue Zeile als berichtigte Anmeldung (Kz 10) mit allen Kennzahlen.
 */
export const lstaSubmissions = pgTable(
  "lsta_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    year: smallint("year").notNull(),
    /** Zeitraum wie im Schema: 1–12 Monate, 41–44 Kalendervierteljahre, 19 Kalenderjahr */
    zeitraum: smallint("zeitraum").notNull(),
    /** Berichtigte Anmeldung (Kz 10) */
    berichtigt: boolean("berichtigt").notNull().default(false),
    /** Gemeldete Kennzahlen in Cent (LstaKennzahlen aus @haben/core) */
    kennzahlen: jsonb("kennzahlen").$type<LstaKennzahlen>().notNull(),
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
  },
  (t) => [
    index("lsta_submissions_period").on(t.year, t.zeitraum),
    check("lsta_submissions_zeitraum", sql`(${t.zeitraum} between 1 and 12) or (${t.zeitraum} between 41 and 44) or ${t.zeitraum} = 19`),
  ],
);

/** Angaben zu Arbeitnehmer und Arbeitgeber, wie sie in eine Lohnsteuerbescheinigung eingehen (für Ausdruck und Storno) */
export interface LstbAngaben {
  arbeitnehmer: { idnr: string; ordnungsmerkmal: string; vorname: string; nachname: string; geburtsdatum: string; strasse: string; plz: string; ort: string };
  arbeitgeber: { name: string; steuernummer13: string; finanzamt: string; bundesland: string; strasse: string; plz: string; ort: string };
}

/**
 * Elektronische Lohnsteuerbescheinigung (§ 41b EStG) je Arbeitnehmer und Jahr: jede Prüfung und Übermittlung über ERiC und
 * jeder Vermerk einer Übermittlung im ELSTER-Portal, nur anhängen. Eine übermittelte Bescheinigung bleibt so unverändert;
 * Korrektur und Storno sind neue Zeilen, die mit `ref_km_id` auf die vorige verweisen (§ 93c Abs. 3 AO).
 */
export const lstbSubmissions = pgTable(
  "lstb_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    year: smallint("year").notNull(),
    art: text("art", { enum: ["neu", "korrektur", "storno"] }).notNull(),
    /** validate, test, send: über ERiC; portal: vom Nutzer vermerkt, im ELSTER-Portal übermittelt */
    kind: text("kind", { enum: ["validate", "test", "send", "portal"] }).notNull(),
    /** Kennung der Mitteilung; im Portal vergibt ELSTER sie, dann null */
    kmId: text("km_id"),
    refKmId: text("ref_km_id"),
    /** Bescheinigte Werte in Cent (LstbWerte aus @haben/core); null beim Storno und bei einem Vermerk ohne Werte aus Haben */
    werte: jsonb("werte").$type<LstbWerte>(),
    angaben: jsonb("angaben").$type<LstbAngaben>().notNull(),
    /** Tag der Übermittlung */
    datum: date("datum", { mode: "string" }).notNull(),
    grund: text("grund").notNull().default(""),
    ok: boolean("ok").notNull(),
    code: integer("code").notNull(),
    message: text("message").notNull(),
    transferTicket: text("transfer_ticket"),
    requestXml: text("request_xml").notNull(),
    responseXml: text("response_xml").notNull(),
    serverResponseXml: text("server_response_xml").notNull(),
    protocolPdf: bytea("protocol_pdf"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("lstb_submissions_employee_year").on(t.employeeId, t.year),
    // Jede übermittelte Mitteilung hat eine eigene KmId; Prüfungen und Tests dürfen sie wiederholen
    uniqueIndex("lstb_submissions_km_id").on(t.kmId).where(sql`${t.kind} = 'send' and ${t.ok}`),
    check("lstb_submissions_ref", sql`${t.art} = 'neu' or ${t.kind} = 'portal' or ${t.refKmId} is not null`),
  ],
);

/** Token-Verwaltungsereignisse ohne Hash, Geheimnis oder Claims. Nur anhängen, Audit-Log per Trigger. */
export const tokenEvents = pgTable("token_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actor: text("actor").notNull(),
  tokenId: text("token_id").notNull(),
  kind: text("kind").notNull(),
  action: text("action").notNull(),
  previousResponsibleId: text("previous_responsible_id"),
  responsibleId: text("responsible_id"),
});

/** Idempotenz und Herkunft des Betreiberimports; keine zweite Zahlungs- oder Auswertungsquelle. */
export const externalImports = pgTable(
  "external_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    kind: text("kind", { enum: ["invoice", "quote", "journal"] }).notNull(),
    payloadHash: text("payload_hash").notNull(),
    voucherId: uuid("voucher_id").references(() => lexofficeVouchers.id),
    orderDocumentId: uuid("order_document_id").references(() => legacyOrderDocuments.id),
    entryId: uuid("entry_id").references(() => journalEntries.id),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("external_imports_identity").on(t.source, t.kind, t.externalId),
    uniqueIndex("external_imports_voucher").on(t.voucherId),
    uniqueIndex("external_imports_order").on(t.orderDocumentId),
    uniqueIndex("external_imports_entry").on(t.entryId),
    check(
      "external_imports_target",
      sql`(${t.kind} = 'invoice' and ${t.voucherId} is not null and ${t.orderDocumentId} is null and ${t.entryId} is null)
      or (${t.kind} = 'quote' and ${t.orderDocumentId} is not null and ${t.voucherId} is null and ${t.entryId} is null)
      or (${t.kind} = 'journal' and ${t.entryId} is not null and ${t.voucherId} is null and ${t.orderDocumentId} is null)`,
    ),
  ],
);

/** Bestätigte Zahlungsbezüge, auch für bereits übernommene Journalbuchungen. Nur anhängen; Originale bleiben unverändert. */
export const externalImportSettlements = pgTable(
  "external_import_settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentImportId: uuid("payment_import_id")
      .notNull()
      .references(() => externalImports.id),
    originalImportId: uuid("original_import_id")
      .notNull()
      .references(() => externalImports.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("external_import_settlements_payment").on(t.paymentImportId),
    index("external_import_settlements_original").on(t.originalImportId),
    check("external_import_settlements_different", sql`${t.paymentImportId} <> ${t.originalImportId}`),
  ],
);
