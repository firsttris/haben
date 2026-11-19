import type { ScheduleAsset, ScheduleYear } from "./afa.ts";
import { EBILANZ_KONTEN } from "./ebilanz.ts";
import type { Cents } from "./money.ts";
import type { Kontenrahmen } from "./posting.ts";

/* Anlagenspiegel für die E-Bilanz (ebilanz.ts ordnet die Anlagekonten den Positionen zu) */

/** Eine Zeile des Anlagenspiegels: Anschaffungskosten und AfA je Bilanzposition, brutto, Beträge positiv */
export interface AnlagenspiegelZeile {
  /** Bilanzposition unter bs.ass.fixAss, z. B. bs.ass.fixAss.tan.otherEquipm.passengerCars */
  position: string;
  akAnfang: Cents;
  zugaenge: Cents;
  /** Anschaffungskosten der Abgänge */
  abgaenge: Cents;
  afaAnfang: Cents;
  afaJahr: Cents;
  /** Kumulierte AfA der Abgänge */
  afaAbgaenge: Cents;
}

/**
 * Anlagenspiegel einer Anlage im Jahr aus ihrem Abschreibungsplan (afa.ts), brutto mit den Anschaffungskosten. Eine
 * übernommene Anlage bringt ihre Anschaffungskosten mit; die AfA vor der Übernahme ist der Unterschied zum Buchwert.
 * GWG und Sammelposten scheiden aus, sobald sie abgeschrieben sind, im Jahr der letzten AfA (übliche Darstellung, der
 * Buchwert ist dann 0); andere Anlagen bleiben bis zum Abgang. null: im Jahr nicht im Bestand.
 */
export function anlagenspiegelZeile(
  kontenrahmen: Kontenrahmen,
  asset: ScheduleAsset & { account: string },
  schedule: readonly ScheduleYear[],
  year: number,
): AnlagenspiegelZeile | null {
  const position = EBILANZ_KONTEN[kontenrahmen][asset.account]?.[0];
  if (!position) throw new Error(`Anlagekonto ${asset.account} hat keine Position in der E-Bilanz`);
  const start = Number((asset.opening?.date ?? asset.acquisitionDate).slice(0, 4));
  const row = schedule.find((r) => r.year === year);
  const last = schedule.at(-1);
  const written = asset.method === "gwg" || asset.method === "sammelposten";
  // Abgang im Jahr: verkauft oder entnommen, bei GWG und Sammelposten auch das Jahr der letzten AfA
  const leaves = (asset.disposalDate && asset.method !== "sammelposten" ? Number(asset.disposalDate.slice(0, 4)) : null) ?? (written ? last?.year : null);
  if (year < start || (leaves != null && year > leaves)) return null;
  const cost = asset.cost;
  const akAnfang = start < year || asset.opening ? cost : 0;
  const bookValueStart = row ? row.opening : 0;
  const afaJahr = row?.depreciation ?? 0;
  const gone = leaves === year;
  return {
    position,
    akAnfang,
    zugaenge: akAnfang === 0 ? cost : 0,
    abgaenge: gone ? cost : 0,
    afaAnfang: akAnfang - bookValueStart,
    afaJahr,
    // Beim Abgang ist alles bis auf den Restbuchwert abgeschrieben; der Restbuchwert geht als Aufwand ab
    afaAbgaenge: gone ? cost - (row?.disposal ?? 0) : 0,
  };
}
