import {
  ausEinlagekonto,
  ausschuettungAnteil,
  ausschuettungPosting,
  ebilanzPosition,
  isKapitalgesellschaft,
  toElsterSteuernummer,
  VORTRAG_ACCOUNTS,
  type Cents,
} from "@haben/core";
import { buildKapEStAXml, KAPESTA_JAHRE, tagDanach, zuflussTag, type ElsterClient, type ElsterResult } from "@haben/elster";
import { and, asc, desc, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import type { AusschuettungEmpfaenger } from "../../db/schema.ts";
import { UserError } from "../../errors.ts";
import { ledgerRange, openBooks, post, saldenliste } from "../buchhaltung/index.ts";
import { PRODUKT_VERSION, uebermitteln } from "../elster/index.ts";
import { kapgErklaerungAngaben } from "../jahreserklaerung/index.ts";
import { companyIssues, loadCompany, type Company } from "../stammdaten/index.ts";

/*
 * Gewinnausschüttungen einer GmbH oder UG: Gewinnverwendungsbeschluss buchen, Steuerabzug je Gesellschafter
 * (ausschuettung.ts in @haben/core), Kapitalertragsteuer-Anmeldung prüfen und senden. Die Gesellschafter mit Anteil
 * und Kirchensteuerabzugsmerkmal kommen aus den Angaben zur Körperschaftsteuererklärung des Jahres.
 */

export class AusschuettungError extends UserError {}

const isoDate = z.iso.date("Datum im Format JJJJ-MM-TT");

export const ausschuettungSchema = z.object({
  beschluss: isoDate,
  /** Im Beschluss bestimmter Tag der Auszahlung; leer: Zufluss am Tag nach dem Beschluss */
  auszahlungstag: isoDate.nullable().default(null),
  brutto: z.number().int().min(1, "Betrag der Ausschüttung fehlt").max(100_000_000_000_00),
});

export type AusschuettungInput = z.input<typeof ausschuettungSchema>;

const EIGENKAPITAL = "bs.eqLiab.equity.";
const GEZEICHNET = "bs.eqLiab.equity.subscribed.";

/** Die Bruttoausschüttung nach Anteilen; Rundungsreste gehen an die größten Anteile, damit die Summe stimmt */
export function nachAnteilen(betrag: Cents, anteile: readonly number[]): Cents[] {
  const roh = anteile.map((a) => (betrag * a) / 10_000);
  const result = roh.map(Math.floor);
  let rest = betrag - result.reduce((s, x) => s + x, 0);
  const order = roh.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    result[i]! += 1;
    rest -= 1;
  }
  return result;
}

/** Summe der nicht stornierten Ausschüttungen mit Beschluss nach dem Tag */
async function spaetereAusschuettungen(beschluss: string, q: Db | Tx): Promise<Cents> {
  const rows = await q
    .select({ brutto: schema.dividends.brutto, entryId: schema.dividends.entryId })
    .from(schema.dividends)
    .where(gt(schema.dividends.beschlussDate, beschluss));
  const reversed = await reversedEntries(
    rows.map((r) => r.entryId),
    q,
  );
  return rows.filter((r) => !reversed.has(r.entryId)).reduce((sum, r) => sum + r.brutto, 0);
}

interface Grundlagen {
  company: Company;
  /** Gewinnvortrag zum Beschluss (Haben positiv): aus ihm wird ausgeschüttet */
  gewinnvortrag: Cents;
  /** § 27 Abs. 1 Satz 5 KStG, abzüglich der Leistungen des Jahres vor diesem Beschluss */
  ausschuettbarerGewinn: Cents;
  einlagekonto: Cents;
}

type Salden = Awaited<ReturnType<typeof saldenliste>>;

/** Eigenkapital laut Steuerbilanz und Nennkapital zum Schluss des Vorjahres: die EB-Werte der Konten (Haben positiv) */
function kapitalVorjahr(company: Company, rows: Salden) {
  const pos = (account: string) => ebilanzPosition(company.kontenrahmen, account, -1) ?? "";
  const eb = (prefix: string) => -rows.filter((r) => pos(r.account).startsWith(prefix)).reduce((sum, r) => sum + r.vortrag, 0);
  return { eigenkapital: eb(EIGENKAPITAL), nennkapital: eb(GEZEICHNET) };
}

async function salden(company: Company, year: number, to?: string): Promise<Salden> {
  return (await saldenliste({ ...ledgerRange(year), ...(to ? { to } : {}) })).filter((r) => r.kontenrahmen === company.kontenrahmen);
}

async function grundlagen(year: number, beschluss: string, q: Db | Tx): Promise<Grundlagen> {
  const company = await loadCompany(q);
  if (!isKapitalgesellschaft(company.rechtsform)) throw new AusschuettungError("Ausschüttungen gibt es nur in GmbH und UG.");
  // Stand am Ende des Beschlusstags (to ist ausschließlich)
  const rows = await salden(company, year, tagDanach(beschluss));
  const { eigenkapital, nennkapital } = kapitalVorjahr(company, rows);
  const { angaben } = await kapgErklaerungAngaben(year);
  const vortrag = VORTRAG_ACCOUNTS[company.kontenrahmen];
  const amBeschluss = -rows.filter((r) => r.account === vortrag.gewinn || r.account === vortrag.verlust).reduce((sum, r) => sum + r.saldo, 0);
  // Später beschlossene, schon gebuchte Ausschüttungen mindern den Gewinnvortrag erst nach diesem Tag, verbrauchen ihn aber schon
  const gewinnvortrag = amBeschluss - (await spaetereAusschuettungen(beschluss, q));
  const leistungenBisher = (await dividendsOfYear(year, q)).filter((d) => !d.storniert).reduce((sum, d) => sum + d.brutto, 0);
  return {
    company,
    gewinnvortrag,
    ausschuettbarerGewinn: eigenkapital - nennkapital - angaben.einlagekonto - leistungenBisher,
    einlagekonto: angaben.einlagekonto,
  };
}

/**
 * Für die Anlage KSt 1 F: die nicht stornierten Ausschüttungen mit Abfluss im Jahr und der Teil aus dem Einlagekonto, der
 * in den Steuerbescheinigungen steht, dazu Eigen- und Nennkapital zum Schluss des Vorjahres.
 */
export async function einlagekontoJahr(company: Company, year: number) {
  const [rows, dividends] = await Promise.all([salden(company, year), dividendsOfYear(year)]);
  return {
    ...kapitalVorjahr(company, rows),
    leistungen: dividends
      .filter((d) => !d.storniert)
      .map((d) => ({
        beschluss: d.beschlussDate,
        abfluss: d.zufluss,
        brutto: d.brutto,
        ausEinlagekonto: d.empfaenger.reduce((sum, e) => sum + e.ausEinlagekonto, 0),
      })),
  };
}

/** Steuerabzug je Gesellschafter für einen Beschluss, ohne zu buchen */
export async function ausschuettungVorschlag(input: AusschuettungInput, q: Db | Tx = db) {
  const data = ausschuettungSchema.parse(input);
  const zufluss = zuflussTag({ datum: data.beschluss, betrag: data.brutto, ...(data.auszahlungstag ? { auszahlungstag: data.auszahlungstag } : {}) });
  const year = Number(data.beschluss.slice(0, 4));
  const g = await grundlagen(year, data.beschluss, q);
  const { angaben } = await kapgErklaerungAngaben(year);
  const anteilseigner = angaben.anteilseigner;
  const aus = ausEinlagekonto(data.brutto, g.ausschuettbarerGewinn, g.einlagekonto);
  const brutto = nachAnteilen(
    data.brutto,
    anteilseigner.map((a) => a.anteil),
  );
  const einlage = nachAnteilen(
    aus,
    anteilseigner.map((a) => a.anteil),
  );
  const empfaenger: AusschuettungEmpfaenger[] = anteilseigner.map((a, i) => {
    const r = ausschuettungAnteil({ brutto: brutto[i]!, ausEinlagekonto: einlage[i]!, kirchensteuer: a.kirchensteuer });
    return {
      name: a.name,
      anteil: a.anteil,
      brutto: r.brutto,
      ausEinlagekonto: r.ausEinlagekonto,
      ertrag: r.ertrag,
      kapest: r.kapest,
      soli: r.soli,
      kist: r.kist,
      netto: r.netto,
      kirchensteuer: a.kirchensteuer,
      religionsschluessel: a.religionsschluessel ?? null,
    };
  });
  const issues: string[] = [];
  if (anteilseigner.length === 0) issues.push(`Für ${year} sind keine Anteilseigner eingetragen (Jahreserklärung › Angaben zu den Erklärungen).`);
  if (data.brutto > g.gewinnvortrag) {
    issues.push(
      `Der Gewinnvortrag zum Beschluss beträgt ${(g.gewinnvortrag / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}; mehr lässt sich nicht ausschütten.`,
    );
  }
  if (data.auszahlungstag && data.auszahlungstag < data.beschluss) issues.push("Der Auszahlungstag liegt vor dem Beschluss.");
  return { ...data, zufluss, company: g.company, ausschuettbarerGewinn: g.ausschuettbarerGewinn, ausEinlagekonto: aus, empfaenger, issues };
}

/** Bucht den Gewinnverwendungsbeschluss und hält den Steuerabzug je Gesellschafter fest */
export async function createAusschuettung(actor: string, input: AusschuettungInput, today: string): Promise<string> {
  return withActor(actor, async (tx) => {
    // Nacheinander: sonst sehen zwei gleichzeitige Beschlüsse denselben Gewinnvortrag
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('haben.ausschuettung'))`);
    const v = await ausschuettungVorschlag(input, tx);
    if (v.beschluss > today) throw new AusschuettungError("Der Beschluss liegt in der Zukunft.");
    if (v.issues.length > 0) throw new AusschuettungError(v.issues.join(" "));
    const books = await openBooks(tx);
    const sourceId = crypto.randomUUID();
    const datum = v.beschluss.split("-").reverse().join(".");
    const entryId = await post(tx, books, {
      date: v.beschluss,
      description: `Gewinnausschüttung lt. Beschluss vom ${datum}`,
      sourceType: "ausschuettung",
      sourceId,
      lines: ausschuettungPosting(books.kontenrahmen, v.empfaenger).map((l) => ({ ...l, taxCode: null })),
    });
    await tx.insert(schema.dividends).values({
      id: sourceId,
      beschlussDate: v.beschluss,
      auszahlungstag: v.auszahlungstag,
      zufluss: v.zufluss,
      brutto: v.brutto,
      empfaenger: v.empfaenger,
      entryId,
    });
    return sourceId;
  });
}

async function sentIds(ids: string[], q: Db | Tx): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await q
    .select({ id: schema.kapestSubmissions.dividendId })
    .from(schema.kapestSubmissions)
    .where(and(inArray(schema.kapestSubmissions.dividendId, ids), eq(schema.kapestSubmissions.kind, "send"), eq(schema.kapestSubmissions.ok, true)));
  return new Set(rows.map((r) => r.id));
}

async function reversedEntries(entryIds: string[], q: Db | Tx): Promise<Set<string>> {
  if (entryIds.length === 0) return new Set();
  const rows = await q
    .select({ reverses: schema.journalEntries.reversesId })
    .from(schema.journalEntries)
    .where(inArray(schema.journalEntries.reversesId, entryIds));
  return new Set(rows.map((r) => r.reverses!));
}

/** Ausschüttungen mit Zufluss im Jahr, mit Stand von Storno und Anmeldung */
export async function dividendsOfYear(year: number, q: Db | Tx = db) {
  const rows = await q
    .select()
    .from(schema.dividends)
    .where(and(gte(schema.dividends.zufluss, `${year}-01-01`), lte(schema.dividends.zufluss, `${year}-12-31`)))
    .orderBy(asc(schema.dividends.beschlussDate));
  const own = rows;
  const [reversed, sent] = await Promise.all([
    reversedEntries(
      own.map((r) => r.entryId),
      q,
    ),
    sentIds(
      own.map((r) => r.id),
      q,
    ),
  ]);
  return own.map((r) => ({ ...r, storniert: reversed.has(r.entryId), angemeldet: sent.has(r.id) }));
}

/** Storno per Gegenbuchung; nicht mehr, wenn die Kapitalertragsteuer schon angemeldet ist */
export async function reverseAusschuettung(actor: string, id: string): Promise<void> {
  await withActor(actor, async (tx) => {
    const [d] = await tx.select().from(schema.dividends).where(eq(schema.dividends.id, id));
    if (!d) throw new AusschuettungError("Diese Ausschüttung gibt es nicht.");
    if ((await reversedEntries([d.entryId], tx)).size > 0) throw new AusschuettungError("Die Ausschüttung ist schon storniert.");
    if ((await sentIds([d.id], tx)).size > 0) {
      throw new AusschuettungError("Die Kapitalertragsteuer ist schon angemeldet; eine Korrektur geht über eine berichtigte Anmeldung.");
    }
    const lines = await tx.select().from(schema.journalLines).where(eq(schema.journalLines.entryId, d.entryId));
    const [entry] = await tx.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, d.entryId));
    await post(tx, await openBooks(tx), {
      date: entry!.date,
      description: `Storno: ${entry!.description}`,
      sourceType: "ausschuettung",
      sourceId: d.id,
      reversesId: d.entryId,
      lines: lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit, taxCode: null })),
    });
  });
}

export async function kapestSubmissions(dividendId: string) {
  return db
    .select({
      id: schema.kapestSubmissions.id,
      kind: schema.kapestSubmissions.kind,
      ok: schema.kapestSubmissions.ok,
      code: schema.kapestSubmissions.code,
      message: schema.kapestSubmissions.message,
      transferTicket: schema.kapestSubmissions.transferTicket,
      createdAt: schema.kapestSubmissions.createdAt,
    })
    .from(schema.kapestSubmissions)
    .where(eq(schema.kapestSubmissions.dividendId, dividendId))
    .orderBy(desc(schema.kapestSubmissions.createdAt));
}

export interface KapEStSubmitOptions {
  kind: "validate" | "test" | "send";
  pin?: string;
  herstellerId?: string;
}

/** Prüft oder übermittelt die Kapitalertragsteuer-Anmeldung zu einer Ausschüttung */
export function submitKapESt(actor: string, dividendId: string, client: ElsterClient, options: KapEStSubmitOptions): Promise<ElsterResult> {
  return uebermitteln(client, {
    sperre: `haben.kapest.${dividendId}`,
    vorgang: options.kind,
    herstellerId: options.herstellerId,
    pin: options.pin,
    vorbereiten: async ({ test, herstellerId }) => {
      const [d] = await db.select().from(schema.dividends).where(eq(schema.dividends.id, dividendId));
      if (!d) throw new AusschuettungError("Diese Ausschüttung gibt es nicht.");
      if ((await reversedEntries([d.entryId], db)).size > 0) throw new AusschuettungError("Die Ausschüttung ist storniert.");
      const company = await loadCompany();
      const problems = companyIssues(company);
      if (problems.length > 0) throw new AusschuettungError(`Firmendaten: ${problems.join(", ")}`);
      const year = Number(d.zufluss.slice(0, 4));
      if (!(KAPESTA_JAHRE as readonly number[]).includes(year)) {
        throw new AusschuettungError(`Die Kapitalertragsteuer-Anmeldung kennt Haben für ${KAPESTA_JAHRE.join(" und ")}, nicht für ${year}.`);
      }
      if (options.kind === "send" && (await sentIds([d.id], db)).size > 0) {
        throw new AusschuettungError("Diese Anmeldung ist schon übermittelt. Eine Berichtigung geht über das ELSTER-Portal.");
      }
      const summe = (f: (e: AusschuettungEmpfaenger) => number) => d.empfaenger.reduce((s, e) => s + f(e), 0);
      const xml = buildKapEStAXml({
        steuernummer13: toElsterSteuernummer(company.steuernummer, company.bundesland!),
        bundesland: company.bundesland!,
        schuldner: { name: company.name, strasse: company.strasse, plz: company.plz, ort: company.ort, telefon: company.telefon, email: company.email },
        ertrag: summe((e) => e.ertrag),
        kapest: summe((e) => e.kapest),
        soli: summe((e) => e.soli),
        kirchensteuer: d.empfaenger.filter((e) => e.kist > 0).map((e) => ({ religionsschluessel: e.religionsschluessel!, betrag: e.kist })),
        beschluss: { datum: d.beschlussDate, betrag: d.brutto, ...(d.auszahlungstag ? { auszahlungstag: d.auszahlungstag } : {}) },
        herstellerId,
        produktVersion: PRODUKT_VERSION,
        test,
      });
      return { xml, daten: null };
    },
    protokollieren: (result, xml) =>
      withActor(actor, (tx) =>
        tx.insert(schema.kapestSubmissions).values({
          dividendId,
          kind: options.kind,
          ok: result.ok,
          code: result.code,
          message: result.message,
          transferTicket: result.transferTicket ?? null,
          requestXml: xml,
          responseXml: result.responseXml,
          serverResponseXml: result.serverResponseXml,
          protocolPdf: result.pdf ? Buffer.from(result.pdf) : null,
        }),
      ),
  });
}

export async function loadKapEStProtocol(id: string) {
  const [row] = await db
    .select({ pdf: schema.kapestSubmissions.protocolPdf, zufluss: schema.dividends.zufluss })
    .from(schema.kapestSubmissions)
    .innerJoin(schema.dividends, eq(schema.dividends.id, schema.kapestSubmissions.dividendId))
    .where(eq(schema.kapestSubmissions.id, id));
  if (!row?.pdf) return null;
  return { pdf: row.pdf, filename: `KapESt-Anmeldung-${row.zufluss}-Protokoll.pdf` };
}

/** Alle nicht stornierten Ausschüttungen mit Zufluss und ob ihre Anmeldung echt übermittelt ist (Fristen) */
export async function kapestAnmeldungen(q: Db | Tx = db) {
  const rows = await q.select({ id: schema.dividends.id, zufluss: schema.dividends.zufluss, entryId: schema.dividends.entryId }).from(schema.dividends);
  const [reversed, sent] = await Promise.all([
    reversedEntries(
      rows.map((r) => r.entryId),
      q,
    ),
    sentIds(
      rows.map((r) => r.id),
      q,
    ),
  ]);
  return rows.filter((r) => !reversed.has(r.entryId)).map((r) => ({ id: r.id, zufluss: r.zufluss, angemeldet: sent.has(r.id) }));
}
