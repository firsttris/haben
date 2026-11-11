import {
  ACCOUNTS,
  ASSET_ACCOUNTS,
  PAUSCHALE_KONTEN,
  PAUSCHALE_LABEL,
  PRIVATE_USE_ACCOUNTS,
  EXPENSE_CATEGORIES,
  STEUER_KONTEN,
  DARLEHEN_KONTEN,
  abziehbareNebenleistungen,
  nichtAbziehbareNebenleistungen,
  EUER_LABELS,
  type Cents,
  type EuerLineKey,
  type Kontenrahmen,
  type PauschaleArt,
  formatEuro,
  isKapitalgesellschaft,
  monthsOfPeriod,
  periodKey,
  type VatPeriod,
} from "@haben/core";
import { and, gte, lt, ne, sql } from "drizzle-orm";
import { depreciationForEuer, listAssets, withdrawalsForEuer } from "../buchhaltung/index.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { bemessungsZeilen, journalBuchungen, type JournalBuchung } from "./abgleich-kennzahlen.ts";
import { gewinnNachDatevFormel } from "./euer-formel.ts";
import { verschobeneBuchungen } from "./euer-jahreswechsel.ts";
import type { Buchung } from "./euer-journal-buchungen.ts";
import { euerAusJournal } from "./euer-journal.ts";
import { euerAusNebenbuechern } from "./reports.ts";
import { computeVatFigures, type PreflightIssue } from "../umsatzsteuer/index.ts";

/*
 * Abgleich Journal ↔ Umsatzsteuer und EÜR (#81). Voranmeldung und EÜR rechnen aus Rechnungen, Belegen, Zuordnungen,
 * Pauschalen und dem Anlagenverzeichnis; das Journal bucht dieselben Vorgänge getrennt davon. Beides muss übereinstimmen.
 * Eine Abweichung heißt: eine der beiden Rechnungen ist falsch, oder Daten wurden an Haben vorbei geändert.
 *
 * Verglichen wird, was sich im Journal eindeutig wiederfindet:
 * - Umsatzsteuer: je Monat die Steuerkonten gegen die Kennzahlen der Voranmeldung, ohne Privatnutzung von Fahrzeugen
 *   (deren Umsatzsteuer bucht erst die AfA im Dezember; sie wird mit der EÜR verglichen, sobald das Jahr gebucht ist).
 * - EÜR: Pauschalen, Umsatzsteuer-Vorauszahlungen und Erstattungen, AfA und Privatnutzung; Einnahmen, Umsatzsteuer,
 *   Vorsteuer, Personal und Ausgaben je Kategorie nach Zahlung aus dem Journal (euer-journal.ts, #542): Jede Zahlung wird
 *   anteilig auf die Rechnung bzw. den Beleg verteilt, die sie ausgleicht. Ausnahme: Zahlungen auf aus Lexoffice
 *   übernommene Rechnungen und Belege, deren Buchung keine Erlös- und Aufwandszeilen hat.
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

/**
 * Soll und Haben je Kontenrahmen, Herkunft, Konto und Monat im Zeitraum. Ohne Eröffnungen: Was die Eröffnung aus dem
 * DATEV-Stapel auf Umsatz- und Vorsteuer vorträgt, ist im Vorjahr angemeldet und gehört nicht zur Voranmeldung im Januar.
 */
async function journalSums(from: string, to: string, q: Db | Tx = db): Promise<Summe[]> {
  const e = schema.journalEntries;
  const l = schema.journalLines;
  const rows = await q
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
    .where(and(gte(e.date, from), lt(e.date, to), ne(e.sourceType, "eroeffnung")))
    .groupBy(e.kontenrahmen, e.sourceType, l.account, sql`extract(month from ${e.date})`);
  return rows.map((r) => ({ ...r, kontenrahmen: r.kontenrahmen as Kontenrahmen, month: Number(r.month), debit: Number(r.debit), credit: Number(r.credit) }));
}

/** Saldo Soll − Haben der Zeilen, deren Konto im jeweiligen Kontenrahmen zu `accounts` gehört */
function saldo(sums: Summe[], accounts: (kr: Kontenrahmen) => string[], filter: (s: Summe) => boolean = () => true): Cents {
  return sums.filter((s) => filter(s) && accounts(s.kontenrahmen).includes(s.account)).reduce((sum, s) => sum + s.debit - s.credit, 0);
}

const ust = (rate: 1900 | 700) => (kr: Kontenrahmen) => [ACCOUNTS[kr].ust[rate]];

/**
 * Umsatzsteuer eines Monats oder Quartals: Steuerkonten im Journal gegen die Kennzahlen aus den Nebenbüchern, dazu die
 * Bemessungsgrundlagen aus Konto und Steuerschlüssel (abgleich-kennzahlen.ts), soweit nicht null
 */
function vatRows(
  period: VatPeriod,
  sums: Summe[],
  buchungen: readonly JournalBuchung[],
  voranmeldung: Awaited<ReturnType<typeof computeVatFigures>>,
): AbgleichZeile[] {
  // Ab dem Stichjahr sind die Kennzahlen der Voranmeldung die aus dem Journal; verglichen wird dann mit den Nebenbüchern
  // als Gegenprobe (#542, docs/adr/journal-als-quelle.md)
  const figures = voranmeldung.nebenbuecher ? { ...voranmeldung, ...voranmeldung.nebenbuecher } : voranmeldung;
  const zeitraum = periodKey(period);
  const months = new Set(monthsOfPeriod(period).map((m) => m.month));
  const monat = sums.filter((s) => months.has(s.month));
  // Privatnutzung von Fahrzeugen: in der Voranmeldung monatlich, im Journal erst mit der AfA gebucht (siehe oben)
  const keinAnlagenbuch = (s: Summe) => s.sourceType !== "asset";
  const entnahme = figures.revenue.filter((r) => r.type === "entnahme").reduce((sum, r) => sum + r.tax, 0);
  const row = (posten: string, journal: Cents, quelle: Cents): AbgleichZeile => ({ bereich: "ustva", zeitraum, posten, journal, quelle });
  return [
    row("Umsatzsteuer 19 % (Kz 81)", -saldo(monat, ust(1900), keinAnlagenbuch), figures.tax81 - entnahme),
    row("Umsatzsteuer 7 % (Kz 86)", -saldo(monat, ust(700), keinAnlagenbuch), figures.tax86),
    row("Umsatzsteuer § 13b (Kz 47, 85)", -saldo(monat, (kr) => [ACCOUNTS[kr].ustRc]), figures.kz47 + figures.kz85),
    row(
      "Vorsteuer (Kz 66)",
      saldo(monat, (kr) => Object.values(ACCOUNTS[kr].vorsteuer)),
      figures.kz66,
    ),
    row(
      "Vorsteuer § 13b (Kz 67)",
      saldo(monat, (kr) => [ACCOUNTS[kr].vorsteuerRc]),
      figures.kz67,
    ),
    row("Erwerbsteuer (Kz 89, 93)", -saldo(monat, (kr) => Object.values(ACCOUNTS[kr].ustIge)), figures.tax89 + figures.tax93),
    row(
      "Einfuhrumsatzsteuer (Kz 62)",
      saldo(monat, (kr) => [EXPENSE_CATEGORIES.einfuhrumsatzsteuer[kr]]),
      figures.kz62,
    ),
    row(
      "Vorsteuer aus innergemeinschaftlichem Erwerb (Kz 61)",
      saldo(monat, (kr) => Object.values(ACCOUNTS[kr].vorsteuerIge)),
      figures.kz61,
    ),
    ...bemessungsZeilen(period, buchungen, figures)
      .filter((z) => z.journal !== 0 || z.quelle !== 0)
      .map((z) => row(z.posten, z.journal, z.quelle)),
  ];
}

/** Zeilen der EÜR nach Zahlung, die nur der Abgleich aus dem Journal prüft (dazu die Ausgaben je Kategorie) */
const NACH_ZAHLUNG: EuerLineKey[] = [
  "einnahmenKleinunternehmer",
  "einnahmenSteuerpflichtig",
  "einnahmenSteuerfrei",
  "vereinnahmteUst",
  "vorsteuer",
  "personal",
];

const yearRange = (year: number) => ({ from: `${year}-01-01`, to: `${year + 1}-01-01` });

/** Abgleich für einen Zeitraum der Voranmeldung (Monat oder Quartal), z. B. in der Vorprüfung vor dem Senden */
export async function vatAbgleich(period: VatPeriod): Promise<Abgleich> {
  const { from, to } = yearRange(period.year);
  const [sums, buchungen] = await Promise.all([journalSums(from, to), journalBuchungen(from, to)]);
  return { zeilen: vatRows(period, sums, buchungen, await computeVatFigures(period)), hinweise: [] };
}

/** Abgleich für die EÜR eines Jahres */
export async function euerAbgleich(year: number, q: Db | Tx = db): Promise<Abgleich> {
  const { from, to } = yearRange(year);
  // Wie die EÜR: Vorauszahlung für Dezember bzw. das vierte Quartal vom 1. bis 10. Januar im Vorjahr (euer-jahreswechsel.ts)
  const { herein, hinaus } = await verschobeneBuchungen(year, q);
  const verschoben = (b: Buchung, vorzeichen: 1 | -1): Summe[] =>
    b.zeilen.map((z) => ({
      kontenrahmen: b.kontenrahmen,
      sourceType: "allocation",
      account: z.account,
      month: Number(b.date.slice(5, 7)),
      debit: vorzeichen * z.debit,
      credit: vorzeichen * z.credit,
    }));
  const sums = [...(await journalSums(from, to, q)), ...herein.flatMap((b) => verschoben(b, 1)), ...hinaus.flatMap((b) => verschoben(b, -1))];
  // Gegenprobe ist immer die Rechnung aus den Nebenbüchern; ab dem Stichjahr ist euerForYear die aus dem Journal (#542)
  const euer = await euerAusNebenbuechern(year, q);
  // Gezahlt über die Bank oder, im Einzelunternehmen, privat als freie Buchung (#502); die Gegenprobe zählt freie Buchungen
  // ebenso (mitFreienBuchungen). Manuelle Buchungen einer GmbH oder UG sind Abschlussbuchungen (etwa Rückstellungen), keine
  // Zahlung, und die Gegenprobe zählt sie dort nicht
  const [rechtsform] = await q.select({ rechtsform: schema.company.rechtsform }).from(schema.company).limit(1);
  const freieZaehlen = !rechtsform || !isKapitalgesellschaft(rechtsform.rechtsform);
  const zahlung = (s: Summe) => s.sourceType === "allocation" || (freieZaehlen && s.sourceType === "manuell");
  const line = (key: string) => [...euer.einnahmen, ...euer.ausgaben].find((l) => l.key === key)?.amount ?? 0;
  const zeitraum = String(year);
  const row = (posten: string, journal: Cents, quelle: Cents): AbgleichZeile => ({ bereich: "euer", zeitraum, posten, journal, quelle });
  const zeilen: AbgleichZeile[] = [];
  const hinweise: string[] = [];

  // Pauschalen je Art, jede hat ihr eigenes Aufwandskonto
  for (const art of Object.keys(PAUSCHALE_KONTEN) as PauschaleArt[]) {
    const journal = saldo(
      sums,
      (kr) => [PAUSCHALE_KONTEN[art][kr].konto],
      (s) => s.sourceType === "pauschale",
    );
    const quelle = line(`pauschale:${art}`);
    if (journal !== 0 || quelle !== 0) zeilen.push(row(`Pauschale: ${PAUSCHALE_LABEL[art]}`, journal, quelle));
  }

  zeilen.push(
    row(
      "Umsatzsteuer an das Finanzamt (mit Sondervorauszahlung), abzüglich Erstattungen",
      saldo(
        sums,
        // Mit der Umsatzsteuer früherer Jahre (Steuerzahlungen, steuerzahlung.ts): gezahlt bzw. erstattet im Jahr der Zahlung
        (kr) => [ACCOUNTS[kr].ustVorauszahlung, ACCOUNTS[kr].sondervorauszahlung, STEUER_KONTEN[kr].ustVorjahr, STEUER_KONTEN[kr].ustFruehereJahre],
        zahlung,
      ),
      line("gezahlteUst") - line("erstatteteUst"),
    ),
  );

  // Steuerzahlungen: Zinsen und Zuschläge zu betrieblichen Steuern als Ausgabe, Gewerbesteuer samt Nebenleistungen nur
  // nachrichtlich. Im Einzelunternehmen gibt es keine Körperschaftsteuer; die nicht abziehbaren Zinskonten bucht dort nur
  // die Gewerbesteuer, dazu Hinterziehungszinsen (§ 235 AO) zur Umsatzsteuer.

  const nebenleistungen = saldo(sums, (kr) => abziehbareNebenleistungen(kr), zahlung);
  if (nebenleistungen !== 0 || line("steuerNebenleistungen") !== 0) {
    zeilen.push(row("Zinsen und Zuschläge zu betrieblichen Steuern", nebenleistungen, line("steuerNebenleistungen")));
  }
  // Darlehen: Zinsen und Gebühren gegen die Schuldzinsen der EÜR
  const darlehen = saldo(
    sums,
    (kr) => [
      DARLEHEN_KONTEN[kr].zinsenKurzfristig,
      DARLEHEN_KONTEN[kr].zinsenLangfristig,
      DARLEHEN_KONTEN[kr].zinsenAnlagevermoegen,
      DARLEHEN_KONTEN[kr].gebuehren,
    ],
    zahlung,
  );
  const schuldzinsen = line("schuldzinsen") + line("schuldzinsenAnlage");
  if (darlehen !== 0 || schuldzinsen !== 0) zeilen.push(row("Schuldzinsen und Gebühren der Darlehen", darlehen, schuldzinsen));
  const gewerbesteuer = saldo(sums, (kr) => [STEUER_KONTEN[kr].gewst, STEUER_KONTEN[kr].gewstVorjahre, ...nichtAbziehbareNebenleistungen(kr)], zahlung);
  if (gewerbesteuer !== 0 || euer.gewerbesteuerNichtAbziehbar !== 0) {
    zeilen.push(row("Gewerbesteuer und Nebenleistungen darauf, Hinterziehungszinsen (nicht abziehbar)", gewerbesteuer, euer.gewerbesteuerNichtAbziehbar));
  }

  // Kursdifferenzen bei Fremdwährung: Aufwand und Ertrag aus Kursdifferenzen gegen die Posten der EÜR
  const kurs = saldo(sums, (kr) => [ACCOUNTS[kr].kursAufwand, ACCOUNTS[kr].kursErtrag]);
  const kursQuelle = line("kursverluste") - line("kursgewinne");
  if (kurs !== 0 || kursQuelle !== 0) zeilen.push(row("Kursdifferenzen (Aufwand abzüglich Ertrag)", kurs, kursQuelle));

  // Einnahmen und Ausgaben nach Zahlung, aus dem Journal mit jeder Zahlung anteilig auf die ausgeglichene Buchung. Nur im
  // Einzelunternehmen: GmbH und UG bilanzieren und machen keine EÜR; Körperschaftsteuer, Ergebnisverwendung und manuelle
  // Buchungen stehen dort auf Erfolgskonten, die die EÜR nicht kennt
  const [firma] = await q.select({ rechtsform: schema.company.rechtsform }).from(schema.company).limit(1);
  const euerAusDemJournal = !firma || !isKapitalgesellschaft(firma.rechtsform);
  const ausJournal = await euerAusJournal(year, q);
  if (euerAusDemJournal) {
    const label = (key: EuerLineKey) =>
      [...euer.einnahmen, ...euer.ausgaben].find((l) => l.key === key)?.label ??
      (key.startsWith("ausgabe:") ? EXPENSE_CATEGORIES[key.slice(8) as keyof typeof EXPENSE_CATEGORIES].label : EUER_LABELS[key as keyof typeof EUER_LABELS]);
    const journalZeile = (key: EuerLineKey) => ausJournal.summe.zeilen[key] ?? 0;
    const keys = new Set<EuerLineKey>([...NACH_ZAHLUNG]);
    for (const key of [...Object.keys(ausJournal.summe.zeilen), ...euer.ausgaben.map((l) => l.key)] as EuerLineKey[]) {
      if (key.startsWith("ausgabe:")) keys.add(key);
    }
    for (const key of keys) {
      if (journalZeile(key) !== 0 || line(key) !== 0) zeilen.push(row(`EÜR: ${label(key)}`, journalZeile(key), line(key)));
    }
    if (ausJournal.summe.bewirtungNichtAbziehbar !== 0 || euer.bewirtungNichtAbziehbar !== 0) {
      zeilen.push(row("EÜR: Bewirtung, nicht abziehbarer Teil", ausJournal.summe.bewirtungNichtAbziehbar, euer.bewirtungNichtAbziehbar));
    }
  }

  // AfA und Privatnutzung stehen erst im Journal, wenn das Jahr gebucht ist
  const pending = (await listAssets(year, q)).filter((a) => a.pending).length;
  if (pending > 0) {
    hinweise.push(
      `AfA ${year} ist für ${pending === 1 ? "eine Anlage" : `${pending} Anlagen`} noch nicht gebucht; AfA und Privatnutzung werden danach abgeglichen.`,
    );
  } else {
    const afa = await depreciationForEuer(year, q);
    const privat = await withdrawalsForEuer(year, q);
    const anlage = (s: Summe) => s.sourceType === "asset";
    zeilen.push(
      row(
        "AfA",
        saldo(sums, (kr) => [ASSET_ACCOUNTS[kr].afa, ASSET_ACCOUNTS[kr].afaKfz], anlage),
        afa.afa,
      ),
      row(
        "Sofortabschreibung GWG",
        saldo(sums, (kr) => [ASSET_ACCOUNTS[kr].afaGwg], anlage),
        afa.gwg,
      ),
      row(
        "Auflösung Sammelposten",
        saldo(sums, (kr) => [ASSET_ACCOUNTS[kr].afaSammelposten], anlage),
        afa.sammelposten,
      ),
      row(
        "Restbuchwert ausgeschiedener Anlagen",
        saldo(sums, (kr) => [ASSET_ACCOUNTS[kr].restbuchwert], anlage),
        afa.restbuchwert,
      ),
      row("Private Kfz-Nutzung", -saldo(sums, (kr) => Object.values(PRIVATE_USE_ACCOUNTS[kr]), anlage), privat.privateKfz),
      row("Umsatzsteuer auf die private Kfz-Nutzung", -saldo(sums, ust(1900), anlage), privat.ustEntnahmen),
    );
    // Gegenprobe (#542): der Gewinn nach der DATEV-Formel aus Erfolgs- und Steuerkonten, Forderungen und Verbindlichkeiten;
    // erst, wenn AfA und Privatnutzung gebucht sind, denn die EÜR rechnet sie aus dem Anlagenverzeichnis
    if (euerAusDemJournal) {
      const nichtAbziehbar = ausJournal.summe.bewirtungNichtAbziehbar + ausJournal.summe.gewerbesteuerNichtAbziehbar;
      zeilen.push(row("EÜR: Gewinn nach der DATEV-Formel", await gewinnNachDatevFormel(year, nichtAbziehbar, q), euer.gewinn));
    }
  }
  return { zeilen, hinweise };
}

/** Jahre mit Buchungen, älteste zuerst */
async function journalYears(q: Db | Tx): Promise<number[]> {
  const rows = await q
    .selectDistinct({ year: sql<number>`extract(year from ${schema.journalEntries.date})::int` })
    .from(schema.journalEntries)
    .orderBy(sql`1`);
  return rows.map((r) => Number(r.year));
}

/**
 * Ein Jahr: Umsatzsteuer je Monat (bis zum laufenden) und EÜR. Auch Monate ohne Journal: die Nebenbücher dürfen dann
 * keine Steuer haben.
 */
export async function abgleichJahr(year: number, today: string, q: Db | Tx = db): Promise<Abgleich> {
  const { from, to } = yearRange(year);
  const sums = await journalSums(from, to, q);
  const buchungen = await journalBuchungen(from, to, q);
  const zeilen: AbgleichZeile[] = [];
  const lastMonth = year < Number(today.slice(0, 4)) ? 12 : Number(today.slice(5, 7));
  for (let month = 1; month <= lastMonth; month++) {
    zeilen.push(...vatRows({ year, month }, sums, buchungen, await computeVatFigures({ year, month }, q)));
  }
  const euer = await euerAbgleich(year, q);
  return { zeilen: [...zeilen, ...euer.zeilen], hinweise: euer.hinweise };
}

/**
 * Alle Jahre mit Buchungen (abgleichJahr). Für die Integritätsprüfung.
 * Liest in vielen Abfragen nacheinander; damit eine Buchung nebenher nicht nur auf einer Seite erscheint, läuft das
 * in einer Transaktion mit festem Stand (REPEATABLE READ, siehe checkIntegrity).
 */
export async function abgleichAll(today: string, q: Db | Tx = db): Promise<Abgleich> {
  const zeilen: AbgleichZeile[] = [];
  const hinweise: string[] = [];
  for (const year of await journalYears(q)) {
    const jahr = await abgleichJahr(year, today, q);
    zeilen.push(...jahr.zeilen);
    hinweise.push(...jahr.hinweise);
  }
  return { zeilen, hinweise };
}

/** Abweichungen und Hinweise des Abgleichs als Meldungen für die Vorprüfung der Voranmeldung */
export function abgleichIssues({ zeilen, hinweise }: Abgleich): PreflightIssue[] {
  return [
    ...abweichungen(zeilen).map(
      (z): PreflightIssue => ({
        tone: "warn",
        text: `Buchungen und Voranmeldung weichen ab: ${z.posten} laut Journal ${formatEuro(z.journal)}, laut Rechnungen, Belegen und Zahlungen ${formatEuro(z.quelle)}. Bitte vor dem Senden klären.`,
        link: "/konten",
      }),
    ),
    ...hinweise.map((text): PreflightIssue => ({ tone: "info", text, link: "/konten" })),
  ];
}
