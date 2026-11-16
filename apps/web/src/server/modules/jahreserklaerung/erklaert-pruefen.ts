import { formatEuro, type Cents } from "@haben/core";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { euerYear, ustYear } from "./annual.ts";
import { vermerkPruefung } from "./vermerk.ts";

/*
 * Übermittelte und vermerkte Jahreserklärungen gegen die Rechnung aus dem Journal (#1116), wie die gesendeten
 * Voranmeldungen (umsatzsteuer/gesendet-pruefen.ts): Was das Finanzamt hat, soll Haben heute genauso rechnen.
 * - Über Haben übermittelt: jede gespeicherte Zahl der Erklärung (annual_submissions.figures) gegen heute. Nicht
 *   verglichen werden die Vorauszahlungen der Umsatzsteuererklärung und die Abschlusszahlung daraus: Sie kommen aus den
 *   gesendeten Voranmeldungen und der Dauerfristverlängerung, nicht aus dem Journal.
 * - Außerhalb von Haben abgegeben (Vermerk): Der Vermerk hält nur den Betrag laut Protokoll fest, bei einer bestätigten
 *   Abweichung dazu den damals gerechneten Wert (vermerk.ts). Verglichen wird der damals gerechnete Wert (ohne Abweichung
 *   der Betrag) mit dem, was der Vermerk heute rechnen würde (vermerkPruefung: Gewinn bzw. Abschlusszahlung).
 * Die Einkommensteuer hat keine eigenen Zahlen aus dem Journal; sie folgt der EÜR.
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

const zahlen = (werte: Record<string, unknown>) => Object.fromEntries(Object.entries(werte).filter((e): e is [string, number] => typeof e[1] === "number"));

/** Abweichungen der übermittelten bzw. vermerkten Umsatzsteuererklärung und Anlage EÜR der Jahre `years` */
export async function erklaerteAbweichungen(years: readonly number[]): Promise<ErklaertAbweichung[]> {
  if (years.length === 0) return [];
  const a = schema.annualSubmissions;
  const rows = await db
    .select({ year: a.year, form: a.form, kind: a.kind, figures: a.figures })
    .from(a)
    .where(and(inArray(a.year, [...years]), inArray(a.form, ["ust", "euer"]), inArray(a.kind, ["send", "vermerk"]), eq(a.ok, true)))
    .orderBy(a.year, a.form, desc(a.createdAt));
  const result: ErklaertAbweichung[] = [];
  for (const row of rows) {
    const form = row.form as "ust" | "euer";
    if (row.kind === "vermerk") {
      const { amount, berechnet } = zahlen(row.figures);
      const damals = berechnet ?? amount;
      if (damals === undefined) continue;
      const heute = (await vermerkPruefung(form, row.year, null)).berechnet;
      const feld = form === "ust" ? "abschluss" : "gewinn";
      if (damals !== heute) result.push({ year: row.year, form, art: "vermerkt", feld, erklaert: damals, journal: heute });
      continue;
    }
    const heute: Record<string, number> =
      form === "ust"
        ? await ustYear(row.year).then((u) => ({ ...zahlen(u.figures as unknown as Record<string, unknown>), steuer: u.steuer }))
        : await euerYear(row.year).then((e) => ({ ...zahlen(e.figures as unknown as Record<string, unknown>), gewinn: e.gewinn }));
    const gespeichert = zahlen(row.figures);
    for (const feld of new Set([...Object.keys(gespeichert), ...Object.keys(heute)])) {
      if (NICHT_AUS_DEM_JOURNAL.has(feld)) continue;
      const erklaert = gespeichert[feld] ?? 0;
      const journal = heute[feld] ?? 0;
      if (erklaert !== journal) result.push({ year: row.year, form, art: "übermittelt", feld, erklaert, journal });
    }
  }
  return result;
}

const FORM = { ust: "Umsatzsteuererklärung", euer: "Anlage EÜR" } as const;

/** Kurztext einer Abweichung, z. B. für den Befund der Prüfung beim Update */
export function erklaertText(x: ErklaertAbweichung): string {
  const wert = x.art === "übermittelt" ? "übermittelt" : "beim Vermerk gerechnet";
  return `${FORM[x.form]} ${x.year} (${x.art}), ${x.feld}: ${wert} ${formatEuro(x.erklaert)}, aus dem Journal ${formatEuro(x.journal)}`;
}
