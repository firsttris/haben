import {
  dauerfristActive,
  filingPeriodsOfYear,
  frequencyAt,
  sondervorauszahlung,
  toElsterSteuernummer,
  type Cents,
  type DauerfristSetting,
  type VatFrequency,
  type VatFrequencySetting,
  type VatPeriod,
} from "@haben/core";
import { buildDauerfristXml, type ElsterClient, type ElsterResult } from "@haben/elster";
import { and, desc, eq, min } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { PRODUKT_VERSION, uebermitteln, type ElsterVorgang } from "../elster/index.ts";
import { companyIssues, loadCompany } from "../stammdaten/index.ts";
import { VatError } from "./vat.ts";
import { loadFrequencies } from "./zeitraum.ts";

/*
 * Dauerfristverlängerung (§ 46–48 UStDV): Antrag bzw. Anmeldung der Sondervorauszahlung über ELSTER (USt 1 H), der Stand
 * je Jahr und die Sondervorauszahlung, die in der letzten Voranmeldung des Jahres abgezogen wird (Kz 39).
 */

export async function loadDauerfrist(q: Db | Tx = db): Promise<DauerfristSetting[]> {
  return q
    .select({ year: schema.vatExtensions.year, active: schema.vatExtensions.active, sondervorauszahlung: schema.vatExtensions.sondervorauszahlung })
    .from(schema.vatExtensions)
    .orderBy(schema.vatExtensions.year);
}

/** Besteht die Dauerfristverlängerung im Jahr des Zeitraums? Dann ist die Voranmeldung einen Monat später fällig */
export async function dauerfristFor(year: number, q: Db | Tx = db): Promise<boolean> {
  return dauerfristActive(await loadDauerfrist(q), year);
}

export interface DauerfristInput {
  year: number;
  active: boolean;
  /** Außerhalb von Haben angemeldete Sondervorauszahlung in Cent (volle Euro); null ohne */
  sondervorauszahlung: Cents | null;
}

/** Stand von Hand: beantragt außerhalb von Haben, oder beendet (zurückgenommen oder vom Finanzamt widerrufen) */
export async function saveDauerfrist(actor: string, input: DauerfristInput): Promise<void> {
  if (input.sondervorauszahlung !== null && (input.sondervorauszahlung < 0 || input.sondervorauszahlung % 100 !== 0)) {
    throw new VatError("Die Sondervorauszahlung ist ein Betrag in vollen Euro, nicht negativ.");
  }
  const values = { active: input.active, sondervorauszahlung: input.active ? input.sondervorauszahlung : null, updatedAt: new Date() };
  await withActor(actor, (tx) =>
    tx
      .insert(schema.vatExtensions)
      .values({ year: input.year, ...values })
      .onConflictDoUpdate({ target: schema.vatExtensions.year, set: values }),
  );
}

/** Letzter Voranmeldungszeitraum des Jahres: in ihm wird die Sondervorauszahlung abgezogen (§ 48 Abs. 4 UStDV) */
export function isLastPeriodOfYear(settings: readonly VatFrequencySetting[], period: VatPeriod): boolean {
  const last = filingPeriodsOfYear(settings, period.year).at(-1);
  return last?.month === period.month;
}

/** Kz 39 für einen Zeitraum: die für das Jahr angemeldete Sondervorauszahlung, nur im letzten Zeitraum des Jahres */
export async function kz39For(period: VatPeriod, q: Db | Tx = db): Promise<Cents> {
  const [frequencies, settings] = await Promise.all([loadFrequencies(q), loadDauerfrist(q)]);
  if (!isLastPeriodOfYear(frequencies, period)) return 0;
  const own = settings.find((s) => s.year === period.year);
  return own?.active ? (own.sondervorauszahlung ?? 0) : 0;
}

/** Summe der Vorauszahlungen eines Jahres: je Zeitraum die zuletzt gesendete Voranmeldung, mit dem Abzug in Kz 39 */
async function vorauszahlungen(year: number): Promise<{ kz83: Cents; kz39: Cents; periods: number }> {
  const sent = await db
    .select({ month: schema.vatReturns.month, kz83: schema.vatReturns.kz83, kz39: schema.vatReturns.kz39 })
    .from(schema.vatReturns)
    .where(and(eq(schema.vatReturns.year, year), eq(schema.vatReturns.status, "sent")))
    .orderBy(desc(schema.vatReturns.sentAt));
  const latest = new Map<number, { kz83: Cents; kz39: Cents }>();
  for (const row of sent) if (!latest.has(row.month)) latest.set(row.month, row);
  const values = [...latest.values()];
  return { kz83: values.reduce((s, v) => s + v.kz83, 0), kz39: values.reduce((s, v) => s + v.kz39, 0), periods: latest.size };
}

export interface SondervorauszahlungVorschlag {
  betrag: Cents;
  vorauszahlungen: Cents;
  angerechnet: Cents;
  months: number;
  /** Gesendete Voranmeldungen des Vorjahres; fehlen welche, ist die Summe unvollständig */
  periods: number;
}

/** Vorschlag nach § 47 UStDV aus den gesendeten Voranmeldungen des Vorjahres; null ohne Tätigkeit im Vorjahr */
export async function sondervorauszahlungVorschlag(year: number): Promise<SondervorauszahlungVorschlag | null> {
  const [first] = await db.select({ date: min(schema.journalEntries.date) }).from(schema.journalEntries);
  const start = first?.date ?? null;
  if (!start || Number(start.slice(0, 4)) >= year) return null;
  // Angefangene Monate zählen voll (§ 47 Abs. 2 Satz 2 UStDV)
  const months = Number(start.slice(0, 4)) === year - 1 ? 13 - Number(start.slice(5, 7)) : 12;
  const { kz83, kz39, periods } = await vorauszahlungen(year - 1);
  return { betrag: sondervorauszahlung({ vorauszahlungen: kz83, angerechnet: kz39, months }), vorauszahlungen: kz83, angerechnet: kz39, months, periods };
}

export async function dauerfristSubmissions(year: number) {
  return db
    .select({
      id: schema.vatExtensionSubmissions.id,
      kind: schema.vatExtensionSubmissions.kind,
      kz38: schema.vatExtensionSubmissions.kz38,
      berichtigt: schema.vatExtensionSubmissions.berichtigt,
      ok: schema.vatExtensionSubmissions.ok,
      code: schema.vatExtensionSubmissions.code,
      message: schema.vatExtensionSubmissions.message,
      transferTicket: schema.vatExtensionSubmissions.transferTicket,
      hasPdf: schema.vatExtensionSubmissions.protocolPdf,
      createdAt: schema.vatExtensionSubmissions.createdAt,
    })
    .from(schema.vatExtensionSubmissions)
    .where(eq(schema.vatExtensionSubmissions.year, year))
    .orderBy(desc(schema.vatExtensionSubmissions.createdAt))
    .then((rows) => rows.map(({ hasPdf, ...row }) => ({ ...row, hasPdf: hasPdf !== null })));
}

export interface DauerfristOverview {
  year: number;
  /** Zeitraum im Januar: monatlich mit Sondervorauszahlung, vierteljährlich ohne, befreit gar nicht */
  frequency: VatFrequency;
  active: boolean;
  /** Eigener Eintrag für das Jahr (Antrag gesendet oder von Hand) */
  own: DauerfristSetting | null;
  /** Echt übermittelt in Haben */
  sent: boolean;
  vorschlag: SondervorauszahlungVorschlag | null;
  submissions: Awaited<ReturnType<typeof dauerfristSubmissions>>;
}

export async function dauerfristOverview(year: number, frequencies?: VatFrequencySetting[]): Promise<DauerfristOverview> {
  const [settings, submissions, vorschlag] = await Promise.all([loadDauerfrist(), dauerfristSubmissions(year), sondervorauszahlungVorschlag(year)]);
  return {
    year,
    frequency: frequencyAt(frequencies ?? (await loadFrequencies()), { year, month: 1 }),
    active: dauerfristActive(settings, year),
    own: settings.find((s) => s.year === year) ?? null,
    sent: submissions.some((s) => s.kind === "send" && s.ok),
    vorschlag,
    submissions,
  };
}

export interface DauerfristSubmitOptions {
  kind: ElsterVorgang;
  year: number;
  /** Bei monatlicher Abgabe Pflicht (volle Euro), bei vierteljährlicher leer */
  sondervorauszahlung: Cents | null;
  berichtigt: boolean;
  pin?: string;
  herstellerId?: string;
}

/** Prüft die Angaben gegen den Voranmeldungszeitraum des Jahres; die Meldung ist für den Nutzer */
function antragProblem(frequency: VatFrequency, options: DauerfristSubmitOptions, sentBefore: boolean): string | null {
  if (frequency === "keine") return `Für ${options.year} ist keine Voranmeldung eingestellt; eine Dauerfristverlängerung braucht es dann nicht.`;
  if (frequency === "monatlich" && options.sondervorauszahlung === null) {
    return "Bei monatlicher Abgabe gehört zum Antrag die Sondervorauszahlung (§ 47 UStDV), notfalls 0 €.";
  }
  if (frequency === "vierteljaehrlich" && options.sondervorauszahlung !== null) {
    return "Bei vierteljährlicher Abgabe gibt es keine Sondervorauszahlung; der Antrag geht ohne Betrag.";
  }
  if (options.sondervorauszahlung !== null && (options.sondervorauszahlung < 0 || options.sondervorauszahlung % 100 !== 0)) {
    return "Die Sondervorauszahlung ist ein Betrag in vollen Euro, nicht negativ.";
  }
  if (options.berichtigt && !sentBefore) return "Berichtigen lässt sich nur eine schon gesendete Anmeldung der Sondervorauszahlung.";
  if (!options.berichtigt && sentBefore && options.kind === "send") {
    return `Für ${options.year} ist schon übermittelt. Eine geänderte Sondervorauszahlung sendest du als berichtigte Anmeldung.`;
  }
  return null;
}

/**
 * Prüft oder übermittelt den Antrag auf Dauerfristverlängerung bzw. die Anmeldung der Sondervorauszahlung. Jeder Versuch
 * landet in vat_extension_submissions; eine erfolgreiche Echtübermittlung trägt die Verlängerung für das Jahr ein.
 */
export function submitDauerfrist(actor: string, client: ElsterClient, options: DauerfristSubmitOptions): Promise<ElsterResult> {
  return uebermitteln(client, {
    sperre: `haben.dauerfrist.${options.year}`,
    vorgang: options.kind,
    herstellerId: options.herstellerId,
    pin: options.pin,
    vorbereiten: async ({ test, herstellerId }) => {
      const [frequencies, submissions] = await Promise.all([loadFrequencies(), dauerfristSubmissions(options.year)]);
      const problem = antragProblem(
        frequencyAt(frequencies, { year: options.year, month: 1 }),
        options,
        submissions.some((s) => s.kind === "send" && s.ok),
      );
      if (problem) throw new VatError(problem);
      const company = await loadCompany();
      const issues = companyIssues(company);
      if (issues.length > 0) throw new VatError(`Firmendaten unvollständig: ${issues.join(", ")}.`);
      const xml = buildDauerfristXml({
        year: options.year,
        steuernummer13: toElsterSteuernummer(company.steuernummer, company.bundesland!),
        sondervorauszahlung: options.sondervorauszahlung,
        berichtigt: options.berichtigt,
        datenlieferant: { name: company.name, strasse: company.strasse, plz: company.plz, ort: company.ort },
        herstellerId,
        produktVersion: PRODUKT_VERSION,
        test,
      });
      return { xml, daten: null };
    },
    protokollieren: (result, xml) =>
      withActor(actor, async (tx) => {
        await tx.insert(schema.vatExtensionSubmissions).values({
          year: options.year,
          kz38: options.sondervorauszahlung,
          berichtigt: options.berichtigt,
          kind: options.kind,
          ok: result.ok,
          code: result.code,
          message: result.message,
          transferTicket: result.transferTicket ?? null,
          requestXml: xml,
          responseXml: result.responseXml,
          serverResponseXml: result.serverResponseXml,
          protocolPdf: result.pdf ? Buffer.from(result.pdf) : null,
        });
        if (result.ok && options.kind === "send") {
          const values = { active: true, sondervorauszahlung: options.sondervorauszahlung, updatedAt: new Date() };
          await tx
            .insert(schema.vatExtensions)
            .values({ year: options.year, ...values })
            .onConflictDoUpdate({ target: schema.vatExtensions.year, set: values });
        }
      }),
  });
}

export async function loadDauerfristProtocol(id: string) {
  const [row] = await db
    .select({ pdf: schema.vatExtensionSubmissions.protocolPdf, year: schema.vatExtensionSubmissions.year, kz38: schema.vatExtensionSubmissions.kz38 })
    .from(schema.vatExtensionSubmissions)
    .where(eq(schema.vatExtensionSubmissions.id, id));
  if (!row?.pdf) return null;
  return { pdf: row.pdf, filename: `${row.kz38 === null ? "Dauerfristverlaengerung" : "Sondervorauszahlung"}-${row.year}-Protokoll.pdf` };
}
