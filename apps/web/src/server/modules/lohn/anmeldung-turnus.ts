import { ersterVollerMonat, lstaTurnusVorschlag, volleMonateImJahr, type LstaTurnus, type LstaTurnusVorschlag } from "@haben/core";
import { and, asc, eq, isNotNull, isNull, min, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/*
 * Anmeldungszeitraum der Lohnsteuer-Anmeldung je Jahr (§ 41a Abs. 2 EStG): Vorschlag aus der Lohnsteuer des Vorjahres
 * oder des ersten vollen Monats, Einstellung und schon gesendete Anmeldungen (anmeldung.ts).
 */

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

/** Anmeldungszeitraum, zu dem ein Zeitraum-Schlüssel gehört: 01–12 Monat, 41–44 Vierteljahr, 19 Kalenderjahr */
const turnusVon = (zeitraum: number): LstaTurnus => (zeitraum === 19 ? "jaehrlich" : zeitraum >= 41 ? "vierteljaehrlich" : "monatlich");

/**
 * Anmeldungszeitraum eines Jahres: die Einstellung, sonst der, in dem schon echt angemeldet ist, sonst der Vorschlag,
 * sonst monatlich (§ 41a Abs. 2 Satz 1 EStG). Ein Vorschlag, der sich nach dem Senden ändert (etwa wenn im ersten Jahr
 * der erste volle Monat später abgerechnet wird), wechselt den Zeitraum nicht: Sonst stünde schon angemeldete Lohnsteuer
 * ein zweites Mal im Quartal oder Kalenderjahr.
 */
export async function turnusDesJahres(year: number, q: Db | Tx = db): Promise<TurnusStand> {
  const s = schema.lstaSubmissions;
  const [[eigen], [gesendet], vorschlag] = await Promise.all([
    q.select({ turnus: schema.lstaTurnus.turnus }).from(schema.lstaTurnus).where(eq(schema.lstaTurnus.year, year)),
    q
      .select({ zeitraum: s.zeitraum })
      .from(s)
      .where(and(eq(s.year, year), eq(s.kind, "send"), eq(s.ok, true)))
      .orderBy(asc(s.createdAt))
      .limit(1),
    turnusVorschlag(year, q),
  ]);
  const turnus = eigen?.turnus ?? (gesendet ? turnusVon(gesendet.zeitraum) : (vorschlag?.turnus ?? "monatlich"));
  return { year, turnus, eigen: Boolean(eigen), vorschlag };
}
