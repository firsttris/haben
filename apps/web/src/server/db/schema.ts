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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { Buyer, Seller } from "@haben/einvoice";

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
    kz66: integer("kz66").notNull().default(0),
    kz83: integer("kz83").notNull().default(0),
    status: vatReturnStatusEnum("status").notNull().default("draft"),
    /** Berichtigte Anmeldung (Kz 10) */
    berichtigt: boolean("berichtigt").notNull().default(false),
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
    correctsId: uuid("corrects_id"),
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
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("invoices_final_has_number", sql`${t.status} = 'draft' or (${t.number} is not null and ${t.lockedAt} is not null)`),
    uniqueIndex("invoices_number_counter").on(t.numberYear, t.numberCounter),
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
});

/** Letzte vergebene laufende Nummer je Jahr; lückenlos, weil nur beim Festschreiben gezogen */
export const invoiceNumberCounters = pgTable("invoice_number_counters", {
  year: smallint("year").primaryKey(),
  last: integer("last").notNull(),
});

/** Buchungen. Festgeschrieben ab Entstehung; Korrektur nur per Gegenbuchung. */
export const journalEntries = pgTable("journal_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  date: date("date", { mode: "string" }).notNull(),
  description: text("description").notNull(),
  sourceType: text("source_type", { enum: ["invoice"] }).notNull(),
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
