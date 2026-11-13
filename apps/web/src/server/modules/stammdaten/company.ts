import {
  BASE_RATE_LIMITS,
  kleinunternehmerAm,
  type KleinunternehmerStand,
  BUNDESLAENDER,
  EXPENSE_CATEGORY_KEYS,
  glaeubigerIdProblem,
  normalizeGlaeubigerId,
  RECHTSFORM_KEYS,
  isKapitalgesellschaft,
  legalInfo,
  legalInfoGaps,
  skontoProblem,
  skontoStufenSchema,
  toElsterSteuernummer,
  SteuernummerError,
  type Versteuerung,
} from "@haben/core";
import { and, desc, eq, gte, lt, lte, min, sql } from "drizzle-orm";
import { legalLine } from "@haben/einvoice";
import { z } from "zod";
import { listArticles } from "./articles.ts";
import { listTextBlocks } from "./text-blocks.ts";
import { listContacts } from "./contacts.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { loadDesign } from "./letterhead.ts";
import { backgroundInfo } from "./background.ts";
import { logoInfo } from "./logo.ts";
import { contactPersonOptions } from "./contact-persons.ts";
import { mandateOptions } from "./sepa-mandate.ts";
import { today } from "../../today.ts";

export const companySchema = z
  .object({
    name: z.string().trim().max(200),
    strasse: z.string().trim().max(200),
    plz: z
      .string()
      .trim()
      .regex(/^(\d{5})?$/, "PLZ hat fünf Ziffern"),
    ort: z.string().trim().max(100),
    email: z.union([z.literal(""), z.string().trim().pipe(z.email("Keine gültige E-Mail-Adresse").max(320))]),
    steuernummer: z.string().trim().max(20),
    ustId: z.union([
      z.literal(""),
      z
        .string()
        .trim()
        .regex(/^DE\d{9}$/, "USt-IdNr. hat die Form DE123456789"),
    ]),
    finanzamt: z.string().trim().max(200),
    bundesland: z.enum(Object.keys(BUNDESLAENDER) as [keyof typeof BUNDESLAENDER, ...(keyof typeof BUNDESLAENDER)[]]).nullable(),
    versteuerung: z.enum(["ist", "soll"]),
    telefon: z.string().trim().max(40),
    bank: z.string().trim().max(100),
    iban: z.union([
      z.literal(""),
      z
        .string()
        .trim()
        .regex(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, "IBAN ohne Leerzeichen"),
    ]),
    bic: z.union([
      z.literal(""),
      z
        .string()
        .trim()
        .regex(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/, "BIC hat 8 oder 11 Zeichen"),
    ]),
    /** GiroCode erlaubt 70 Zeichen für den Namen (EPC069-12) */
    kontoinhaber: z.string().trim().max(70).default(""),
    /** Gläubiger-ID für SEPA-Lastschriften (#445); leer = keine, fehlt = leer wie vor #445 */
    glaeubigerId: z
      .string()
      .default("")
      .transform(normalizeGlaeubigerId)
      .superRefine((id, ctx) => {
        const problem = id === "" ? null : glaeubigerIdProblem(id);
        if (problem) ctx.addIssue({ code: "custom", message: problem });
      }),
    kontenrahmen: z.enum(["SKR03", "SKR04"]),
    /** Ohne Vorgabe: Ein fehlendes Feld darf eine GmbH nicht still zum Einzelunternehmen machen */
    rechtsform: z.enum(RECHTSFORM_KEYS),
    /** GmbH und UG: Angaben zum Handelsregister für den Jahresabschluss (§ 264 Abs. 1a HGB) */
    sitz: z.string().trim().max(100).default(""),
    registergericht: z.string().trim().max(100).default(""),
    registernummer: z.string().trim().max(40).default(""),
    /** GmbH und UG: Pflichtangaben auf Geschäftsbriefen (§ 35a Abs. 1 GmbHG); Geschäftsführer einer je Zeile */
    geschaeftsfuehrer: z.string().trim().max(1000).default(""),
    aufsichtsratVorsitz: z.string().trim().max(200).default(""),
    paymentTermDays: z.number().int().min(0).max(120),
    /** Vorgabe für das Skonto neuer Rechnungen; fehlt = unverändert */
    skonto: z.optional(skontoStufenSchema),
    defaultFormat: z.enum(["zugferd", "xrechnung-cii", "xrechnung-ubl"]),
    /** Vorgabe für die Einleitung neuer Rechnungen und Angebote; so lang wie das Feld im Beleg */
    invoiceIntro: z.string().trim().max(2000).default(""),
    quoteIntro: z.string().trim().max(2000).default(""),
    kleinunternehmer: z.boolean(),
    /** Nur steuerfreie Umsätze ohne Vorsteuerabzug (§ 15 Abs. 2 UStG), etwa nach § 4 Nr. 14 oder 21 UStG: Vorgabe für Belege */
    ohneVorsteuerabzug: z.boolean().default(false),
    /** Anlage EÜR: Gewerbebetrieb oder selbständige (freiberufliche) Arbeit und Art des Betriebs */
    einkunftsart: z.enum(["gewerbe", "selbstaendig"]).nullable().default(null),
    taetigkeit: z.string().trim().max(100).default(""),
    /** Vorgabe für den Privatanteil je Belegkategorie in Prozent */
    /** Tageskurs statt der monatlichen USt-Umrechnungskurse, wenn das Finanzamt es gestattet hat */
    tageskurs: z.boolean().default(false),
    privateShares: z.partialRecord(z.enum(EXPENSE_CATEGORY_KEYS), z.number().int().min(0).max(100)).default({}),
    dunning: z
      .object({
        baseRate: z.number().int().min(BASE_RATE_LIMITS.min).max(BASE_RATE_LIMITS.max).nullable(),
        fees: z.object({ "1": z.number().int().min(0).max(100_000), "2": z.number().int().min(0).max(100_000), "3": z.number().int().min(0).max(100_000) }),
        deadlineDays: z.number().int().min(1).max(60),
        /** Basiszinssatz zum 1. Januar und 1. Juli bei der Bundesbank abrufen (opt-in); fehlt = unverändert */
        autoBaseRate: z.boolean().optional(),
      })
      .default({ baseRate: null, fees: { "1": 0, "2": 0, "3": 0 }, deadlineDays: 10 }),
  })
  // Eine Kapitalgesellschaft hat kein Privat: privat Genutztes ist dort Arbeitslohn oder verdeckte Gewinnausschüttung
  .refine((c) => !isKapitalgesellschaft(c.rechtsform) || Object.values(c.privateShares).every((share) => !share), {
    message: "Privatanteile gibt es nur im Einzelunternehmen",
    path: ["privateShares"],
  })
  .superRefine((c, ctx) => {
    const problem = c.skonto ? skontoProblem(c.skonto, c.paymentTermDays) : null;
    if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["skonto"] });
  });

export type CompanyInput = z.infer<typeof companySchema>;
export type Company = typeof schema.company.$inferSelect;

/** Firmendaten; mit `q` in einer laufenden Transaktion gelesen. Fehlt die Zeile, wird sie mit den Vorgaben angelegt. */
export async function loadCompany(q: Db | Tx = db): Promise<Company> {
  const [row] = await q.select().from(schema.company).where(eq(schema.company.id, 1));
  if (row) return row;
  const insert = (w: Db | Tx) => w.insert(schema.company).values({ id: 1 }).onConflictDoNothing().returning();
  const [created] = q === db ? await withActor("system:setup", insert) : await insert(q);
  return created ?? (await loadCompany(q));
}

/**
 * Versteuerung (Ist oder Soll), nach der ein Jahr gebucht ist. Umstellen geht nur zum Jahreswechsel, bevor im neuen
 * Jahr gebucht wird (settings-guard.ts); es gilt also, was beim Anlegen der ersten Buchung des Jahres eingestellt war.
 * Das steht im Audit-Log der Firmendaten. Ohne Buchung im Jahr gilt die aktuelle Einstellung.
 *
 * Wichtig für alles, was frühere Zeiträume rechnet: Voranmeldungen des Vorjahres und vor allem die
 * Umsatzsteuererklärung, die erst im Folgejahr abgegeben wird, nach einem Wechsel also schon unter der neuen Einstellung.
 */
export async function versteuerungForYear(year: number, q: Db | Tx = db): Promise<Versteuerung> {
  const [first] = await q
    .select({ at: min(schema.journalEntries.createdAt) })
    .from(schema.journalEntries)
    .where(and(gte(schema.journalEntries.date, `${year}-01-01`), lt(schema.journalEntries.date, `${year + 1}-01-01`)));
  if (first?.at) {
    const [setting] = await q
      .select({ newValue: schema.auditLog.newValue })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.tableName, "company"), lte(schema.auditLog.at, first.at)))
      .orderBy(desc(schema.auditLog.seq))
      .limit(1);
    const value = (setting?.newValue as { versteuerung?: unknown } | null)?.versteuerung;
    if (value === "ist" || value === "soll") return value;
  }
  return (await loadCompany(q)).versteuerung;
}

/**
 * Ab welchem Jahr Voranmeldung und EÜR aus dem Journal rechnen (#542, docs/adr/journal-als-quelle.md): das eingestellte
 * Stichjahr, sonst das Jahr der ersten Buchung, ohne Buchung das laufende Jahr. Bestehende Instanzen setzt die Migration
 * 0192 auf das Jahr nach dem Update.
 */
export async function journalAbJahr(q: Db | Tx = db): Promise<number> {
  const company = await loadCompany(q);
  if (company.journalAb !== null) return company.journalAb;
  const [first] = await q.select({ date: min(schema.journalEntries.date) }).from(schema.journalEntries);
  return first?.date ? Number(first.date.slice(0, 4)) : Number(today(new Date()).slice(0, 4));
}

/** Stichjahr setzen (Vorziehen in den Einstellungen; prüft auswertungen/stichjahr.ts), in der Transaktion des Aufrufers */
export async function setJournalAb(tx: Tx, year: number): Promise<void> {
  await tx.update(schema.company).set({ journalAb: year, updatedAt: new Date() }).where(eq(schema.company.id, 1));
}

/**
 * Kleinunternehmer (§ 19 UStG) an einem Tag, nach dem Änderungsprotokoll der Firmendaten. Liefert eine Funktion
 * Datum (JJJJ-MM-TT, deutsche Zeit) → Status am Ende dieses Tages; vor dem ersten Eintrag gilt der erste bekannte
 * fachlich gespeicherte Stand. Unbenutzte technische Vorgaben zählen nicht als Regelbesteuerung. Einschalten geht nur,
 * solange im Jahr nichts gebucht ist (settings-guard.ts), ausschalten jederzeit.
 *
 * Für alles, was frühere Zeiträume betrifft: Wer zum Jahreswechsel auf Kleinunternehmer umstellt, schuldet die
 * Voranmeldung für Dezember und die Umsatzsteuererklärung des Vorjahres trotzdem.
 */
export async function kleinunternehmerHistory(q: Db | Tx = db): Promise<(date: string) => boolean> {
  const stand = await kleinunternehmerStand(q);
  return (date) => kleinunternehmerAm(stand, date);
}

/** Die Änderungen aus dem Protokoll als Daten, etwa für Formulare, die den Stand an einem gewählten Tag brauchen */
export async function kleinunternehmerStand(q: Db | Tx = db): Promise<KleinunternehmerStand> {
  const rows = await q
    .select({
      seq: schema.auditLog.seq,
      at: schema.auditLog.at,
      actor: schema.auditLog.actor,
      action: schema.auditLog.action,
      oldValue: schema.auditLog.oldValue,
      newValue: schema.auditLog.newValue,
    })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.tableName, "company"))
    .orderBy(schema.auditLog.seq);
  // Alte Snapshots ohne Kennzeichnung bleiben konservativ erhalten. Neue Verwaltungsupdates bestätigen
  // keine Besteuerungsart; tatsächliche Statusänderungen (auch Übernahmen) bleiben fachlich wirksam.
  const settings = rows.filter((r) => {
    const after = r.newValue as Record<string, unknown> | null;
    const before = r.oldValue as Record<string, unknown> | null;
    if (typeof after?.kleinunternehmer !== "boolean") return false;
    if (!Object.hasOwn(after, "firmendaten_gespeichert_at")) return true;
    return (
      r.action === "INSERT" ||
      after.kleinunternehmer !== before?.kleinunternehmer ||
      (after.firmendaten_gespeichert_at !== null && after.firmendaten_gespeichert_at !== before?.firmendaten_gespeichert_at)
    );
  });
  const firstSetting = settings.find(
    (r) => !defaultCompanyAudit(r) && typeof (r.newValue as { kleinunternehmer?: unknown } | null)?.kleinunternehmer === "boolean",
  );
  // Wer bereits vor der Firmeneinrichtung gebucht oder übermittelt hat, hat die Vorgaben fachlich verwendet.
  // Nach Kettenposition vergleichen: Mehrere Schritte in einer Transaktion haben denselben Zeitstempel.
  const [used] =
    firstSetting && rows.some(defaultCompanyAudit)
      ? await q
          .select({ seq: schema.auditLog.seq })
          .from(schema.auditLog)
          .where(
            and(
              lt(schema.auditLog.seq, firstSetting.seq),
              sql`(${schema.auditLog.tableName} in ('journal_entries', 'cash_entries')
        or (${schema.auditLog.tableName} = 'invoices' and ${schema.auditLog.newValue}->>'status' = 'final')
        or (${schema.auditLog.tableName} = 'documents' and ${schema.auditLog.newValue}->>'status' = 'gebucht')
        or (${schema.auditLog.tableName} = 'vat_returns' and ${schema.auditLog.newValue}->>'status' = 'sent'))`,
            ),
          )
          .limit(1)
      : [];
  const aenderungen = settings.flatMap((r) => {
    const snapshot = r.newValue as { kleinunternehmer?: unknown; name?: unknown } | null;
    const value = snapshot?.kleinunternehmer;
    // Nur die unbestätigte Erstanlage auslassen, keine bestätigte Einstellung und keinen späteren Wechsel.
    if (!used && defaultCompanyAudit(r)) return [];
    return typeof value === "boolean" ? [{ date: today(r.at), value }] : [];
  });
  return { aenderungen, aktuell: (await loadCompany(q)).kleinunternehmer };
}

function defaultCompanyAudit(row: { actor: string | null; action: string; newValue: unknown }): boolean {
  const snapshot = row.newValue as Record<string, unknown> | null;
  if (row.action !== "INSERT" || snapshot?.kleinunternehmer !== false) return false;
  if (Object.hasOwn(snapshot, "firmendaten_gespeichert_at")) return snapshot.firmendaten_gespeichert_at === null;
  return row.actor === "system:setup" && snapshot.name === "";
}

/** Letzter Tag eines Monats, JJJJ-MM-TT */
export function lastDayOfMonth(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** Kleinunternehmer in einem Voranmeldungszeitraum: Stand am Monatsende */
export async function kleinunternehmerForMonth(year: number, month: number, q: Db | Tx = db): Promise<boolean> {
  return (await kleinunternehmerHistory(q))(lastDayOfMonth(year, month));
}

/** Kleinunternehmer am Ende eines Jahres: dann für das ganze Jahr (einschalten geht nur vor der ersten Buchung) */
export async function kleinunternehmerForYear(year: number): Promise<boolean> {
  return (await kleinunternehmerHistory())(`${year}-12-31`);
}

/** Gemeinsame Daten für den Rechnungs- und den Angebotseditor, mit der letzten vergebenen Nummer je Jahr */
export async function editorContext(kind: "rechnung" | "angebot") {
  const [company, counters, contacts, articles, textBlocks, logo, background, design, mandates, contactPersons] = await Promise.all([
    loadCompany(),
    kind === "rechnung" ? db.select().from(schema.invoiceNumberCounters) : db.select().from(schema.quoteNumberCounters),
    listContacts(),
    listArticles(),
    listTextBlocks(),
    logoInfo(),
    backgroundInfo(),
    loadDesign(),
    kind === "rechnung" ? mandateOptions(today()) : Promise.resolve([]),
    contactPersonOptions(),
  ]);
  const { name, strasse, plz, ort, email, telefon, steuernummer, ustId, iban, bic, bank, kontoinhaber } = company;
  return {
    contacts,
    /** Gültige Lastschriftmandate je Kunde (#445), für die Zahlungsart der Rechnung */
    mandates,
    /** Ansprechpartner aller Kunden (#424), für die Auswahl unter „Kunde“ */
    contactPersons,
    articles: articles.map(({ id, number, description, detail, unit, unitPrice, taxRate, priceIncludesTax }) => ({
      id,
      number,
      description,
      detail,
      unit,
      unitPrice,
      taxRate,
      priceIncludesTax,
    })),
    textBlocks: textBlocks.map(({ id, name, kind, text, contactId }) => ({ id, name, kind, text, contactId })),
    company: {
      name,
      strasse,
      plz,
      ort,
      email,
      telefon,
      steuernummer,
      ustId,
      iban,
      bic,
      bank,
      kontoinhaber,
      logo: logo?.sha256 ?? null,
      background: background?.sha256 ?? null,
      accent: design.accent,
      design,
      legal: legalLine(legalInfo(company)),
    },
    sellerIssues: sellerIssues(company),
    letterIssues: letterIssues(company),
    bundesland: company.bundesland,
    kleinunternehmer: company.kleinunternehmer,
    tageskurs: company.tageskurs,
    /** Skonto-Vorgabe für Kunden ohne eigenes */
    companySkonto: company.skonto,
    /** Vorlagen für den Zahlungsplan im Angebot */
    planTemplates: company.paymentPlanTemplates,
    numberFormat: kind === "rechnung" ? company.invoiceNumberFormat : company.quoteNumberFormat,
    /** Letzte Nummer je Kreis: Jahr, 0 = durchlaufender Zähler */
    numberCounters: Object.fromEntries(counters.map((c) => [c.year, c.last])) as Record<number, number>,
    numberRunning: kind === "rechnung" ? company.invoiceCounterRunning : company.quoteCounterRunning,
  };
}

/** Was fehlt, bevor eine Voranmeldung gesendet werden kann. */
export function companyIssues(company: Company): string[] {
  const issues: string[] = [];
  if (!company.name) issues.push("Name fehlt");
  if (!company.strasse || !company.plz || !company.ort) issues.push("Anschrift unvollständig");
  if (!company.bundesland) issues.push("Bundesland fehlt");
  if (!company.steuernummer) {
    issues.push("Steuernummer fehlt");
  } else if (company.bundesland) {
    try {
      toElsterSteuernummer(company.steuernummer, company.bundesland);
    } catch (error) {
      if (error instanceof SteuernummerError) issues.push(error.message);
      else throw error;
    }
  }
  return issues;
}

/** Was auf einer Rechnung als Absender fehlt (§ 14 UStG und Zahlungsangaben). */
export function sellerIssues(company: Company): string[] {
  const issues: string[] = [];
  if (!company.name) issues.push("Firmenname fehlt");
  if (!company.strasse || !company.plz || !company.ort) issues.push("Anschrift unvollständig");
  if (!company.steuernummer && !company.ustId) issues.push("Steuernummer oder USt-IdNr. fehlt");
  if (!company.email) issues.push("E-Mail-Adresse fehlt");
  if (!company.iban) issues.push("IBAN fehlt");
  return issues;
}

/**
 * Was einer GmbH oder UG an Pflichtangaben für Geschäftsbriefe fehlt (§ 35a Abs. 1 GmbHG). Nur ein Hinweis, keine
 * Sperre beim Festschreiben: Die Rechnung bleibt umsatzsteuerlich gültig (§ 14 Abs. 4 UStG verlangt die Angaben nicht),
 * das Registergericht kann fehlende Angaben mit Zwangsgeld durchsetzen (§ 79 Abs. 1 GmbHG), und eine Vor-GmbH hat vor
 * der Eintragung noch keine Registernummer, rechnet aber schon ab.
 */
export function letterIssues(company: Company): string[] {
  return legalInfoGaps(company);
}
