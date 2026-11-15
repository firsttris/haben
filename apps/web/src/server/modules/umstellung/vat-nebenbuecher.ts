import { JOURNAL_KENNZAHLEN, type Cents, type JournalKennzahlen, type TaxTreatment, type VatPeriod } from "@haben/core";
import type { Db, Tx } from "../../db/index.ts";
import { computeVatFigures, kennzahlenAusDemJournal } from "../umsatzsteuer/index.ts";

/*
 * EINGEFROREN, nur für die Prüfung beim Update (#1116, pruefung.ts): die Kennzahlen der Voranmeldung aus den Nebenbüchern,
 * wie Haben sie bis 0.x vor dem Stichjahr gerechnet hat (früher umsatzsteuer/vat-figures.ts). Sie summieren die Listen, die
 * computeVatFigures weiter als Erläuterung liefert, und zählen die freien Buchungen aus dem Journal dazu (sie haben kein
 * Nebenbuch). Nicht weiterentwickeln; fällt mit dem Modul weg.
 */

type Zeile = { base: Cents; tax: Cents; rate: number };

/** Kennzahlen eines Zeitraums aus den Nebenbüchern und aus dem Journal */
export async function kennzahlenBeiderQuellen(period: VatPeriod, q: Db | Tx): Promise<{ journal: JournalKennzahlen; nebenbuecher: JournalKennzahlen }> {
  const f = await computeVatFigures(period, q);
  const journal = Object.fromEntries(JOURNAL_KENNZAHLEN.map((feld) => [feld, f[feld]])) as JournalKennzahlen;
  const regular = f.revenue.filter((r) => r.treatment === "regulaer");
  const sum = (rows: Zeile[], rate: number, key: "base" | "tax") => rows.filter((r) => r.rate === rate).reduce((s, r) => s + r[key], 0);
  const treated = (treatment: TaxTreatment) => f.revenue.filter((r) => r.treatment === treatment).reduce((s, r) => s + r.base, 0);
  const rc = (kind: "eu" | "drittland", key: "base" | "tax") => f.reverseCharge.filter((r) => r.reverseCharge === kind).reduce((s, r) => s + r[key], 0);
  const ige = (rate: number, key: "base" | "tax") => sum(f.igErwerb, rate, key);
  const nebenbuch: JournalKennzahlen = {
    kz81: sum(regular, 1900, "base"),
    tax81: sum(regular, 1900, "tax"),
    kz86: sum(regular, 700, "base"),
    tax86: sum(regular, 700, "tax"),
    kz21: treated("reverse_charge"),
    kz45: treated("drittland"),
    kz48: treated("steuerfrei"),
    kz66: f.inputTax.reduce((s, a) => s + a.tax, 0),
    kz46: rc("eu", "base"),
    kz47: rc("eu", "tax"),
    kz84: rc("drittland", "base"),
    kz85: rc("drittland", "tax"),
    kz67: f.reverseCharge.reduce((s, r) => s + r.deductible, 0),
    kz41: treated("ig_lieferung"),
    kz43: treated("ausfuhr"),
    kz89: ige(1900, "base"),
    tax89: ige(1900, "tax"),
    kz93: ige(700, "base"),
    tax93: ige(700, "tax"),
    kz61: f.igErwerb.reduce((s, r) => s + r.deductible, 0),
    kz62: f.einfuhr.reduce((s, r) => s + r.tax, 0),
    steuerfrei: sum(regular, 0, "base"),
  };
  const manuell = await kennzahlenAusDemJournal(period, f.versteuerung, q, true);
  const nebenbuecher = Object.fromEntries(JOURNAL_KENNZAHLEN.map((feld) => [feld, nebenbuch[feld] + manuell[feld]])) as JournalKennzahlen;
  return { journal, nebenbuecher };
}
