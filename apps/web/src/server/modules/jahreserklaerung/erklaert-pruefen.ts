import type { Cents } from "@haben/core";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import type { AbgleichZeile } from "../auswertungen/index.ts";
import { gerechneteZahlen, zahlen } from "./gerechnete-zahlen.ts";
import { vermerkPruefung } from "./vermerk.ts";
import { vorauszahlungssoll, zuletztGesendet } from "./vorauszahlungen.ts";

/*
 * Übermittelte und vermerkte Jahreserklärungen gegen die Rechnung aus dem Journal (#1116), wie die gesendeten
 * Voranmeldungen (umsatzsteuer/gesendet-pruefen.ts): Was das Finanzamt hat, soll Haben heute genauso rechnen.
 * - Über Haben übermittelt: jede gespeicherte Zahl der Erklärung (annual_submissions.figures) gegen heute. Nicht
 *   verglichen werden die Vorauszahlungen der Umsatzsteuererklärung und die Abschlusszahlung daraus: Sie kommen aus den
 *   gesendeten Voranmeldungen und der Dauerfristverlängerung, nicht aus dem Journal.
 * - Außerhalb von Haben abgegeben (Vermerk): Der Vermerk hält den Betrag laut Protokoll fest, bei einer bestätigten
 *   Abweichung dazu den damals gerechneten Wert (vermerk.ts); seit #1144 auch alle gerechneten Zahlen (`gerechnet`), die
 *   dann wie bei einer Übermittlung verglichen werden. Verglichen wird der damals gerechnete Wert (ohne Abweichung
 *   der Betrag) mit dem, was der Vermerk heute rechnen würde (vermerkPruefung: Gewinn). Rechnet Haben heute den Betrag
 *   laut Protokoll, passt das Journal zur Abgabe. Bei älteren Vermerken der Umsatzsteuer ohne festgehaltene Zahlen
 *   zählt die Steuer, nicht die Abschlusszahlung: damals die Abschlusszahlung plus die Vorauszahlungen, die beim
 *   Vermerk gesendet waren (#1231). Eine danach gesendete Voranmeldung ändert sonst die Abschlusszahlung, nicht das Journal.
 * Die Einkommensteuer hat keine eigenen Zahlen aus dem Journal; sie folgt der EÜR.
 *
 * Läuft bei der Prüfung beim Update und jede Woche mit der Integritätsprüfung (erklaerteAbweichungsZeilen, übergeben von
 * scheduler.ts und functions/integrity.ts, weil jahreserklaerung über auswertungen steht). Eine Codeänderung an der
 * Zuordnung einer EÜR-Zeile, die keine Voranmeldung berührt, fiele sonst nirgends auf (thomas-baumeister in #1144).
 */

export interface ErklaertAbweichung {
  year: number;
  form: "ust" | "euer";
  art: "übermittelt" | "vermerkt";
  feld: string;
  erklaert: Cents;
  journal: Cents;
}

const NICHT_AUS_DEM_JOURNAL = new Set(["vorauszahlungen", "abschluss"]);

/** Felder, die festgehalten anders sind als heute gerechnet, ohne `ausser` */
function vergleich(gespeichert: Record<string, number>, heute: Record<string, number>, ausser: ReadonlySet<string>) {
  return [...new Set([...Object.keys(gespeichert), ...Object.keys(heute)])]
    .filter((feld) => !ausser.has(feld) && (gespeichert[feld] ?? 0) !== (heute[feld] ?? 0))
    .map((feld) => ({ feld, erklaert: gespeichert[feld] ?? 0, journal: heute[feld] ?? 0 }));
}

/**
 * Ein Vermerk: der damals gerechnete Gewinn gegen heute (kein Befund, wenn Haben heute den Betrag laut Protokoll rechnet);
 * hält er die gerechneten Zahlen fest (seit #1144), dazu jede davon. Die Umsatzsteuer vergleicht die Steuer statt der
 * Abschlusszahlung (ustVermerkZeilen, ustVermerkSteuer).
 */
async function vermerkAbweichungen(year: number, form: "ust" | "euer", figures: Record<string, unknown>, vermerktAm: Date): Promise<ErklaertAbweichung[]> {
  const { amount, berechnet } = zahlen(figures);
  const gerechnet = typeof figures.gerechnet === "object" && figures.gerechnet ? zahlen(figures.gerechnet as Record<string, unknown>) : null;
  // Umsatzsteuer: Steuer (und Zeilen, wo festgehalten) statt der Abschlusszahlung, die an den Vorauszahlungen aus den
  // Voranmeldungen hängt, nicht am Journal (Selbstprüfung Runde 4 in #1144, #1231)
  if (form === "ust") return gerechnet ? ustVermerkZeilen(year, gerechnet, amount, berechnet) : ustVermerkSteuer(year, vermerktAm, amount, berechnet);
  const damals = berechnet ?? amount;
  const result: ErklaertAbweichung[] = [];
  const feld = "gewinn";
  let heute: number | undefined;
  if (damals !== undefined) {
    heute = (await vermerkPruefung("euer", year, null)).berechnet;
    if (damals !== heute && heute !== amount) result.push({ year, form, art: "vermerkt", feld, erklaert: damals, journal: heute });
  }
  // Mit bestätigter Abweichung sind die festgehaltenen Zahlen Habens damalige, nicht die abgegebenen; rechnet Haben heute den
  // Betrag laut Protokoll, sind sie überholt
  const ueberholt = berechnet !== undefined && heute === amount;
  if (gerechnet && !ueberholt) {
    const abweichend = vergleich(gerechnet, await gerechneteZahlen(form, year), new Set([...NICHT_AUS_DEM_JOURNAL, feld]));
    result.push(...abweichend.map((x) => ({ year, form, art: "vermerkt" as const, ...x })));
  }
  return result;
}

/**
 * Vermerkte Umsatzsteuererklärung mit festgehaltenen Zahlen: jede Zahl außer Vorauszahlungen und Abschlusszahlung gegen
 * heute. Mit bestätigter Abweichung sind sie überholt, sobald Haben die Steuer laut Protokoll rechnet (Abschlusszahlung
 * laut Protokoll plus die damaligen Vorauszahlungen).
 */
async function ustVermerkZeilen(year: number, gerechnet: Record<string, number>, amount?: number, berechnet?: number): Promise<ErklaertAbweichung[]> {
  const heute = await gerechneteZahlen("ust", year);
  if (berechnet !== undefined && amount !== undefined && heute.steuer === amount + (gerechnet.vorauszahlungen ?? 0)) return [];
  return vergleich(gerechnet, heute, NICHT_AUS_DEM_JOURNAL).map((x) => ({ year, form: "ust" as const, art: "vermerkt" as const, ...x }));
}

/**
 * Älterer Vermerk der Umsatzsteuer (vor #1144), der nur den Betrag laut Protokoll festhält, bei bestätigter Abweichung dazu
 * die damals gerechnete Abschlusszahlung: die Steuer damals (Abschlusszahlung plus Vorauszahlungen bis zum Vermerk) gegen
 * die Steuer heute. Kein Befund, wenn Haben heute die Steuer laut Protokoll rechnet. Die Sondervorauszahlung zählt mit dem
 * heutigen Stand der Dauerfristverlängerung; einen früheren hält Haben nicht fest.
 */
async function ustVermerkSteuer(year: number, vermerktAm: Date, amount?: number, berechnet?: number): Promise<ErklaertAbweichung[]> {
  const abschlussDamals = berechnet ?? amount;
  if (abschlussDamals === undefined) return [];
  const vorauszahlungen = await vorauszahlungssoll(year, await zuletztGesendet(year, vermerktAm));
  const damals = abschlussDamals + vorauszahlungen;
  const heute = (await gerechneteZahlen("ust", year)).steuer ?? 0;
  if (damals === heute || (amount !== undefined && heute === amount + vorauszahlungen)) return [];
  return [{ year, form: "ust", art: "vermerkt", feld: "steuer", erklaert: damals, journal: heute }];
}

/** Abweichungen der übermittelten bzw. vermerkten Umsatzsteuererklärung und Anlage EÜR der Jahre `years` */
export async function erklaerteAbweichungen(years: readonly number[]): Promise<ErklaertAbweichung[]> {
  if (years.length === 0) return [];
  const a = schema.annualSubmissions;
  const rows = await db
    .select({ year: a.year, form: a.form, kind: a.kind, figures: a.figures, createdAt: a.createdAt })
    .from(a)
    .where(and(inArray(a.year, [...years]), inArray(a.form, ["ust", "euer"]), inArray(a.kind, ["send", "vermerk"]), eq(a.ok, true)))
    .orderBy(a.year, a.form, desc(a.createdAt));
  const result: ErklaertAbweichung[] = [];
  for (const row of rows) {
    const form = row.form as "ust" | "euer";
    if (row.kind === "vermerk") {
      result.push(...(await vermerkAbweichungen(row.year, form, row.figures, row.createdAt)));
      continue;
    }
    const abweichend = vergleich(zahlen(row.figures), await gerechneteZahlen(form, row.year), NICHT_AUS_DEM_JOURNAL);
    result.push(...abweichend.map((x) => ({ year: row.year, form, art: "übermittelt" as const, ...x })));
  }
  return result;
}

const FORM = { ust: "Umsatzsteuererklärung", euer: "Anlage EÜR" } as const;

/** Eine Abweichung als Zeile des Abgleichs im Journal (Zeitraum ist das Jahr) */
export const erklaertZeile = (x: ErklaertAbweichung): AbgleichZeile => ({
  bereich: x.form === "ust" ? "ustva" : "euer",
  zeitraum: String(x.year),
  posten: `${FORM[x.form]} (${x.art}), ${x.feld}`,
  journal: x.journal,
  quelle: x.erklaert,
  gegen: x.art === "übermittelt" ? "übermittelt" : "beim Vermerk gerechnet",
});

/** Abweichungen aller übermittelten bzw. vermerkten Erklärungen als Zeilen, für die Integritätsprüfung */
export async function erklaerteAbweichungsZeilen(): Promise<AbgleichZeile[]> {
  const a = schema.annualSubmissions;
  const jahre = await db
    .selectDistinct({ year: a.year })
    .from(a)
    .where(and(inArray(a.form, ["ust", "euer"]), inArray(a.kind, ["send", "vermerk"]), eq(a.ok, true)));
  return (await erklaerteAbweichungen(jahre.map((j) => j.year))).map(erklaertZeile);
}
