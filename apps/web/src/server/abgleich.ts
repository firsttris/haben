import {
  ACCOUNTS,
  ASSET_ACCOUNTS,
  PAUSCHALE_KONTEN,
  PAUSCHALE_LABEL,
  PRIVATE_USE_ACCOUNTS,
  type Cents,
  type Kontenrahmen,
  type PauschaleArt,
  formatEuro,
  type VatPeriod,
} from "@haben/core";
import { and, gte, lt, sql } from "drizzle-orm";
import { depreciationForEuer, listAssets, withdrawalsForEuer } from "./assets.ts";
import { db, schema } from "./db/index.ts";
import { euerForYear } from "./reports.ts";
import { computeVatFigures, type PreflightIssue } from "./vat-figures.ts";

/*
 * Abgleich Journal ↔ Umsatzsteuer und EÜR (#81). Voranmeldung und EÜR rechnen aus Rechnungen, Belegen, Zuordnungen,
 * Pauschalen und dem Anlagenverzeichnis; das Journal bucht dieselben Vorgänge getrennt davon. Beides muss übereinstimmen.
 * Eine Abweichung heißt: eine der beiden Rechnungen ist falsch, oder Daten wurden an Haben vorbei geändert.
 *
 * Verglichen wird, was sich im Journal eindeutig wiederfindet:
 * - Umsatzsteuer: je Monat die Steuerkonten gegen die Kennzahlen der Voranmeldung, ohne Privatnutzung von Fahrzeugen
 *   (deren Umsatzsteuer bucht erst die AfA im Dezember; sie wird mit der EÜR verglichen, sobald das Jahr gebucht ist).
 * - EÜR: Pauschalen, Umsatzsteuer-Vorauszahlungen und Erstattungen, AfA und Privatnutzung. Einnahmen und Ausgaben
 *   stehen in der EÜR nach Zahlung, im Journal nach Rechnungs- bzw. Belegdatum; sie lassen sich nicht 1:1 vergleichen.
 */

export interface AbgleichZeile {
  bereich: "ustva" | "euer";
  /** JJJJ-MM für die Voranmeldung, JJJJ für die EÜR */
  zeitraum: string;
  posten: string;
  journal: Cents;
  quelle: Cents;
}

export interface Abgleich {
  zeilen: AbgleichZeile[];
  /** Was nicht verglichen wurde und warum */
  hinweise: string[];
}

export const abweichungen = (zeilen: AbgleichZeile[]) => zeilen.filter((z) => z.journal !== z.quelle);

type SourceType = (typeof schema.journalEntries.$inferSelect)["sourceType"];

interface Summe {
  kontenrahmen: Kontenrahmen;
  sourceType: SourceType;
  account: string;
  month: number;
  debit: number;
  credit: number;
}

/** Soll und Haben je Kontenrahmen, Herkunft, Konto und Monat im Zeitraum */
async function journalSums(from: string, to: string): Promise<Summe[]> {
  const e = schema.journalEntries;
  const l = schema.journalLines;
  const rows = await db
    .select({
      kontenrahmen: e.kontenrahmen,
      sourceType: e.sourceType,
      account: l.account,
      month: sql<number>`extract(month from ${e.date})::int`,
      debit: sql<string>`sum(${l.debit})`,
      credit: sql<string>`sum(${l.credit})`,
    })
    .from(l)
    .innerJoin(e, sql`${e.id} = ${l.entryId}`)
    .where(and(gte(e.date, from), lt(e.date, to)))
    .groupBy(e.kontenrahmen, e.sourceType, l.account, sql`extract(month from ${e.date})`);
  return rows.map((r) => ({ ...r, kontenrahmen: r.kontenrahmen as Kontenrahmen, month: Number(r.month), debit: Number(r.debit), credit: Number(r.credit) }));
}

/** Saldo Soll − Haben der Zeilen, deren Konto im jeweiligen Kontenrahmen zu `accounts` gehört */
function saldo(sums: Summe[], accounts: (kr: Kontenrahmen) => string[], filter: (s: Summe) => boolean = () => true): Cents {
  return sums.filter((s) => filter(s) && accounts(s.kontenrahmen).includes(s.account)).reduce((sum, s) => sum + s.debit - s.credit, 0);
}

const ust = (rate: 1900 | 700) => (kr: Kontenrahmen) => [ACCOUNTS[kr].ust[rate]];

/** Umsatzsteuer eines Monats: Steuerkonten im Journal gegen die Kennzahlen aus den Nebenbüchern */
function vatRows(period: VatPeriod, sums: Summe[], figures: Awaited<ReturnType<typeof computeVatFigures>>): AbgleichZeile[] {
  const zeitraum = `${period.year}-${String(period.month).padStart(2, "0")}`;
  const monat = sums.filter((s) => s.month === period.month);
  // Privatnutzung von Fahrzeugen: in der Voranmeldung monatlich, im Journal erst mit der AfA gebucht (siehe oben)
  const keinAnlagenbuch = (s: Summe) => s.sourceType !== "asset";
  const entnahme = figures.revenue.filter((r) => r.type === "entnahme").reduce((sum, r) => sum + r.tax, 0);
  const row = (posten: string, journal: Cents, quelle: Cents): AbgleichZeile => ({ bereich: "ustva", zeitraum, posten, journal, quelle });
  return [
    row("Umsatzsteuer 19 % (Kz 81)", -saldo(monat, ust(1900), keinAnlagenbuch), figures.tax81 - entnahme),
    row("Umsatzsteuer 7 % (Kz 86)", -saldo(monat, ust(700), keinAnlagenbuch), figures.tax86),
    row("Umsatzsteuer § 13b (Kz 47, 85)", -saldo(monat, (kr) => [ACCOUNTS[kr].ustRc]), figures.kz47 + figures.kz85),
    row("Vorsteuer (Kz 66)", saldo(monat, (kr) => Object.values(ACCOUNTS[kr].vorsteuer)), figures.kz66),
    row("Vorsteuer § 13b (Kz 67)", saldo(monat, (kr) => [ACCOUNTS[kr].vorsteuerRc]), figures.kz67),
  ];
}

const yearRange = (year: number) => ({ from: `${year}-01-01`, to: `${year + 1}-01-01` });

/** Abgleich für einen Monat der Voranmeldung, z. B. in der Vorprüfung vor dem Senden */
export async function vatAbgleich(period: VatPeriod): Promise<Abgleich> {
  const { from, to } = yearRange(period.year);
  const sums = await journalSums(from, to);
  return { zeilen: vatRows(period, sums, await computeVatFigures(period)), hinweise: [] };
}

/** Abgleich für die EÜR eines Jahres */
export async function euerAbgleich(year: number): Promise<Abgleich> {
  const { from, to } = yearRange(year);
  const sums = await journalSums(from, to);
  const euer = await euerForYear(year);
  const line = (key: string) => [...euer.einnahmen, ...euer.ausgaben].find((l) => l.key === key)?.amount ?? 0;
  const zeitraum = String(year);
  const row = (posten: string, journal: Cents, quelle: Cents): AbgleichZeile => ({ bereich: "euer", zeitraum, posten, journal, quelle });
  const zeilen: AbgleichZeile[] = [];
  const hinweise: string[] = [];

  // Pauschalen je Art, jede hat ihr eigenes Aufwandskonto
  for (const art of Object.keys(PAUSCHALE_KONTEN) as PauschaleArt[]) {
    const journal = saldo(sums, (kr) => [PAUSCHALE_KONTEN[art][kr].konto], (s) => s.sourceType === "pauschale");
    const quelle = line(`pauschale:${art}`);
    if (journal !== 0 || quelle !== 0) zeilen.push(row(`Pauschale: ${PAUSCHALE_LABEL[art]}`, journal, quelle));
  }

  zeilen.push(
    row(
      "Umsatzsteuer an das Finanzamt, abzüglich Erstattungen",
      saldo(sums, (kr) => [ACCOUNTS[kr].ustVorauszahlung], (s) => s.sourceType === "allocation"),
      line("gezahlteUst") - line("erstatteteUst"),
    ),
  );

  // AfA und Privatnutzung stehen erst im Journal, wenn das Jahr gebucht ist
  const pending = (await listAssets(year)).filter((a) => a.pending).length;
  if (pending > 0) {
    hinweise.push(`AfA ${year} ist für ${pending === 1 ? "eine Anlage" : `${pending} Anlagen`} noch nicht gebucht; AfA und Privatnutzung werden danach abgeglichen.`);
  } else {
    const afa = await depreciationForEuer(year);
    const privat = await withdrawalsForEuer(year);
    const anlage = (s: Summe) => s.sourceType === "asset";
    zeilen.push(
      row("AfA", saldo(sums, (kr) => [ASSET_ACCOUNTS[kr].afa, ASSET_ACCOUNTS[kr].afaKfz], anlage), afa.afa),
      row("Sofortabschreibung GWG", saldo(sums, (kr) => [ASSET_ACCOUNTS[kr].afaGwg], anlage), afa.gwg),
      row("Auflösung Sammelposten", saldo(sums, (kr) => [ASSET_ACCOUNTS[kr].afaSammelposten], anlage), afa.sammelposten),
      row("Restbuchwert ausgeschiedener Anlagen", saldo(sums, (kr) => [ASSET_ACCOUNTS[kr].restbuchwert], anlage), afa.restbuchwert),
      row("Private Kfz-Nutzung", -saldo(sums, (kr) => Object.values(PRIVATE_USE_ACCOUNTS[kr]), anlage), privat.privateKfz),
      row("Umsatzsteuer auf die private Kfz-Nutzung", -saldo(sums, ust(1900), anlage), privat.ustEntnahmen),
    );
  }
  return { zeilen, hinweise };
}

/** Jahre mit Buchungen, älteste zuerst */
async function journalYears(): Promise<number[]> {
  const rows = await db
    .selectDistinct({ year: sql<number>`extract(year from ${schema.journalEntries.date})::int` })
    .from(schema.journalEntries)
    .orderBy(sql`1`);
  return rows.map((r) => Number(r.year));
}

/** Alle Jahre mit Buchungen: Umsatzsteuer je Monat (bis zum laufenden) und EÜR je Jahr. Für die Integritätsprüfung. */
export async function abgleichAll(today: string): Promise<Abgleich> {
  const zeilen: AbgleichZeile[] = [];
  const hinweise: string[] = [];
  const years = await journalYears();
  for (const year of years) {
    const { from, to } = yearRange(year);
    const sums = await journalSums(from, to);
    const lastMonth = year < Number(today.slice(0, 4)) ? 12 : Number(today.slice(5, 7));
    for (let month = 1; month <= lastMonth; month++) {
      // Auch Monate ohne Journal: die Nebenbücher dürfen dann keine Steuer haben
      zeilen.push(...vatRows({ year, month }, sums, await computeVatFigures({ year, month })));
    }
    const euer = await euerAbgleich(year);
    zeilen.push(...euer.zeilen);
    hinweise.push(...euer.hinweise);
  }
  return { zeilen, hinweise };
}

/** Abweichungen und Hinweise des Abgleichs als Meldungen für die Vorprüfung der Voranmeldung */
export function abgleichIssues({ zeilen, hinweise }: Abgleich): PreflightIssue[] {
  return [
    ...abweichungen(zeilen).map((z): PreflightIssue => ({
      tone: "warn",
      text: `Buchungen und Voranmeldung weichen ab: ${z.posten} laut Journal ${formatEuro(z.journal)}, laut Rechnungen, Belegen und Zahlungen ${formatEuro(z.quelle)}. Bitte vor dem Senden klären.`,
      link: "/konten",
    })),
    ...hinweise.map((text): PreflightIssue => ({ tone: "info", text, link: "/konten" })),
  ];
}
