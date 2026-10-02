import type { Cents } from "./money.ts";
import type { Kontenrahmen } from "./posting.ts";

/**
 * Abschreibung beweglicher Wirtschaftsgüter (§ 7 Abs. 1, § 6 Abs. 2 und 2a EStG).
 * - linear: monatsgenau ab dem Monat der Anschaffung, über die Nutzungsdauer
 * - digital: Computerhardware und Software mit Nutzungsdauer ein Jahr (BMF 22.02.2022),
 *   voll im Jahr der Anschaffung
 * - gwg: geringwertiges Wirtschaftsgut bis 800 € netto, voll im Jahr der Anschaffung
 * - sammelposten: 250,01 € bis 1.000 € netto, je ein Fünftel im Anschaffungsjahr und den vier folgenden
 */
export const ASSET_METHODS = {
  linear: "Linear über die Nutzungsdauer",
  digital: "Computer und Software (Nutzungsdauer 1 Jahr)",
  gwg: "Geringwertiges Wirtschaftsgut (bis 800 € netto)",
  sammelposten: "Sammelposten (250,01 € bis 1.000 € netto, 5 Jahre)",
} as const;

export type AssetMethod = keyof typeof ASSET_METHODS;
export const ASSET_METHOD_KEYS = Object.keys(ASSET_METHODS) as [AssetMethod, ...AssetMethod[]];

/** Art der Anlage: bestimmt Anlagekonto, AfA-Konto und die übliche Nutzungsdauer laut AfA-Tabelle */
export const ASSET_KINDS = {
  kfz: { label: "Fahrzeug", usefulLifeYears: 6, method: "linear" },
  edv: { label: "Computer, Hardware und Software", usefulLifeYears: 1, method: "digital" },
  buero: { label: "Büromöbel und Büroeinrichtung", usefulLifeYears: 13, method: "linear" },
  sonstiges: { label: "Sonstige Betriebs- und Geschäftsausstattung", usefulLifeYears: null, method: "linear" },
} as const satisfies Record<string, { label: string; usefulLifeYears: number | null; method: AssetMethod }>;

export type AssetKind = keyof typeof ASSET_KINDS;
export const ASSET_KIND_KEYS = Object.keys(ASSET_KINDS) as [AssetKind, ...AssetKind[]];

/** Grenzen netto in Cent (bzw. brutto ohne Vorsteuerabzug) */
export const GWG_LIMIT: Cents = 80_000;
export const SAMMELPOSTEN_MIN: Cents = 25_001;
export const SAMMELPOSTEN_MAX: Cents = 100_000;

/** Konten für Anlagen und Abschreibungen. Vor dem Echtbetrieb mit dem Steuerberater abgleichen. */
export const ASSET_ACCOUNTS = {
  SKR03: {
    anlage: { kfz: "0320", edv: "0420", buero: "0420", sonstiges: "0490" },
    gwg: "0480",
    sammelposten: "0485",
    afa: "4830",
    afaKfz: "4832",
    afaGwg: "4855",
    afaSammelposten: "4862",
    restbuchwert: "2310",
  },
  SKR04: {
    anlage: { kfz: "0520", edv: "0650", buero: "0650", sonstiges: "0690" },
    gwg: "0670",
    sammelposten: "0675",
    afa: "6220",
    afaKfz: "6222",
    afaGwg: "6260",
    afaSammelposten: "6264",
    restbuchwert: "6895",
  },
} as const;

export const ASSET_ACCOUNT_NAMES: Record<Kontenrahmen, Record<string, string>> = {
  SKR03: {
    "0320": "Pkw",
    "0420": "Büroeinrichtung",
    "0480": "Geringwertige Wirtschaftsgüter",
    "0485": "Wirtschaftsgüter Sammelposten",
    "0490": "Sonstige Betriebs- und Geschäftsausstattung",
    "2310": "Anlagenabgänge Sachanlagen (Restbuchwert)",
    "4830": "Abschreibungen auf Sachanlagen",
    "4832": "Abschreibungen auf Kfz",
    "4855": "Sofortabschreibung geringwertiger Wirtschaftsgüter",
    "4862": "Abschreibungen auf den Sammelposten",
  },
  SKR04: {
    "0520": "Pkw",
    "0650": "Büroeinrichtung",
    "0670": "Geringwertige Wirtschaftsgüter",
    "0675": "Wirtschaftsgüter Sammelposten",
    "0690": "Sonstige Betriebs- und Geschäftsausstattung",
    "6220": "Abschreibungen auf Sachanlagen",
    "6222": "Abschreibungen auf Kfz",
    "6260": "Sofortabschreibung geringwertiger Wirtschaftsgüter",
    "6264": "Abschreibungen auf den Sammelposten",
    "6895": "Anlagenabgänge Sachanlagen (Restbuchwert)",
  },
};

/** Anlagekonto, auf das die Anschaffung gebucht wird */
export function assetAccount(kind: AssetKind, method: AssetMethod, kontenrahmen: Kontenrahmen): string {
  const accounts = ASSET_ACCOUNTS[kontenrahmen];
  if (method === "gwg") return accounts.gwg;
  if (method === "sammelposten") return accounts.sammelposten;
  return accounts.anlage[kind];
}

/** Aufwandskonto der Abschreibung */
export function depreciationAccount(kind: AssetKind, method: AssetMethod, kontenrahmen: Kontenrahmen): string {
  const accounts = ASSET_ACCOUNTS[kontenrahmen];
  if (method === "gwg") return accounts.afaGwg;
  if (method === "sammelposten") return accounts.afaSammelposten;
  return kind === "kfz" ? accounts.afaKfz : accounts.afa;
}

export interface ScheduleAsset {
  /** ISO-Datum der Anschaffung (Lieferung) */
  acquisitionDate: string;
  /** Anschaffungskosten netto (ohne Vorsteuerabzug brutto) */
  cost: Cents;
  /** Netto für die Grenzen von GWG und Sammelposten, wenn cost die nicht abziehbare Vorsteuer enthält */
  netCost?: Cents;
  method: AssetMethod;
  /** Nur bei linear */
  usefulLifeMonths: number | null;
  /** Aus der Vorgänger-Buchhaltung übernommen: Buchwert zum Stichtag, ab dann schreibt Haben ab */
  opening?: { date: string; bookValue: Cents } | null;
  /** Ausgeschieden (Verkauf, Entnahme, Verschrottung); im Monat des Abgangs wird noch abgeschrieben */
  disposalDate?: string | null;
}

export interface ScheduleYear {
  year: number;
  /** Buchwert am Jahresanfang (bzw. zum Übernahmestichtag) */
  opening: Cents;
  /** Zugang im Jahr der Anschaffung */
  addition: Cents;
  depreciation: Cents;
  /** Restbuchwert beim Abgang, wird als Aufwand gebucht */
  disposal: Cents;
  /** Buchwert am Jahresende */
  closing: Cents;
}

export class AssetError extends Error {}

const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

/** Prüft die Eingaben; leer = in Ordnung */
export function assetIssues(asset: ScheduleAsset): string[] {
  const issues: string[] = [];
  if (asset.cost <= 0) issues.push("Anschaffungskosten müssen positiv sein");
  if (asset.method === "linear" && (!asset.usefulLifeMonths || asset.usefulLifeMonths < 1)) issues.push("Nutzungsdauer fehlt");
  const net = asset.netCost ?? asset.cost;
  if (asset.method === "gwg" && net > GWG_LIMIT) issues.push("Als GWG nur bis 800 € netto");
  if (asset.method === "sammelposten" && (net < SAMMELPOSTEN_MIN || net > SAMMELPOSTEN_MAX)) {
    issues.push("Sammelposten nur von 250,01 € bis 1.000 € netto");
  }
  if (asset.opening) {
    if (asset.opening.date < asset.acquisitionDate) issues.push("Übernahmestichtag liegt vor der Anschaffung");
    if (asset.opening.bookValue < 0 || asset.opening.bookValue > asset.cost) issues.push("Restbuchwert muss zwischen 0 und den Anschaffungskosten liegen");
  }
  if (asset.disposalDate) {
    const start = asset.opening?.date ?? asset.acquisitionDate;
    if (asset.disposalDate < start) issues.push("Abgang liegt vor der Anschaffung bzw. Übernahme");
  }
  return issues;
}

/**
 * Abschreibungsplan je Jahr, vom Anschaffungs- bzw. Übernahmejahr bis der Buchwert 0 ist oder die
 * Anlage ausscheidet. Gerundet wird auf die Summe, damit am Ende genau die Anschaffungskosten
 * (bzw. der übernommene Buchwert) abgeschrieben sind.
 */
export function depreciationSchedule(asset: ScheduleAsset): ScheduleYear[] {
  const issues = assetIssues(asset);
  if (issues.length > 0) throw new AssetError(issues.join(", "));

  const start = asset.opening?.date ?? asset.acquisitionDate;
  const base = asset.opening ? asset.opening.bookValue : asset.cost;
  const firstYear = Number(start.slice(0, 4));
  const disposalYear = asset.disposalDate ? Number(asset.disposalDate.slice(0, 4)) : null;

  // Kumulierte Abschreibung nach Monaten bzw. Jahren seit Beginn
  let cumulativeUntilYearEnd: (year: number) => Cents;
  if (asset.method === "linear") {
    const startMonth = monthIndex(start);
    const used = asset.opening ? monthIndex(asset.opening.date) - monthIndex(asset.acquisitionDate) : 0;
    const remaining = Math.max(1, asset.usefulLifeMonths! - used);
    const lastMonth = asset.disposalDate ? monthIndex(asset.disposalDate) : Infinity;
    cumulativeUntilYearEnd = (year) => {
      const months = Math.min(year * 12 + 11, lastMonth) - startMonth + 1;
      return Math.round((base * Math.min(Math.max(months, 0), remaining)) / remaining);
    };
  } else if (asset.method === "sammelposten") {
    // Abgänge ändern den Sammelposten nicht (§ 6 Abs. 2a Satz 3 EStG)
    const usedYears = asset.opening ? firstYear - Number(asset.acquisitionDate.slice(0, 4)) : 0;
    const remaining = Math.max(1, 5 - usedYears);
    cumulativeUntilYearEnd = (year) => Math.round((base * Math.min(Math.max(year - firstYear + 1, 0), remaining)) / remaining);
  } else {
    cumulativeUntilYearEnd = (year) => (year >= firstYear ? base : 0);
  }

  const rows: ScheduleYear[] = [];
  let bookValue = asset.opening ? asset.opening.bookValue : 0;
  for (let year = firstYear; ; year++) {
    const addition = !asset.opening && year === firstYear ? asset.cost : 0;
    const opening = bookValue;
    const depreciation = cumulativeUntilYearEnd(year) - cumulativeUntilYearEnd(year - 1);
    let closing = opening + addition - depreciation;
    let disposal = 0;
    if (disposalYear === year && asset.method !== "sammelposten") {
      disposal = closing;
      closing = 0;
    }
    rows.push({ year, opening, addition, depreciation, disposal, closing });
    bookValue = closing;
    if (closing === 0 || year >= 2200) break;
  }
  return rows;
}

/** Zeile des Plans für ein Jahr; ohne Eintrag ist nichts abzuschreiben */
export function scheduleForYear(asset: ScheduleAsset, year: number): ScheduleYear | null {
  return depreciationSchedule(asset).find((row) => row.year === year) ?? null;
}
