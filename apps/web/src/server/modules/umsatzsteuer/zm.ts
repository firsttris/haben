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
  type TaxTreatment,
  type VatPeriod,
  type ZmArt,
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
 * Gemeinschaftsgebiet (§ 3a Abs. 2 UStG, Rechnungen mit Reverse Charge, Umsatzart S) und die innergemeinschaftlichen
 * Lieferungen (§ 18a Abs. 6 Nr. 1 UStG, Umsatzart L) je Kalendervierteljahr (§ 18a Abs. 1 und 2 UStG), aus denselben
 * Umsätzen wie Kz 21 und 41 der Voranmeldung: nach Rechnungsdatum, auch bei Ist-Versteuerung; Stornos, Gutschriften,
 * Skonto und Forderungsausfall mindern im Zeitraum, in dem sie anfallen (§ 18a Abs. 7 Satz 2 mit § 17 UStG).
 * Dreiecksgeschäfte (Umsatzart D) und Monatsmeldungen bei Lieferungen über 50.000 € im Quartal unterstützt Haben nicht.
 */

/** Ein Umsatz der Meldung mit seiner Rechnung, zum Nachvollziehen in der Oberfläche */
export interface ZmQuelle {
  invoiceId: string;
  number: string;
  customer: string;
  date: string;
  type: "invoice" | "ausbuchung";
  ustId: string;
  /** S für Reverse Charge, L für innergemeinschaftliche Lieferungen */
  art: ZmArt;
  base: Cents;
}

/** Steuerfall der Rechnung → Umsatzart der Meldung */
const ZM_ARTEN: Partial<Record<TaxTreatment, ZmArt>> = { reverse_charge: "S", ig_lieferung: "L" };

/** Lieferungen über diesem Betrag im Quartal verlangen eine Monatsmeldung (§ 18a Abs. 1 Satz 2 UStG) */
const MONATSMELDUNG_AB: Cents = 50_000_00;

async function zmQuellen(period: VatPeriod, q: Db | Tx): Promise<ZmQuelle[]> {
  const revenue = (await computeVatFigures(period, q)).revenue.filter(
    (r): r is typeof r & { type: "invoice" | "ausbuchung" } => r.treatment in ZM_ARTEN && (r.type === "invoice" || r.type === "ausbuchung"),
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
    art: ZM_ARTEN[r.treatment]!,
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
 * Kz 21 (sonstige Leistungen) bzw. Kz 41 (Lieferungen) der zuletzt gesendeten Voranmeldungen, die im Quartal liegen (die drei
 * Monate oder das Quartal selbst); null, solange nicht für das ganze Quartal gesendet ist.
 */
async function kennzahlGesendet(period: VatPeriod, kz: "kz21" | "kz41", q: Db | Tx): Promise<Cents | null> {
  const months = monthsOfPeriod(period).map((m) => m.month);
  const rows = await q
    .select({ month: schema.vatReturns.month, value: schema.vatReturns[kz] })
    .from(schema.vatReturns)
    .where(and(eq(schema.vatReturns.year, period.year), eq(schema.vatReturns.status, "sent"), inArray(schema.vatReturns.month, [...months, period.month])))
    .orderBy(desc(schema.vatReturns.sentAt));
  const latest = new Map<number, Cents>();
  for (const row of rows) if (!latest.has(row.month)) latest.set(row.month, row.value);
  if (latest.has(period.month)) return latest.get(period.month)!;
  return months.every((m) => latest.has(m)) ? months.reduce((s, m) => s + latest.get(m)!, 0) : null;
}

/**
 * Vorprüfung: eigene USt-IdNr. und Anschrift, die USt-IdNr. jedes Kunden wie ERiC sie prüft, und der Abgleich mit Kz 21
 * (sonstige Leistungen) und Kz 41 (Lieferungen) der gesendeten Voranmeldungen. Die Kennzahlen werden je Voranmeldung auf
 * volle Euro abgeschnitten, die Meldung je Zeile; bis zu einem Euro je Zeile und Voranmeldung ist deshalb Rundung.
 */
export function zmIssues(input: {
  company: { ustId: string; name: string; strasse: string; plz: string; ort: string };
  quellen: readonly ZmQuelle[];
  zeilen: readonly ZmZeile[];
  kz21: Cents | null;
  /** Kz 41 der gesendeten Voranmeldungen; ohne Angabe kein Abgleich der Lieferungen */
  kz41?: Cents | null;
  voranmeldungen: number;
}): ZmIssue[] {
  const issues: ZmIssue[] = [];
  if (!isValidGermanUstId(input.company.ustId)) {
    issues.push({ tone: "error", text: `Eigene USt-IdNr. ${input.company.ustId ? `${input.company.ustId} ist ungültig` : "fehlt"} (Firmendaten).` });
  }
  if (!input.company.name || !input.company.strasse || !/^\d{5}$/.test(input.company.plz) || !input.company.ort) {
    issues.push({ tone: "error", text: "Anschrift in den Firmendaten unvollständig." });
  }
  // Nur Kunden mit einer Zeile in der Meldung: hebt sich ein Umsatz im Quartal auf (Storno im selben Quartal), ist nichts
  // zu melden, und die festgeschriebene Rechnung ließe sich ohnehin nicht mehr ändern
  const gemeldeteIds = new Set(input.zeilen.map((z) => z.ustId));
  const seen = new Set<string>();
  for (const quelle of input.quellen.filter((q) => gemeldeteIds.has(q.ustId))) {
    const problem = ustIdProblem(quelle.ustId, quelle.art);
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
  issues.push(...lieferungIssues(input));
  return issues;
}

/**
 * Innergemeinschaftliche Lieferungen: Abgleich mit Kz 41, die Grenze für Monatsmeldungen (§ 18a Abs. 1 Satz 2 UStG: mehr
 * als 50.000 € im Quartal oder in einem der vier vorangegangenen) und der Gelangensnachweis (§ 17a UStDV) als Erinnerung
 */
function lieferungIssues(input: { zeilen: readonly ZmZeile[]; kz41?: Cents | null; voranmeldungen: number }): ZmIssue[] {
  const lieferungen = input.zeilen.filter((z) => z.art === "L");
  if (lieferungen.length === 0 && !input.kz41) return [];
  const issues: ZmIssue[] = [];
  const summe = lieferungen.reduce((s, z) => s + zmEuro(z.betrag), 0);
  if (input.kz41 !== undefined && input.kz41 !== null && Math.abs(summe - zmEuro(input.kz41)) > lieferungen.length + input.voranmeldungen) {
    issues.push({
      tone: "warn",
      text: `Lieferungen in der Meldung ${summe} € weichen von Kz 41 der gesendeten Voranmeldungen (${zmEuro(input.kz41)} €) ab. Stimmt die Voranmeldung noch, oder fehlt eine Berichtigung?`,
    });
  }
  if (summe * 100 > MONATSMELDUNG_AB) {
    issues.push({
      tone: "error",
      text: "Mehr als 50.000 € innergemeinschaftliche Lieferungen im Quartal: Die Meldung ist monatlich abzugeben (§ 18a Abs. 1 Satz 2 UStG). Monatsmeldungen unterstützt Haben nicht; gib sie im BZStOnline-Portal ab.",
    });
  } else if (lieferungen.length > 0) {
    issues.push({
      tone: "info",
      text: "Lagen die Lieferungen im laufenden oder in einem der vier vorangegangenen Quartale über 50.000 €, ist monatlich zu melden (§ 18a Abs. 1 Satz 2 UStG); das unterstützt Haben nicht. Für jede Lieferung gehört der Gelangensnachweis (§ 17a UStDV) zu den Unterlagen.",
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

const zmZeilen = (quellen: readonly ZmQuelle[]) => aggregateZm(quellen.map((r) => ({ ustId: r.ustId, art: r.art, base: r.base })));

/** Stand eines Quartals: was zu melden ist, was gemeldet ist, und was eine Übermittlung jetzt senden würde */
export async function zmOverview(period: VatPeriod, q: Db | Tx = db) {
  const [quellen, company, meldungen, kz21] = await Promise.all([
    zmQuellen(period, q),
    loadCompany(q),
    sentMeldungen(period, q),
    kennzahlGesendet(period, "kz21", q),
  ]);
  const zeilen = zmZeilen(quellen);
  const kz41 = await kennzahlGesendet(period, "kz41", q);
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
    kz41,
    issues: zmIssues({ company, quellen, zeilen, kz21, kz41, voranmeldungen }),
  };
}

export type ZmOverview = Awaited<ReturnType<typeof zmOverview>>;

/**
 * Quartale mit Umsätzen für die Meldung: Rechnungen mit Reverse Charge oder innergemeinschaftlicher Lieferung oder Ausbuchungen dazu (ohne aus Lexoffice
 * übernommene, deren Steuer dort gemeldet ist), sofern sie eine Meldezeile ergeben, dazu jedes Quartal, für das schon eine
 * Meldung übermittelt ist.
 */
export async function zmQuartale(q: Db | Tx = db): Promise<(VatPeriod & { sent: boolean })[]> {
  const rc = and(inArray(schema.invoices.taxTreatment, ["reverse_charge", "ig_lieferung"]), isNull(schema.invoices.lexofficeVoucherId));
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
  // Heben sich die Umsätze eines Quartals auf, ist keine Meldung abzugeben (keine Nullmeldung, § 18a Abs. 1 UStG)
  for (const [k, quartal] of quartale) if (zmZeilen(await zmQuellen(quartal, q)).length === 0) quartale.delete(k);
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
