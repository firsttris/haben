import {
  ersterVollerMonat,
  lstaBereich,
  lstaFrist,
  lstaKennzahlen,
  lstaKennzahlenGleich,
  lstaKey,
  lstaLabel,
  lstaTurnusVorschlag,
  lstaZeitraumAm,
  toElsterSteuernummer,
  volleMonateImJahr,
  type LstaAbrechnung,
  type LstaKennzahlen,
  type LstaTurnus,
  type LstaTurnusVorschlag,
  type LstaZeitraum,
} from "@haben/core";
import { buildLStAXml, LSTA_JAHRE, LSTA_JAHRE_TEXT, lstaAusfuellliste, type ElsterClient, type ElsterResult } from "@haben/elster";
import { and, asc, desc, eq, gte, isNotNull, isNull, lt, min, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { ericKennt, PRODUKT_VERSION, uebermitteln, type ElsterVorgang } from "../elster/index.ts";
import { companyIssues, loadCompany } from "../stammdaten/index.ts";
import { LohnError } from "./employees.ts";

/*
 * Lohnsteuer-Anmeldung (§ 41a EStG, docs/lohn-plan.md PR 5) aus den festgeschriebenen, nicht stornierten Abrechnungen:
 * Kennzahlen je Anmeldungszeitraum nach dem Zahltag (lohnsteuer-anmeldung.ts in @haben/core), Anmeldungszeitraum je
 * Jahr, Prüfen und Senden über ERiC (lsta.ts in @haben/elster), Verlauf in lsta_submissions (nur anhängen). Nach der
 * ersten Echtübermittlung geht jede weitere als berichtigte Anmeldung (Kz 10) mit allen Kennzahlen; ein Storno nach dem
 * Senden zeigt sich so als Abweichung, die eine Berichtigung verlangt.
 */

const TURNUS = ["monatlich", "vierteljaehrlich", "jaehrlich"] as const;

export const lstaZeitraumSchema = z
  .object({ year: z.number().int().min(2000).max(2100), zeitraum: z.number().int() })
  .refine((z) => (z.zeitraum >= 1 && z.zeitraum <= 12) || (z.zeitraum >= 41 && z.zeitraum <= 44) || z.zeitraum === 19, "Zeitraum 1–12, 41–44 oder 19");

export const lstaTurnusSchema = z.object({ year: z.number().int().min(2000).max(2100), turnus: z.enum(TURNUS).nullable() });

/** Festgeschriebene, nicht stornierte Abrechnungen mit Zahltag in [start, end) */
async function abrechnungenImBereich(start: string, end: string, q: Db | Tx) {
  const p = schema.payslips;
  return q
    .select({
      id: p.id,
      employeeId: p.employeeId,
      year: p.year,
      month: p.month,
      zahltag: p.zahltag,
      mitarbeiter: p.mitarbeiter,
      lohnsteuer: p.lohnsteuer,
      soli: p.soli,
      kirchensteuer: p.kirchensteuer,
      pauschsteuer: p.pauschsteuer,
    })
    .from(p)
    .leftJoin(schema.payslipCancellations, eq(schema.payslipCancellations.payslipId, p.id))
    .where(and(isNotNull(p.lockedAt), isNull(schema.payslipCancellations.id), gte(p.zahltag, start), lt(p.zahltag, end)))
    .orderBy(asc(p.zahltag), asc(p.year), asc(p.month));
}

const alsLsta = (a: Awaited<ReturnType<typeof abrechnungenImBereich>>[number]): LstaAbrechnung => ({
  mitarbeiter: a.employeeId,
  jahr: a.year,
  lohnsteuer: a.lohnsteuer,
  soli: a.soli,
  kirchensteuer: a.kirchensteuer,
  konfession: a.mitarbeiter.lohn.konfession,
});

/** Lohnsteuer der festgeschriebenen, nicht stornierten Abrechnungen eines Lohnzahlungszeitraums (Jahr, optional Monat) */
async function lohnsteuerFuer(year: number, month: number | null, q: Db | Tx): Promise<number> {
  const p = schema.payslips;
  const [row] = await q
    .select({ summe: sql<string>`coalesce(sum(${p.lohnsteuer}), 0)` })
    .from(p)
    .leftJoin(schema.payslipCancellations, eq(schema.payslipCancellations.payslipId, p.id))
    .where(and(isNotNull(p.lockedAt), isNull(schema.payslipCancellations.id), eq(p.year, year), month === null ? undefined : eq(p.month, month)));
  return Number(row?.summe ?? 0);
}

/**
 * Grundlage des Vorschlags: Eröffnung der Betriebsstätte ist die erste Buchung in Haben, wenn es keine Eröffnungsbuchung
 * gibt (sonst bestand der Betrieb schon vorher). Die Lohnsteuer des Vorjahres kennt Haben nur, wenn es das ganze Vorjahr
 * bzw. den Betrieb ab der Eröffnung führt.
 */
async function turnusVorschlag(year: number, q: Db | Tx): Promise<LstaTurnusVorschlag | null> {
  const e = schema.journalEntries;
  const [first] = await q.select({ date: min(e.date), eroeffnung: sql<boolean>`bool_or(${e.sourceType} = 'eroeffnung')` }).from(e);
  const start = first?.date ?? null;
  if (!start) return null;
  const bekannt = !first?.eroeffnung;
  if (!bekannt) {
    // Ein älterer Betrieb: das Vorjahr nur, wenn Haben es ganz führt
    if (start > `${year - 1}-01-01`) return null;
    return lstaTurnusVorschlag({ year, vorjahr: { lohnsteuer: await lohnsteuerFuer(year - 1, null, q), monate: 12 }, ersterVollerMonat: null });
  }
  if (Number(start.slice(0, 4)) > year) return null;
  const monate = volleMonateImJahr(start, year - 1);
  if (Number(start.slice(0, 4)) < year && monate > 0) {
    return lstaTurnusVorschlag({ year, vorjahr: { lohnsteuer: await lohnsteuerFuer(year - 1, null, q), monate }, ersterVollerMonat: null });
  }
  // Im Vorjahr noch nicht (oder keinen vollen Monat) bestanden: erster voller Kalendermonat nach der Eröffnung, sobald
  // er abgerechnet ist
  const monat = ersterVollerMonat(start);
  const p = schema.payslips;
  const [abgerechnet] = await q
    .select({ id: p.id })
    .from(p)
    .where(and(isNotNull(p.lockedAt), eq(p.year, Number(monat.slice(0, 4))), eq(p.month, Number(monat.slice(5, 7)))))
    .limit(1);
  if (!abgerechnet) return null;
  return lstaTurnusVorschlag({
    year,
    vorjahr: null,
    ersterVollerMonat: { lohnsteuer: await lohnsteuerFuer(Number(monat.slice(0, 4)), Number(monat.slice(5, 7)), q), monat },
  });
}

export interface TurnusStand {
  year: number;
  turnus: LstaTurnus;
  /** Vom Nutzer festgelegt, nicht aus dem Vorschlag */
  eigen: boolean;
  vorschlag: LstaTurnusVorschlag | null;
}

/** Anmeldungszeitraum eines Jahres: die Einstellung, sonst der Vorschlag, sonst monatlich (§ 41a Abs. 2 Satz 1 EStG) */
export async function turnusDesJahres(year: number, q: Db | Tx = db): Promise<TurnusStand> {
  const [[eigen], vorschlag] = await Promise.all([
    q.select({ turnus: schema.lstaTurnus.turnus }).from(schema.lstaTurnus).where(eq(schema.lstaTurnus.year, year)),
    turnusVorschlag(year, q),
  ]);
  return { year, turnus: eigen?.turnus ?? vorschlag?.turnus ?? "monatlich", eigen: Boolean(eigen), vorschlag };
}

const passt = (z: LstaZeitraum, turnus: LstaTurnus) => lstaKey(lstaZeitraumAm(lstaBereich(z).start, turnus)) === lstaKey(z);

/** Echt übermittelte Anmeldungen eines Jahres oder Zeitraums, älteste zuerst */
async function gesendete(q: Db | Tx, year: number, zeitraum?: number) {
  const s = schema.lstaSubmissions;
  return q
    .select({ id: s.id, year: s.year, zeitraum: s.zeitraum, berichtigt: s.berichtigt, kennzahlen: s.kennzahlen, createdAt: s.createdAt })
    .from(s)
    .where(and(eq(s.year, year), zeitraum === undefined ? undefined : eq(s.zeitraum, zeitraum), eq(s.kind, "send"), eq(s.ok, true)))
    .orderBy(asc(s.createdAt));
}

/**
 * Legt den Anmeldungszeitraum eines Jahres fest (null: dem Vorschlag folgen). Abgelehnt, wenn danach eine echt
 * übermittelte Anmeldung des Jahres nicht mehr zu ihrem Zeitraum passt.
 */
export async function saveLstaTurnus(actor: string, input: z.input<typeof lstaTurnusSchema>): Promise<void> {
  const { year, turnus } = lstaTurnusSchema.parse(input);
  await withActor(actor, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`haben.lsta.turnus.${year}`}))`);
    if (turnus === null) await tx.delete(schema.lstaTurnus).where(eq(schema.lstaTurnus.year, year));
    else
      await tx
        .insert(schema.lstaTurnus)
        .values({ year, turnus, updatedAt: new Date() })
        .onConflictDoUpdate({ target: schema.lstaTurnus.year, set: { turnus, updatedAt: new Date() } });
    const neu = (await turnusDesJahres(year, tx)).turnus;
    const unpassend = (await gesendete(tx, year)).filter((s) => !passt(s, neu));
    if (unpassend.length > 0) {
      throw new LohnError(
        `Für ${[...new Set(unpassend.map((s) => lstaLabel(s)))].join(", ")} ist schon eine Lohnsteuer-Anmeldung übermittelt, die zu diesem Zeitraum nicht passt.`,
      );
    }
  });
}

export interface LstaIssue {
  tone: "error" | "warn" | "info";
  text: string;
}

/** Stand eines Anmeldungszeitraums: Abrechnungen, Kennzahlen, was gemeldet ist und was als Nächstes ginge */
export async function lstaOverview(zeitraum: LstaZeitraum, today: string, q: Db | Tx = db) {
  const { start, end } = lstaBereich(zeitraum);
  const [company, turnus, abrechnungen, meldungen, entwuerfe] = await Promise.all([
    loadCompany(q),
    turnusDesJahres(zeitraum.year, q),
    abrechnungenImBereich(start, end, q),
    gesendete(q, zeitraum.year, zeitraum.zeitraum),
    q
      .select({ id: schema.payslips.id })
      .from(schema.payslips)
      .where(and(isNull(schema.payslips.lockedAt), gte(schema.payslips.zahltag, start), lt(schema.payslips.zahltag, end))),
  ]);
  const issues: LstaIssue[] = [];
  const firma = companyIssues(company);
  if (firma.length > 0) issues.push({ tone: "error", text: `Firmendaten: ${firma.join(", ")}.` });
  if (!(LSTA_JAHRE as readonly number[]).includes(zeitraum.year)) {
    issues.push({ tone: "error", text: `Die Lohnsteuer-Anmeldung kennt Haben für ${LSTA_JAHRE_TEXT}, nicht für ${zeitraum.year}.` });
  }
  if (!passt(zeitraum, turnus.turnus)) {
    issues.push({ tone: "error", text: `${lstaLabel(zeitraum)} passt nicht zum Anmeldungszeitraum ${zeitraum.year} (${turnusText(turnus.turnus)}).` });
  }
  if (entwuerfe.length > 0) {
    issues.push({
      tone: "warn",
      text: `${entwuerfe.length === 1 ? "Eine Abrechnung" : `${entwuerfe.length} Abrechnungen`} mit Zahltag im Zeitraum ${entwuerfe.length === 1 ? "ist" : "sind"} noch Entwurf und nicht enthalten.`,
    });
  }
  if (today < end) issues.push({ tone: "info", text: `Der Zeitraum endet erst am ${formatTag(addTage(end, -1))}; echt senden geht danach.` });
  const ergebnis = company.bundesland ? lstaKennzahlen({ zeitraum, bundesland: company.bundesland, abrechnungen: abrechnungen.map(alsLsta) }) : null;
  if (ergebnis && !ergebnis.ok) for (const text of ergebnis.probleme) issues.push({ tone: "error", text });
  const kennzahlen = ergebnis?.ok ? ergebnis.kennzahlen : null;
  const gemeldet = meldungen.at(-1)?.kennzahlen ?? null;
  const sent = meldungen.length > 0;
  return {
    zeitraum,
    key: lstaKey(zeitraum),
    label: lstaLabel(zeitraum),
    frist: lstaFrist(zeitraum, company.bundesland),
    turnus,
    abrechnungen: abrechnungen.map((a) => ({
      id: a.id,
      name: `${a.mitarbeiter.vorname} ${a.mitarbeiter.nachname}`,
      art: a.mitarbeiter.lohn.art,
      year: a.year,
      month: a.month,
      zahltag: a.zahltag,
      lohnsteuer: a.lohnsteuer,
      soli: a.soli,
      kirchensteuer: a.kirchensteuer,
      pauschsteuer: a.pauschsteuer,
    })),
    kennzahlen,
    sent,
    gemeldet,
    /** Seit der letzten Echtübermittlung geändert: Berichtigung nötig */
    abweichend: Boolean(sent && kennzahlen && gemeldet && !lstaKennzahlenGleich(kennzahlen, gemeldet)),
    /** Was als Nächstes ginge: die Erstanmeldung oder eine Berichtigung; null, wenn nichts zu senden ist */
    naechste: kennzahlen && (!sent || (gemeldet && !lstaKennzahlenGleich(kennzahlen, gemeldet))) ? { berichtigt: sent, kennzahlen } : null,
    abgelaufen: today >= end,
    issues,
  };
}

export type LstaOverview = Awaited<ReturnType<typeof lstaOverview>>;

const turnusText = (t: LstaTurnus) => ({ monatlich: "monatlich", vierteljaehrlich: "vierteljährlich", jaehrlich: "jährlich" })[t];
const addTage = (iso: string, tage: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + tage * 86_400_000).toISOString().slice(0, 10);
const formatTag = (iso: string) => iso.split("-").reverse().join(".");

/**
 * Anmeldungszeiträume mit festgeschriebenen Abrechnungen (nach Zahltag und dem Anmeldungszeitraum des Jahres) und alle
 * mit einer Echtübermittlung; `angemeldet`, wenn die zuletzt gesendeten Kennzahlen noch stimmen.
 */
export async function lstaZeitraeume(today: string, q: Db | Tx = db): Promise<(LstaZeitraum & { key: string; angemeldet: boolean; gesendet: boolean })[]> {
  const p = schema.payslips;
  const tage = await q
    .selectDistinct({ zahltag: p.zahltag })
    .from(p)
    .leftJoin(schema.payslipCancellations, eq(schema.payslipCancellations.payslipId, p.id))
    .where(and(isNotNull(p.lockedAt), isNull(schema.payslipCancellations.id)));
  const s = schema.lstaSubmissions;
  const gesendet = await q
    .selectDistinct({ year: s.year, zeitraum: s.zeitraum })
    .from(s)
    .where(and(eq(s.kind, "send"), eq(s.ok, true)));
  const jahre = new Map<number, LstaTurnus>();
  for (const year of new Set(tage.map((t) => Number(t.zahltag.slice(0, 4))))) jahre.set(year, (await turnusDesJahres(year, q)).turnus);
  const zeitraeume = new Map<string, LstaZeitraum>();
  for (const { zahltag } of tage) {
    const z = lstaZeitraumAm(zahltag, jahre.get(Number(zahltag.slice(0, 4)))!);
    zeitraeume.set(lstaKey(z), z);
  }
  for (const z of gesendet) zeitraeume.set(lstaKey(z), z);
  const result = [];
  for (const z of [...zeitraeume.values()].sort((a, b) => lstaBereich(a).start.localeCompare(lstaBereich(b).start) || a.zeitraum - b.zeitraum)) {
    const o = await lstaOverview(z, today, q);
    result.push({ ...z, key: lstaKey(z), gesendet: o.sent, angemeldet: o.sent && !o.abweichend });
  }
  return result;
}

export async function lstaSubmissions(zeitraum: LstaZeitraum) {
  const s = schema.lstaSubmissions;
  return db
    .select({
      id: s.id,
      kind: s.kind,
      berichtigt: s.berichtigt,
      kennzahlen: s.kennzahlen,
      ok: s.ok,
      code: s.code,
      message: s.message,
      transferTicket: s.transferTicket,
      hasPdf: sql<boolean>`${s.protocolPdf} is not null`,
      createdAt: s.createdAt,
    })
    .from(s)
    .where(and(eq(s.year, zeitraum.year), eq(s.zeitraum, zeitraum.zeitraum)))
    .orderBy(desc(s.createdAt));
}

/** Angaben für das XML; dieselben für Senden und Ausfüllliste */
async function xmlAngaben(zeitraum: LstaZeitraum, kind: ElsterVorgang | "liste", today: string) {
  const overview = await lstaOverview(zeitraum, today);
  const fehler = overview.issues.filter((i) => i.tone === "error");
  if (fehler.length > 0) throw new LohnError(fehler.map((i) => i.text).join(" "));
  if (!overview.naechste) throw new LohnError("Die Anmeldung ist übermittelt und stimmt mit den Abrechnungen überein; es gibt nichts zu berichtigen.");
  if (kind === "send" && !overview.abgelaufen) throw new LohnError(`Echt senden geht erst nach Ablauf des Zeitraums ${overview.label}.`);
  if (kind !== "liste" && !ericKennt(`LStA_${zeitraum.year}`)) {
    throw new LohnError(
      `Das geladene ERiC kennt die Lohnsteuer-Anmeldung ${zeitraum.year} noch nicht; unter Einstellungen › ELSTER eine neuere Version laden.`,
    );
  }
  const company = await loadCompany();
  return {
    zeitraum,
    steuernummer13: toElsterSteuernummer(company.steuernummer, company.bundesland!),
    kennzahlen: overview.naechste.kennzahlen,
    berichtigt: overview.naechste.berichtigt,
    datenlieferant: { name: company.name, strasse: company.strasse, plz: company.plz, ort: company.ort },
  };
}

export interface LstaSubmitOptions {
  kind: ElsterVorgang;
  zeitraum: LstaZeitraum;
  pin?: string;
  herstellerId?: string;
  today: string;
}

/**
 * Prüft oder übermittelt die Anmeldung eines Zeitraums. Nach der ersten Echtübermittlung geht jede weitere als
 * berichtigte Anmeldung; stimmen die Kennzahlen mit der zuletzt gesendeten, gibt es nichts zu senden. Jeder Versuch
 * landet in lsta_submissions, das nur anhängt.
 */
export function submitLsta(actor: string, client: ElsterClient, options: LstaSubmitOptions): Promise<ElsterResult> {
  const { zeitraum } = options;
  return uebermitteln(client, {
    sperre: `haben.lsta.${lstaKey(zeitraum)}`,
    vorgang: options.kind,
    herstellerId: options.herstellerId,
    pin: options.pin,
    vorbereiten: async ({ test, herstellerId }) => {
      const angaben = await xmlAngaben(zeitraum, options.kind, options.today);
      const xml = buildLStAXml({ ...angaben, herstellerId, produktVersion: PRODUKT_VERSION, test });
      return { xml, daten: angaben };
    },
    protokollieren: (result, xml, angaben) =>
      withActor(actor, (tx) =>
        tx.insert(schema.lstaSubmissions).values({
          year: zeitraum.year,
          zeitraum: zeitraum.zeitraum,
          berichtigt: angaben.berichtigt,
          kennzahlen: angaben.kennzahlen,
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

/** Ohne eigene Hersteller-ID: die Werte für Mein ELSTER aus denselben Nutzdaten, die Haben senden würde */
export async function lstaAusfuelllisteFuer(zeitraum: LstaZeitraum, today: string) {
  return lstaAusfuellliste(await xmlAngaben(zeitraum, "liste", today));
}

export async function loadLstaProtocol(id: string) {
  const s = schema.lstaSubmissions;
  const [row] = await db.select({ pdf: s.protocolPdf, year: s.year, zeitraum: s.zeitraum, berichtigt: s.berichtigt }).from(s).where(eq(s.id, id));
  if (!row?.pdf) return null;
  return { pdf: row.pdf, filename: `LStA-${lstaKey(row)}${row.berichtigt ? "-Berichtigung" : ""}-Protokoll.pdf` };
}

/**
 * Gesamtbeträge (Kz 83) der zuletzt echt übermittelten Anmeldungen, für Vorschläge im Bankabgleich: Eine Lastschrift
 * des Finanzamts über genau diesen Betrag ist die Lohnsteuer dieses Zeitraums.
 */
export async function lstaZahlbetraege(q: Db | Tx = db): Promise<{ key: string; label: string; betrag: number }[]> {
  const s = schema.lstaSubmissions;
  const rows = await q
    .select({ year: s.year, zeitraum: s.zeitraum, kennzahlen: s.kennzahlen })
    .from(s)
    .where(and(eq(s.kind, "send"), eq(s.ok, true)))
    .orderBy(asc(s.createdAt));
  const letzte = new Map<string, { key: string; label: string; betrag: number }>();
  for (const r of rows) letzte.set(lstaKey(r), { key: lstaKey(r), label: lstaLabel(r), betrag: (r.kennzahlen as LstaKennzahlen).kz83 });
  return [...letzte.values()].filter((z) => z.betrag > 0);
}
