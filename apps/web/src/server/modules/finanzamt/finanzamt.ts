import { UserError } from "../../errors.ts";
import { toElsterSteuernummer, type Cents, type Prognose } from "@haben/core";
import {
  buildBankverbindungXml,
  buildNachrichtXml,
  isValidIban,
  NACHRICHT_BETREFF_MAX,
  NACHRICHT_TEXT_MAX,
  splitStrasse,
  type ElsterClient,
  type ElsterResult,
} from "@haben/elster";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { companyIssues, loadCompany } from "../stammdaten/index.ts";
import { latestEstAngaben, prognose } from "../jahreserklaerung/index.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { euerForYear } from "../auswertungen/index.ts";
import { PRODUKT_VERSION, SENDEN, uebermitteln } from "../elster/index.ts";
import { createHash } from "node:crypto";

export class FinanzamtError extends UserError {}

export const messageSchema = z.object({
  topic: z.enum(["nachricht", "vorauszahlung"]),
  betreff: z.string().trim().min(1, "Betreff fehlt").max(NACHRICHT_BETREFF_MAX, `Der Betreff hat höchstens ${NACHRICHT_BETREFF_MAX} Zeichen`),
  text: z.string().trim().min(1, "Text fehlt").max(NACHRICHT_TEXT_MAX, `Der Text hat höchstens ${NACHRICHT_TEXT_MAX} Zeichen`),
  /** Zahlen aus der Oberfläche, die mit der Nachricht festgehalten werden; klein halten, sie landen im Audit-Log */
  figures: z
    .record(z.string().max(40), z.unknown())
    .refine((figures) => JSON.stringify(figures).length <= 20_000, "Zu viele Angaben zur Nachricht")
    .nullable()
    .default(null),
});

export type MessageInput = z.input<typeof messageSchema>;

const dayOfYear = (date: string) =>
  Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${date.slice(0, 4)}-01-01T00:00:00Z`)) / 86_400_000) + 1;

export interface PrepaymentBasis {
  year: number;
  /** Stichtag der Zahlen (heute) */
  until: string;
  /** Gewinn laut EÜR vom 1. Januar bis heute */
  profitSoFar: Cents;
  /** Auf das Jahr hochgerechnet (taggenau) */
  profitForecast: Cents;
  /** Gewinn des Vorjahres laut EÜR */
  profitLastYear: Cents;
  einkunftsart: "gewerbe" | "selbstaendig" | null;
  /** Geschätzte Steuer des Jahres aus der Hochrechnung und den Angaben zur Einkommensteuer */
  prognose: Prognose;
  /** Jahr der Angaben, auf denen die Prognose beruht; null = keine gespeichert */
  angabenAus: number | null;
}

/** Zahlen für den Antrag auf Herabsetzung der Einkommensteuer-Vorauszahlungen */
export async function prepaymentBasis(today: string): Promise<PrepaymentBasis> {
  const year = Number(today.slice(0, 4));
  const [current, last, company, latest] = await Promise.all([euerForYear(year), euerForYear(year - 1), loadCompany(), latestEstAngaben(year)]);
  const days = dayOfYear(today);
  const daysInYear = dayOfYear(`${year}-12-31`);
  const profitForecast = Math.round((current.gewinn * daysInYear) / days / 100) * 100;
  return {
    year,
    until: today,
    profitSoFar: current.gewinn,
    profitForecast,
    profitLastYear: last.gewinn,
    einkunftsart: company.einkunftsart,
    prognose: await prognose(year, profitForecast, latest.angaben),
    angabenAus: latest.fromYear,
  };
}

export async function listMessages(limit = 50) {
  return db
    .select({
      id: schema.elsterMessages.id,
      topic: schema.elsterMessages.topic,
      betreff: schema.elsterMessages.betreff,
      text: schema.elsterMessages.text,
      kind: schema.elsterMessages.kind,
      ok: schema.elsterMessages.ok,
      code: schema.elsterMessages.code,
      message: schema.elsterMessages.message,
      transferTicket: schema.elsterMessages.transferTicket,
      createdAt: schema.elsterMessages.createdAt,
    })
    .from(schema.elsterMessages)
    .orderBy(desc(schema.elsterMessages.createdAt))
    .limit(limit);
}

/** Was fehlt, bevor eine Nachricht rausgehen kann */
export function messageIssues(company: Awaited<ReturnType<typeof loadCompany>>): string[] {
  const issues = companyIssues(company);
  if (company.strasse && !splitStrasse(company.strasse)) issues.push("In der Anschrift fehlt die Hausnummer");
  return issues;
}

export interface SendMessageOptions {
  kind: "validate" | "test" | "send";
  pin?: string;
  herstellerId?: string;
}

/** Prüft oder sendet eine Nachricht an das Finanzamt der Steuernummer; jeder Versuch wird gespeichert. */
export async function sendMessage(actor: string, rawInput: MessageInput, client: ElsterClient, options: SendMessageOptions): Promise<ElsterResult> {
  const input = messageSchema.parse(rawInput);
  const company = await loadCompany();
  const issues = messageIssues(company);
  if (issues.length > 0) throw new FinanzamtError(`Firmendaten unvollständig: ${issues.join(", ")}.`);

  return submit(actor, { topic: input.topic, betreff: input.betreff, text: input.text, figures: input.figures }, client, options, (herstellerId, test) =>
    buildNachrichtXml({
      steuernummer13: toElsterSteuernummer(company.steuernummer, company.bundesland!),
      bundesland: company.bundesland!,
      absender: { name: company.name, strasse: company.strasse, plz: company.plz, ort: company.ort },
      ...(company.taxpayer.a ? { person: company.taxpayer.a } : {}),
      betreff: input.betreff,
      text: input.text,
      herstellerId,
      produktVersion: PRODUKT_VERSION,
      test,
    }),
  );
}

export const bankChangeSchema = z.object({
  iban: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, "").toUpperCase())
    .refine(isValidIban, "Die IBAN ist ungültig"),
});

/** Was fehlt, bevor die Bankverbindung geändert werden kann */
export function bankChangeIssues(company: Awaited<ReturnType<typeof loadCompany>>): string[] {
  const issues = companyIssues(company).filter((issue) => issue !== "Anschrift unvollständig");
  if (!company.taxpayer.a) issues.push("Persönliche Angaben (Identifikationsnummer, Name, Geburtsdatum) fehlen");
  return issues;
}

/** Teilt dem Finanzamt eine neue Bankverbindung für alle Steuerarten mit. */
export async function sendBankChange(
  actor: string,
  rawInput: z.input<typeof bankChangeSchema>,
  client: ElsterClient,
  options: SendMessageOptions,
): Promise<ElsterResult> {
  const { iban } = bankChangeSchema.parse(rawInput);
  const company = await loadCompany();
  const issues = bankChangeIssues(company);
  if (issues.length > 0) throw new FinanzamtError(`Angaben unvollständig: ${issues.join(", ")}.`);
  const person = company.taxpayer.a!;

  const text = `Neue Bankverbindung für alle Steuerarten: ${iban.replace(/(.{4})/g, "$1 ").trim()}`;
  return submit(actor, { topic: "bankverbindung", betreff: "Änderung der Bankverbindung", text, figures: { iban } }, client, options, (herstellerId, test) =>
    buildBankverbindungXml({
      steuernummer13: toElsterSteuernummer(company.steuernummer, company.bundesland!),
      bundesland: company.bundesland!,
      person,
      iban,
      herstellerId,
      produktVersion: PRODUKT_VERSION,
      test,
    }),
  );
}

type MessageRecord = Pick<typeof schema.elsterMessages.$inferInsert, "topic" | "betreff" | "text" | "figures">;

/**
 * Prüfen, Test- oder Echtversand über das ELSTER-Gateway; jeder Versuch landet unveränderlich in elster_messages.
 * Gleiche Nachrichten laufen unter derselben Sendesperre, nacheinander statt gleichzeitig. Ob eine zweite gleiche Nachricht
 * gewollt ist, prüft Haben nicht; die Oberfläche sperrt den Knopf, solange gesendet wird.
 */
function submit(
  actor: string,
  record: MessageRecord,
  client: ElsterClient,
  options: SendMessageOptions,
  buildXml: (herstellerId: string, test: boolean) => string,
): Promise<ElsterResult> {
  const key = createHash("sha256").update(JSON.stringify([record.topic, record.betreff, record.text, record.figures ?? null])).digest("hex");
  return uebermitteln(client, {
    sperre: `haben.nachricht.${key}`,
    vorgang: options.kind,
    herstellerId: options.herstellerId,
    pin: options.pin,
    bezeichnung: SENDEN,
    print: false,
    vorbereiten: async ({ herstellerId, test }) => ({ xml: buildXml(herstellerId, test), daten: null }),
    protokollieren: (result, xml) =>
      withActor(actor, (tx) =>
        tx.insert(schema.elsterMessages).values({
          ...record,
          kind: options.kind,
          ok: result.ok,
          code: result.code,
          message: result.message,
          transferTicket: result.transferTicket ?? null,
          requestXml: xml,
          responseXml: result.responseXml,
          serverResponseXml: result.serverResponseXml,
        }),
      ),
  });
}
