import {
  aggregateZm,
  gemeldeterStand,
  isValidGermanUstId,
  monthsOfPeriod,
  normalizeUstId,
  periodKey,
  ustIdProblem,
  zmBerichtigung,
  zmEuro,
  zmFrist,
  type Cents,
  type VatPeriod,
  type ZmZeile,
} from "@haben/core";
import { buildZmXml, type ElsterClient, type ElsterResult } from "@haben/elster";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { PRODUKT_VERSION, uebermitteln, type ElsterVorgang } from "../elster/index.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { computeVatFigures } from "./vat-figures.ts";
import { VatError } from "./vat.ts";

/*
 * Zusammenfassende Meldung (§ 18a UStG) an das BZSt. Haben meldet die sonstigen Leistungen an Unternehmer im übrigen
 * Gemeinschaftsgebiet (§ 3a Abs. 2 UStG, Rechnungen mit Reverse Charge) je Kalendervierteljahr (§ 18a Abs. 2 UStG), aus
 * denselben Umsätzen wie Kz 21 der Voranmeldung: nach Rechnungsdatum, auch bei Ist-Versteuerung; Stornos, Gutschriften,
 * Skonto und Forderungsausfall mindern im Zeitraum, in dem sie anfallen (§ 18a Abs. 7 Satz 2 mit § 17 UStG). Innergemein-
 * schaftliche Lieferungen und Dreiecksgeschäfte kennen die Rechnungen von Haben noch nicht.
 */

/** Ein Umsatz der Meldung mit seiner Rechnung, zum Nachvollziehen in der Oberfläche */
export interface ZmQuelle {
  invoiceId: string;
  number: string;
  customer: string;
  date: string;
  type: "invoice" | "ausbuchung";
  ustId: string;
  base: Cents;
}

async function zmQuellen(period: VatPeriod, q: Db | Tx): Promise<ZmQuelle[]> {
  const revenue = (await computeVatFigures(period, q)).revenue.filter(
    (r): r is typeof r & { type: "invoice" | "ausbuchung" } => r.treatment === "reverse_charge" && (r.type === "invoice" || r.type === "ausbuchung"),
  );
  const ids = [...new Set(revenue.map((r) => r.invoiceId))];
  const buyers = ids.length
    ? await q.select({ id: schema.invoices.id, buyer: schema.invoices.buyer }).from(schema.invoices).where(inArray(schema.invoices.id, ids))
    : [];
  const ustIdOf = new Map(buyers.map((b) => [b.id, normalizeUstId(b.buyer?.ustId ?? "")]));
  return revenue.map((r) => ({
    invoiceId: r.invoiceId,
    number: r.number,
    customer: r.customer,
    date: r.date,
    type: r.type,
    ustId: ustIdOf.get(r.invoiceId) ?? "",
    base: r.base,
  }));
}

export interface ZmIssue {
  tone: "error" | "warn" | "info";
  text: string;
}

/** Echt übermittelte Meldungen eines Zeitraums in der Reihenfolge des Sendens */
async function sentMeldungen(period: VatPeriod, q: Db | Tx) {
  return q
    .select({ berichtigt: schema.zmSubmissions.berichtigt, zeilen: schema.zmSubmissions.zeilen })
    .from(schema.zmSubmissions)
    .where(
      and(
        eq(schema.zmSubmissions.year, period.year),
        eq(schema.zmSubmissions.month, period.month),
        eq(schema.zmSubmissions.kind, "send"),
        eq(schema.zmSubmissions.ok, true),
      ),
    )
    .orderBy(asc(schema.zmSubmissions.createdAt));
}

/**
 * Kz 21 der zuletzt gesendeten Voranmeldungen, die im Quartal liegen (die drei Monate oder das Quartal selbst); null, solange
 * nicht für das ganze Quartal gesendet ist.
 */
async function kz21Gesendet(period: VatPeriod, q: Db | Tx): Promise<Cents | null> {
  const months = monthsOfPeriod(period).map((m) => m.month);
  const rows = await q
    .select({ month: schema.vatReturns.month, kz21: schema.vatReturns.kz21 })
    .from(schema.vatReturns)
    .where(and(eq(schema.vatReturns.year, period.year), eq(schema.vatReturns.status, "sent"), inArray(schema.vatReturns.month, [...months, period.month])))
    .orderBy(desc(schema.vatReturns.sentAt));
  const latest = new Map<number, Cents>();
  for (const row of rows) if (!latest.has(row.month)) latest.set(row.month, row.kz21);
  if (latest.has(period.month)) return latest.get(period.month)!;
  return months.every((m) => latest.has(m)) ? months.reduce((s, m) => s + latest.get(m)!, 0) : null;
}

/**
 * Vorprüfung: eigene USt-IdNr. und Anschrift, die USt-IdNr. jedes Kunden wie ERiC sie prüft, und der Abgleich mit Kz 21
 * der gesendeten Voranmeldungen. Kz 21 wird je Voranmeldung auf volle Euro abgeschnitten, die Meldung je Zeile; bis zu
 * einem Euro je Zeile und Voranmeldung ist deshalb Rundung.
 */
export function zmIssues(input: {
  company: { ustId: string; name: string; strasse: string; plz: string; ort: string };
  quellen: readonly ZmQuelle[];
  zeilen: readonly ZmZeile[];
  kz21: Cents | null;
  voranmeldungen: number;
}): ZmIssue[] {
  const issues: ZmIssue[] = [];
  if (!isValidGermanUstId(input.company.ustId)) {
    issues.push({ tone: "error", text: `Eigene USt-IdNr. ${input.company.ustId ? `${input.company.ustId} ist ungültig` : "fehlt"} (Firmendaten).` });
  }
  if (!input.company.name || !input.company.strasse || !/^\d{5}$/.test(input.company.plz) || !input.company.ort) {
    issues.push({ tone: "error", text: "Anschrift in den Firmendaten unvollständig." });
  }
  const seen = new Set<string>();
  for (const quelle of input.quellen) {
    const problem = ustIdProblem(quelle.ustId, "S");
    if (!problem || seen.has(`${quelle.invoiceId} ${problem}`)) continue;
    seen.add(`${quelle.invoiceId} ${problem}`);
    issues.push({ tone: "error", text: `Rechnung ${quelle.number} an ${quelle.customer}: ${problem}.` });
  }
  const gemeldet = input.zeilen.filter((z) => z.art === "S").reduce((s, z) => s + zmEuro(z.betrag), 0);
  if (input.kz21 === null) {
    issues.push({ tone: "info", text: "Die Voranmeldungen des Quartals sind noch nicht alle gesendet; der Abgleich mit Kz 21 folgt danach." });
  } else if (Math.abs(gemeldet - zmEuro(input.kz21)) > input.zeilen.length + input.voranmeldungen) {
    issues.push({
      tone: "warn",
      text: `Summe der Meldung ${gemeldet} € weicht von Kz 21 der gesendeten Voranmeldungen (${zmEuro(input.kz21)} €) ab. Stimmt die Voranmeldung noch, oder fehlt eine Berichtigung?`,
    });
  }
  return issues;
}

export async function zmSubmissions(period: VatPeriod) {
  return db
    .select({
      id: schema.zmSubmissions.id,
      kind: schema.zmSubmissions.kind,
      berichtigt: schema.zmSubmissions.berichtigt,
      zeilen: schema.zmSubmissions.zeilen,
      ok: schema.zmSubmissions.ok,
      code: schema.zmSubmissions.code,
      message: schema.zmSubmissions.message,
      transferTicket: schema.zmSubmissions.transferTicket,
      hasPdf: sql<boolean>`${schema.zmSubmissions.protocolPdf} is not null`,
      createdAt: schema.zmSubmissions.createdAt,
    })
    .from(schema.zmSubmissions)
    .where(and(eq(schema.zmSubmissions.year, period.year), eq(schema.zmSubmissions.month, period.month)))
    .orderBy(desc(schema.zmSubmissions.createdAt));
}

/** Stand eines Quartals: was zu melden ist, was gemeldet ist, und was eine Übermittlung jetzt senden würde */
export async function zmOverview(period: VatPeriod, q: Db | Tx = db) {
  const [quellen, company, meldungen, kz21] = await Promise.all([zmQuellen(period, q), loadCompany(q), sentMeldungen(period, q), kz21Gesendet(period, q)]);
  const zeilen = aggregateZm(quellen.map((r) => ({ ustId: r.ustId, art: "S" as const, base: r.base })));
  const sent = meldungen.length > 0;
  const gemeldet = gemeldeterStand(meldungen);
  const voranmeldungen = monthsOfPeriod(period).length;
  return {
    period,
    frist: zmFrist(period.year, period.month - 40),
    quellen,
    /** Aktuelle Zeilen aus den Rechnungen */
    zeilen,
    sent,
    /** Stand beim BZSt nach allen echt übermittelten Meldungen */
    gemeldet,
    /** Was als Nächstes gesendet würde: die Erstmeldung oder die geänderten Zeilen als Berichtigung */
    naechste: { berichtigt: sent, zeilen: sent ? zmBerichtigung(gemeldet, zeilen) : zeilen },
    kz21,
    issues: zmIssues({ company, quellen, zeilen, kz21, voranmeldungen }),
  };
}

export type ZmOverview = Awaited<ReturnType<typeof zmOverview>>;

/**
 * Quartale mit Umsätzen für die Meldung: Rechnungen mit Reverse Charge oder Ausbuchungen dazu (ohne aus Lexoffice
 * übernommene, deren Steuer dort gemeldet ist), dazu jedes Quartal, für das schon eine Meldung übermittelt ist.
 */
export async function zmQuartale(q: Db | Tx = db): Promise<(VatPeriod & { sent: boolean })[]> {
  const rc = and(eq(schema.invoices.taxTreatment, "reverse_charge"), isNull(schema.invoices.lexofficeVoucherId));
  const quarter = (date: string) => ({ year: Number(date.slice(0, 4)), month: 40 + Math.ceil(Number(date.slice(5, 7)) / 3) });
  const [issued, writeOffs, sent] = await Promise.all([
    q
      .selectDistinct({ date: schema.invoices.issueDate })
      .from(schema.invoices)
      .where(and(rc, eq(schema.invoices.status, "final"))),
    q
      .selectDistinct({ date: schema.writeOffs.date })
      .from(schema.writeOffs)
      .innerJoin(schema.invoices, eq(schema.invoices.id, schema.writeOffs.invoiceId))
      .where(and(rc, ne(schema.writeOffs.kind, "kursdifferenz"))),
    q
      .selectDistinct({ year: schema.zmSubmissions.year, month: schema.zmSubmissions.month })
      .from(schema.zmSubmissions)
      .where(and(eq(schema.zmSubmissions.kind, "send"), eq(schema.zmSubmissions.ok, true))),
  ]);
  const quartale = new Map<string, VatPeriod & { sent: boolean }>();
  for (const { date } of [...issued, ...writeOffs]) if (date) quartale.set(periodKey(quarter(date)), { ...quarter(date), sent: false });
  for (const s of sent) quartale.set(periodKey(s), { ...s, sent: true });
  return [...quartale.values()].sort((a, b) => a.year - b.year || a.month - b.month);
}

export interface ZmSubmitOptions {
  kind: ElsterVorgang;
  period: VatPeriod;
  pin?: string;
  herstellerId?: string;
}

/**
 * Prüft oder übermittelt die Meldung eines Quartals. Nach der ersten Echtübermittlung geht jede weitere als Berichtigung
 * mit den geänderten Zeilen; stimmt der gemeldete Stand, gibt es nichts mehr zu senden. Jeder Versuch landet in
 * zm_submissions, das nur anhängt.
 */
export function submitZm(actor: string, client: ElsterClient, options: ZmSubmitOptions): Promise<ElsterResult> {
  const { period } = options;
  return uebermitteln(client, {
    sperre: `haben.zm.${periodKey(period)}`,
    vorgang: options.kind,
    herstellerId: options.herstellerId,
    pin: options.pin,
    vorbereiten: async ({ test, herstellerId }) => {
      const [overview, company] = await Promise.all([zmOverview(period), loadCompany()]);
      const fehler = overview.issues.filter((i) => i.tone === "error");
      if (fehler.length > 0) throw new VatError(fehler.map((i) => i.text).join(" "));
      if (overview.sent && overview.naechste.zeilen.length === 0) {
        throw new VatError("Die Meldung ist übermittelt und stimmt mit den Rechnungen überein; es gibt nichts zu berichtigen.");
      }
      const gesendet = overview.naechste;
      const xml = buildZmXml({
        period,
        ustId: company.ustId,
        anschrift: { name: company.name, strasse: company.strasse, plz: company.plz, ort: company.ort },
        zeilen: gesendet.zeilen,
        berichtigt: gesendet.berichtigt,
        herstellerId,
        produktVersion: PRODUKT_VERSION,
        test,
      });
      return { xml, daten: gesendet };
    },
    protokollieren: (result, xml, gesendet) =>
      withActor(actor, (tx) =>
        tx.insert(schema.zmSubmissions).values({
          year: period.year,
          month: period.month,
          berichtigt: gesendet.berichtigt,
          zeilen: gesendet.zeilen,
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

export async function loadZmProtocol(id: string) {
  const [row] = await db
    .select({
      pdf: schema.zmSubmissions.protocolPdf,
      year: schema.zmSubmissions.year,
      month: schema.zmSubmissions.month,
      berichtigt: schema.zmSubmissions.berichtigt,
    })
    .from(schema.zmSubmissions)
    .where(eq(schema.zmSubmissions.id, id));
  if (!row?.pdf) return null;
  return { pdf: row.pdf, filename: `ZM-${row.year}-Q${row.month - 40}${row.berichtigt ? "-Berichtigung" : ""}-Protokoll.pdf` };
}
