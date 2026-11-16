import {
  ACCOUNTS,
  ASSET_ACCOUNTS,
  PRIVATE_USE_ACCOUNTS,
  type Cents,
  type Kontenrahmen,
  formatEuro,
  isKapitalgesellschaft,
  periodKey,
  type VatPeriod,
} from "@haben/core";
import { and, desc, gte, lt, ne, sql } from "drizzle-orm";
import { depreciationForEuer, listAssets, withdrawalsForEuer } from "../buchhaltung/index.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { versteuerungForYear } from "../stammdaten/index.ts";
import { bankZeilen } from "./abgleich-bank.ts";
import { belegZeilen } from "./abgleich-beleg.ts";
import { vorgangZeilen } from "./abgleich-vorgang.ts";
import { belegVorsteuerHinweis, journalBuchungen, verprobungsZeilen, type JournalBuchung } from "./abgleich-verprobung.ts";
import { gewinnNachDatevFormel } from "./euer-formel.ts";
import { euerAusJournal } from "./euer-journal.ts";
import { euerForYear } from "./reports.ts";
import { gesendeteAbweichungen, type PreflightIssue } from "../umsatzsteuer/index.ts";
import { oposAbgleichJahr, oposYears } from "./opos-abgleich.ts";

/*
 * Abgleich im Journal (#81, #1116). Voranmeldung und EÜR rechnen aus dem Journal; statt sie ein zweites Mal aus den
 * Nebenbüchern zu rechnen, prüft der Abgleich gespeicherte Daten gegen das Journal und das Journal in sich:
 * - Umsatzsteuer-Verprobung: je Buchung die Steuer gegen Bemessungsgrundlage mal Satz (abgleich-verprobung.ts);
 * - gesendete Voranmeldungen: die Werte in vat_returns gegen die Rechnung aus dem Journal (umsatzsteuer/gesendet-pruefen.ts);
 * - Beleg gegen Buchung: Steuerzeilen festgeschriebener Rechnungen gegen ihre Buchung (abgleich-beleg.ts); jeder gespeicherte
 *   Vorgang (Beleg, Zuordnung, Kassenbuch, Pauschale) gegen seine Buchung, bei Ist die nicht fällige Umsatzsteuer erledigter
 *   Rechnungen (abgleich-vorgang.ts);
 * - Bank: Endsaldo des letzten Kontoauszugs gegen die gebuchten Zahlungen (abgleich-bank.ts);
 * - EÜR: AfA und Privatnutzung gegen das Anlagenverzeichnis, der Gewinn nach der DATEV-Formel gegen den Gewinn der Zeilen;
 * - OPOS-Abgleich der Anzahlungsbestände (opos-abgleich.ts).
 * Eine Abweichung heißt: eine Buchung passt nicht zu ihrem Beleg oder zur gesendeten Anmeldung, oder Daten wurden an Haben
 * vorbei geändert. Befunde, die beim Update ausdrücklich übernommen wurden (journal_umstellung), meldet der Abgleich
 * nicht wieder; neue Abweichungen im selben Jahr schon.
 */

export interface AbgleichZeile {
  bereich: "ustva" | "euer" | "opos" | "beleg" | "bank";
  /** JJJJ-MM für die Voranmeldung und Belege, JJJJ für die EÜR, JJJJ-MM-TT für den OPOS-Stichtag und den Kontoauszug */
  zeitraum: string;
  posten: string;
  journal: Cents;
  /** Der Vergleichswert, benannt in `gegen` */
  quelle: Cents;
  /** Wogegen verglichen wird, z. B. „erwartet“, „gesendet“, „laut Rechnung“ */
  gegen: string;
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
  debit: number;
  credit: number;
}

/** Soll und Haben je Kontenrahmen, Herkunft und Konto im Zeitraum, ohne Eröffnungen */
async function journalSums(from: string, to: string, q: Db | Tx = db): Promise<Summe[]> {
  const e = schema.journalEntries;
  const l = schema.journalLines;
  const rows = await q
    .select({
      kontenrahmen: e.kontenrahmen,
      sourceType: e.sourceType,
      account: l.account,
      debit: sql<string>`sum(${l.debit})`,
      credit: sql<string>`sum(${l.credit})`,
    })
    .from(l)
    .innerJoin(e, sql`${e.id} = ${l.entryId}`)
    .where(and(gte(e.date, from), lt(e.date, to), ne(e.sourceType, "eroeffnung")))
    .groupBy(e.kontenrahmen, e.sourceType, l.account);
  return rows.map((r) => ({ ...r, kontenrahmen: r.kontenrahmen as Kontenrahmen, debit: Number(r.debit), credit: Number(r.credit) }));
}

/** Saldo Soll − Haben der Zeilen, deren Konto im jeweiligen Kontenrahmen zu `accounts` gehört */
function saldo(sums: Summe[], accounts: (kr: Kontenrahmen) => string[], filter: (s: Summe) => boolean = () => true): Cents {
  return sums.filter((s) => filter(s) && accounts(s.kontenrahmen).includes(s.account)).reduce((sum, s) => sum + s.debit - s.credit, 0);
}

const yearRange = (year: number) => ({ from: `${year}-01-01`, to: `${year + 1}-01-01` });

/** Text einer Abweichung, wie ihn die Prüfung beim Update als Befund speichert (journal_umstellung.befunde) */
export const befundText = (z: AbgleichZeile) => `${z.zeitraum} ${z.posten}: im Journal ${formatEuro(z.journal)}, ${z.gegen} ${formatEuro(z.quelle)}`;

/** Ohne den Zeitraum vorn: Die Vorprüfung eines Quartals nennt dieselbe Buchung mit dem Quartal statt dem Monat */
const ohneZeitraum = (text: string) => text.slice(text.indexOf(" ") + 1);

/** Je Jahr die Befunde, die beim Update auf das Journal ausdrücklich übernommen wurden (#1116), ohne Zeitraum */
export type Uebernommen = Map<number, Set<string>>;

async function uebernommeneBefunde(q: Db | Tx): Promise<Uebernommen> {
  const [stand] = await q.select().from(schema.journalUmstellung).orderBy(desc(schema.journalUmstellung.id)).limit(1);
  const result: Uebernommen = new Map();
  if (stand?.ergebnis !== "uebernommen") return result;
  for (const b of stand.befunde) result.set(b.jahr, (result.get(b.jahr) ?? new Set()).add(ohneZeitraum(b.text)));
  return result;
}

/**
 * Ohne die übernommenen Befunde des Jahres (Vorschlag von thomas-baumeister in #1144): Sie meldet der Abgleich nicht jede
 * Woche wieder, jede neue Abweichung schon. Der Hinweis nennt, wie viele ausgeblendet sind.
 */
function ohneUebernommene(year: number, abgleich: Abgleich, uebernommen: Uebernommen): Abgleich {
  const texte = uebernommen.get(year);
  if (!texte) return abgleich;
  const zeilen = abgleich.zeilen.filter((z) => z.journal === z.quelle || !texte.has(ohneZeitraum(befundText(z))));
  const n = texte.size;
  return {
    zeilen,
    hinweise: [
      `Für ${year} sind beim Update auf das Journal ${n} ${n === 1 ? "Abweichung" : "Abweichungen"} übernommen worden; der Abgleich meldet sie nicht mehr, neue Abweichungen schon.`,
      ...abgleich.hinweise,
    ],
  };
}

/** Verprobung eines Zeitraums: Abweichungen im Journal als Zeilen, die Vorsteuer eines Belegs als Hinweis */
function vatRows(period: VatPeriod, buchungen: readonly JournalBuchung[], versteuerung: "ist" | "soll"): Abgleich {
  const alle = verprobungsZeilen(period, buchungen, versteuerung);
  return {
    zeilen: alle
      .filter((z) => !z.beleg)
      .map((z) => ({
        bereich: "ustva",
        zeitraum: periodKey(period),
        posten: z.posten,
        journal: z.journal,
        quelle: z.erwartet,
        gegen: "aus der Bemessungsgrundlage",
      })),
    hinweise: alle.filter((z) => z.beleg).map(belegVorsteuerHinweis),
  };
}

/** Abgleich für einen Zeitraum der Voranmeldung (Monat oder Quartal), z. B. in der Vorprüfung vor dem Senden */
export async function vatAbgleich(period: VatPeriod): Promise<Abgleich> {
  const { from, to } = yearRange(period.year);
  const abgleich = vatRows(period, await journalBuchungen(from, to), await versteuerungForYear(period.year));
  return ohneUebernommene(period.year, abgleich, await uebernommeneBefunde(db));
}

/** Abgleich für die EÜR eines Jahres: AfA und Privatnutzung, Gewinn nach der DATEV-Formel */
export async function euerAbgleich(year: number, q: Db | Tx = db): Promise<Abgleich> {
  const { from, to } = yearRange(year);
  const sums = await journalSums(from, to, q);
  const zeitraum = String(year);
  const row = (posten: string, journal: Cents, quelle: Cents, gegen = "laut Anlagenverzeichnis"): AbgleichZeile => ({
    bereich: "euer",
    zeitraum,
    posten,
    journal,
    quelle,
    gegen,
  });
  const zeilen: AbgleichZeile[] = [];
  const hinweise: string[] = [];
  const [firma] = await q.select({ rechtsform: schema.company.rechtsform }).from(schema.company).limit(1);
  // Nur im Einzelunternehmen: GmbH und UG bilanzieren und machen keine EÜR
  const euerAusDemJournal = !firma || !isKapitalgesellschaft(firma.rechtsform);
  const ausJournal = euerAusDemJournal ? await euerAusJournal(year, q) : null;
  if (ausJournal && ausJournal.ungeklaerteImporte > 0)
    hinweise.push(
      `${ausJournal.ungeklaerteImporte} Import-Buchungen auf Forderungen oder Verbindlichkeiten haben keinen Zahlungsbezug. Vor der EÜR die Quellzuordnung prüfen; daraus werden keine Einnahmen oder Ausgaben geschätzt.`,
    );

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
      row("Umsatzsteuer auf die private Kfz-Nutzung", -saldo(sums, (kr) => [ACCOUNTS[kr].ust[1900]], anlage), privat.ustEntnahmen),
    );
    // Gegenprobe (#542): der Gewinn nach der DATEV-Formel aus Erfolgs- und Steuerkonten, Forderungen und Verbindlichkeiten;
    // erst, wenn AfA und Privatnutzung gebucht sind, denn die EÜR rechnet sie aus dem Anlagenverzeichnis
    if (ausJournal) {
      const nichtAbziehbar = ausJournal.summe.bewirtungNichtAbziehbar + ausJournal.summe.gewerbesteuerNichtAbziehbar;
      zeilen.push(
        row(
          "EÜR: Gewinn nach der DATEV-Formel",
          await gewinnNachDatevFormel(year, nichtAbziehbar, q),
          (await euerForYear(year, q)).gewinn,
          "aus den Zeilen der EÜR",
        ),
      );
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
 * Ein Jahr: Verprobung je Monat (bis zum laufenden), gesendete Voranmeldungen, Rechnungen gegen ihre Buchung, EÜR und
 * Anzahlungsbestände
 */
export async function abgleichJahr(year: number, today: string, q: Db | Tx = db, uebernommen?: Uebernommen): Promise<Abgleich> {
  const { from, to } = yearRange(year);
  const zeilen: AbgleichZeile[] = [];
  const hinweise: string[] = [];
  const buchungen = await journalBuchungen(from, to, q);
  const versteuerung = await versteuerungForYear(year, q);
  const lastMonth = year < Number(today.slice(0, 4)) ? 12 : Number(today.slice(5, 7));
  for (let month = 1; month <= lastMonth; month++) {
    const verprobung = vatRows({ year, month }, buchungen, versteuerung);
    zeilen.push(...verprobung.zeilen);
    hinweise.push(...verprobung.hinweise);
  }
  for (const a of await gesendeteAbweichungen([year], q))
    zeilen.push({
      bereich: "ustva",
      zeitraum: periodKey(a.period),
      posten: `Gesendete Voranmeldung, ${a.feld}`,
      journal: a.journal,
      quelle: a.gesendet,
      gegen: "gesendet",
    });
  for (const b of await belegZeilen(year, q))
    zeilen.push({ bereich: "beleg", zeitraum: b.zeitraum, posten: b.posten, journal: b.journal, quelle: b.rechnung, gegen: "laut Rechnung" });
  for (const v of await vorgangZeilen(year, q))
    zeilen.push({ bereich: "beleg", zeitraum: v.zeitraum, posten: v.posten, journal: v.journal, quelle: v.vorgang, gegen: "laut Vorgang" });
  const euer = await euerAbgleich(year, q);
  const opos = await oposAbgleichJahr(year, today, q);
  const jahr = { zeilen: [...zeilen, ...euer.zeilen, ...opos.zeilen], hinweise: [...hinweise, ...euer.hinweise, ...opos.hinweise] };
  return ohneUebernommene(year, jahr, uebernommen ?? (await uebernommeneBefunde(q)));
}

/**
 * Jahre mit Buchungen und neue Anzahlungsverfahren ohne Journal, dazu die Bankkonten. Für die Integritätsprüfung.
 * Liest in vielen Abfragen nacheinander; damit eine Buchung nebenher nicht nur auf einer Seite erscheint, läuft das
 * in einer Transaktion mit festem Stand (REPEATABLE READ, siehe checkIntegrity).
 */
export async function abgleichAll(today: string, q: Db | Tx = db): Promise<Abgleich> {
  const zeilen: AbgleichZeile[] = [];
  const hinweise: string[] = [];
  const journal = new Set(await journalYears(q));
  const uebernommen = await uebernommeneBefunde(q);
  const years = [...new Set([...journal, ...(await oposYears(today, q))])].sort((a, b) => a - b);
  for (const year of years) {
    // Ohne Journal nur den lesenden OPOS-Weg: EÜR-/Anlagenleser könnten sonst fehlende Firmendaten erst anlegen.
    const jahr = journal.has(year) ? await abgleichJahr(year, today, q, uebernommen) : await oposAbgleichJahr(year, today, q);
    zeilen.push(...jahr.zeilen);
    hinweise.push(...jahr.hinweise);
  }
  for (const b of await bankZeilen(q))
    zeilen.push({ bereich: "bank", zeitraum: b.zeitraum, posten: b.posten, journal: b.journal, quelle: b.auszug, gegen: "laut Kontoauszug" });
  return { zeilen, hinweise };
}

/** Abweichungen und Hinweise des Abgleichs als Meldungen für die Vorprüfung der Voranmeldung */
export function abgleichIssues({ zeilen, hinweise }: Abgleich): PreflightIssue[] {
  return [
    ...abweichungen(zeilen.filter((z) => z.bereich === "ustva")).map(
      (z): PreflightIssue => ({
        tone: "warn",
        text: `Im Journal passt etwas nicht: ${z.posten}, gebucht ${formatEuro(z.journal)}, ${z.gegen} ${formatEuro(z.quelle)}. Bitte vor dem Senden klären.`,
        link: "/konten",
      }),
    ),
    ...hinweise.map((text): PreflightIssue => ({ tone: "info", text, link: "/konten" })),
  ];
}
