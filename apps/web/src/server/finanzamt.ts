import { toElsterSteuernummer, type Cents, type Prognose } from "@haben/core";
import {
  buildBankverbindungXml,
  buildNachrichtXml,
  isValidIban,
  NACHRICHT_BETREFF_MAX,
  NACHRICHT_TEXT_MAX,
  splitStrasse,
  TEST_HERSTELLER_ID,
  type ElsterClient,
  type ElsterResult,
} from "@haben/elster";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { companyIssues, loadCompany } from "./company.ts";
import { decrypt } from "./crypto.ts";
import { latestEstAngaben, prognose } from "./income-tax.ts";
import { withActor } from "./db/actor.ts";
import { db, schema } from "./db/index.ts";
import { euerForYear } from "./reports.ts";
import { loadActiveCertificate, PRODUKT_VERSION } from "./vat.ts";

export class FinanzamtError extends Error {}

export const messageSchema = z.object({
  topic: z.enum(["nachricht", "vorauszahlung"]),
  betreff: z.string().trim().min(1, "Betreff fehlt").max(NACHRICHT_BETREFF_MAX, `Der Betreff hat höchstens ${NACHRICHT_BETREFF_MAX} Zeichen`),
  text: z.string().trim().min(1, "Text fehlt").max(NACHRICHT_TEXT_MAX, `Der Text hat höchstens ${NACHRICHT_TEXT_MAX} Zeichen`),
  figures: z.record(z.string(), z.unknown()).nullable().default(null),
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

/** Prüfen, Test- oder Echtversand; jeder Versuch landet unveränderlich in elster_messages. */
async function submit(
  actor: string,
  record: MessageRecord,
  client: ElsterClient,
  options: SendMessageOptions,
  buildXml: (herstellerId: string, test: boolean) => string,
): Promise<ElsterResult> {
  const test = options.kind !== "send";
  const herstellerId = test ? TEST_HERSTELLER_ID : options.herstellerId;
  if (!herstellerId) throw new FinanzamtError("Für das echte Senden fehlt die Hersteller-ID (ELSTER_HERSTELLER_ID).");
  if (!test && "isFake" in client && client.isFake) {
    throw new FinanzamtError("Ohne ERiC ist kein echtes Senden möglich; Prüfen und Testübermittlung laufen nur simuliert.");
  }

  const xml = buildXml(herstellerId, test);

  let result: ElsterResult;
  if (options.kind === "validate") {
    result = await client.validate(xml);
  } else {
    if (!options.pin) throw new FinanzamtError("Die Zertifikats-PIN fehlt.");
    const certificate = await loadActiveCertificate();
    if (!certificate) throw new FinanzamtError("Es ist kein ELSTER-Zertifikat hinterlegt.");
    result = await client.send(xml, decrypt(certificate.ciphertext), options.pin, { test, print: false });
  }

  await withActor(actor, (tx) =>
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
  );
  return result;
}
