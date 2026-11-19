import {
  form01,
  form01Betrag,
  form01Zeile,
  resolveOwnAccount,
  type Cents,
  type Form01Saldo,
  type Form01Werte,
  type Form01Zeile,
  type Kontenrahmen,
  type Zeitraum,
} from "@haben/core";
import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { accountName } from "../buchhaltung/index.ts";
import { loadOwnAccountParents, refreshOwnAccountNames } from "../eigene-konten/index.ts";

/*
 * Kurzfristige Erfolgsrechnung (DATEV-Form 01) für GmbH und UG (#1380): periodengerecht aus den Salden der Konten im
 * Journal nach Buchungsdatum, wie die GuV im Jahresabschluss. Mit manuellen Buchungen und Abschlussbuchungen, ohne
 * Eröffnungsbuchungen (sie übernehmen nur Bestände). Ein eigenes Sachkonto (#270) zählt in der Zeile seiner
 * Elternkategorie wie in GuV und E-Bilanz; im Drilldown steht es mit seiner eigenen Nummer, damit der Link das
 * Kontenblatt mit seinen Buchungen öffnet.
 */

/** Saldo eines Kontos im Zeitraum, mit der Nummer, wie gebucht */
interface KontoSaldo extends Form01Saldo {
  konto: string;
}

/** Salden aller Konten im Zeitraum, beide Grenzen eingeschlossen */
async function salden(zeitraum: Zeitraum, q: Db | Tx): Promise<KontoSaldo[]> {
  const e = schema.journalEntries;
  const l = schema.journalLines;
  const rows = await q
    .select({ kontenrahmen: e.kontenrahmen, account: l.account, saldo: sql<string>`sum(${l.debit} - ${l.credit})` })
    .from(l)
    .innerJoin(e, eq(l.entryId, e.id))
    // Herkunft „eroeffnung“: Saldenvorträge aus der Vorbuchhaltung, wie in der Saldenliste (ledger.ts)
    .where(and(gte(e.date, zeitraum.von), lte(e.date, zeitraum.bis), ne(e.sourceType, "eroeffnung")))
    .groupBy(e.kontenrahmen, l.account);
  const eigene = { SKR03: await loadOwnAccountParents("SKR03", q), SKR04: await loadOwnAccountParents("SKR04", q) };
  return rows
    .map((r) => {
      const kontenrahmen = r.kontenrahmen as Kontenrahmen;
      return { kontenrahmen, konto: r.account, account: resolveOwnAccount(kontenrahmen, r.account, eigene[kontenrahmen]), saldo: Number(r.saldo) };
    })
    .filter((r) => r.saldo !== 0);
}

/** Die Form 01 je Zeitraum; null bleibt null (kein Vergleich) */
export async function form01Werte(zeitraeume: readonly (Zeitraum | null)[], q: Db | Tx): Promise<(Form01Werte | null)[]> {
  const werte: (Form01Werte | null)[] = [];
  for (const z of zeitraeume) werte.push(z ? form01(await salden(z, q)) : null);
  return werte;
}

/** Ein Konto in einer Zeile der Form 01 */
export interface BwaForm01Konto {
  konto: string;
  name: string;
  kontenrahmen: Kontenrahmen;
  /** Betrag in der Zeile: Erträge mit Haben-Saldo, Aufwand mit Soll-Saldo positiv */
  betrag: Cents;
}

/** Was in einer Zeile der Form 01 im Zeitraum steht: die Konten mit Saldo, die größten zuerst */
export async function bwaForm01Konten(zeitraum: Zeitraum, zeile: Form01Zeile, q: Db | Tx = db): Promise<BwaForm01Konto[]> {
  await refreshOwnAccountNames();
  return (await salden(zeitraum, q))
    .filter((s) => form01Zeile(s.kontenrahmen, s.account) === zeile)
    .map((s) => ({ konto: s.konto, name: accountName(s.kontenrahmen, s.konto), kontenrahmen: s.kontenrahmen, betrag: form01Betrag(zeile, s.saldo) }))
    .sort((a, b) => Math.abs(b.betrag) - Math.abs(a.betrag) || a.konto.localeCompare(b.konto));
}
