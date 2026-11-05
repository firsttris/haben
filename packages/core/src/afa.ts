import {
  DEGRESSIVE_PERIODS_TEXT,
  ELEKTRO_STAFFEL,
  elektroCumulative,
  formatDegressiveRate,
  isElektroDate,
  MEMO_VALUE,
  maxDegressiveRate,
} from "./afa-methoden.ts";
import type { Cents } from "./money.ts";
import type { Kontenrahmen } from "./posting.ts";

/**
 * Abschreibung beweglicher Wirtschaftsgüter (§ 7 Abs. 1, 2, 2a und 3, § 6 Abs. 2 und 2a EStG).
 * - linear: monatsgenau ab dem Monat der Anschaffung, über die Nutzungsdauer
 * - degressiv: fester Satz vom Restbuchwert, im Anschaffungsjahr zeitanteilig (§ 7 Abs. 2 Satz 3 i. V. m. Abs. 1
 *   Satz 4 EStG), Wechsel zur linearen AfA, sobald diese höher ist (§ 7 Abs. 3 EStG)
 * - elektro: Elektrofahrzeug nach § 7 Abs. 2a EStG, 75/10/5/5/3/2 % der Anschaffungskosten, ohne Zwölftelung
 * - digital: Computerhardware und Software mit Nutzungsdauer ein Jahr (BMF 22.02.2022),
 *   voll im Jahr der Anschaffung
 * - gwg: geringwertiges Wirtschaftsgut bis 800 € netto, voll im Jahr der Anschaffung
 * - sammelposten: 250,01 € bis 1.000 € netto, je ein Fünftel im Anschaffungsjahr und den vier folgenden
 */
export const ASSET_METHODS = {
  linear: "Linear über die Nutzungsdauer",
  degressiv: "Degressiv mit Wechsel zur linearen (§ 7 Abs. 2 EStG)",
  elektro: "Elektrofahrzeug 75/10/5/5/3/2 % (§ 7 Abs. 2a EStG)",
  digital: "Computer und Software (Nutzungsdauer 1 Jahr)",
  gwg: "Geringwertiges Wirtschaftsgut (bis 800 € netto)",
  sammelposten: "Sammelposten (250,01 € bis 1.000 € netto, 5 Jahre)",
} as const;

export type AssetMethod = keyof typeof ASSET_METHODS;
export const ASSET_METHOD_KEYS = Object.keys(ASSET_METHODS) as [AssetMethod, ...AssetMethod[]];

/** Methoden mit Nutzungsdauer; bei degressiv bestimmt sie den Höchstsatz und den Wechsel zur linearen AfA */
export const usesUsefulLife = (method: AssetMethod) => method === "linear" || method === "degressiv";

/** Methoden, bei denen ein Erinnerungswert von 1 € stehen bleiben kann; GWG und Sammelposten gehen ganz in den Aufwand */
export const allowsMemoValue = (method: AssetMethod) => method === "linear" || method === "degressiv" || method === "elektro";

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
  /** Nur bei linear und degressiv */
  usefulLifeMonths: number | null;
  /** Art, für die Prüfung der Methode (Elektrofahrzeug nur bei Fahrzeugen); ohne Angabe ungeprüft */
  kind?: AssetKind;
  /** Nur bei degressiv: Satz in Basispunkten (3000 = 30 %) */
  degressiveRate?: number | null;
  /** Nur bei degressiv: ab diesem Jahr linear, auch wenn die degressive AfA noch höher wäre (§ 7 Abs. 3 Satz 1 EStG) */
  linearFromYear?: number | null;
  /** Erinnerungswert von 1 € bis zum Abgang */
  memoValue?: boolean;
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
  if (usesUsefulLife(asset.method) && (!asset.usefulLifeMonths || asset.usefulLifeMonths < 1)) issues.push("Nutzungsdauer fehlt");
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
  issues.push(...methodIssues(asset));
  if (issues.length === 0 && asset.opening && (asset.method === "degressiv" || asset.method === "elektro")) issues.push(...takeoverIssues(asset));
  return issues;
}

/** Voraussetzungen von degressiver AfA, Elektrofahrzeug und Erinnerungswert */
function methodIssues(asset: ScheduleAsset): string[] {
  const issues: string[] = [];
  if (asset.method === "degressiv" && asset.usefulLifeMonths) {
    const max = maxDegressiveRate(asset.acquisitionDate, asset.usefulLifeMonths);
    if (max === null) issues.push(`Degressive AfA nur bei Anschaffung vom ${DEGRESSIVE_PERIODS_TEXT} (§ 7 Abs. 2 EStG)`);
    else if (!asset.degressiveRate || asset.degressiveRate < 1) issues.push("Satz der degressiven AfA fehlt");
    else if (asset.degressiveRate > max) issues.push(`Degressiver Satz höchstens ${formatDegressiveRate(max)} bei dieser Nutzungsdauer`);
  }
  if (asset.method !== "degressiv" && asset.degressiveRate) issues.push("Ein degressiver Satz gehört nur zur degressiven AfA");
  if (asset.linearFromYear != null) {
    if (asset.method !== "degressiv") issues.push("Den Wechsel zur linearen AfA gibt es nur bei der degressiven");
    else if (asset.linearFromYear < Number(asset.acquisitionDate.slice(0, 4))) issues.push("Wechsel zur linearen AfA liegt vor der Anschaffung");
  }
  if (asset.method === "elektro") {
    if (asset.kind && asset.kind !== "kfz") issues.push("AfA nach § 7 Abs. 2a EStG nur für Fahrzeuge");
    if (!isElektroDate(asset.acquisitionDate)) issues.push("AfA nach § 7 Abs. 2a EStG nur bei Anschaffung vom 01.07.2025 bis 31.12.2027");
  }
  if (asset.memoValue) {
    if (!allowsMemoValue(asset.method)) issues.push("Erinnerungswert nur bei linearer, degressiver und Elektro-AfA");
    else if (asset.cost <= MEMO_VALUE || (asset.opening && asset.opening.bookValue < MEMO_VALUE)) issues.push("Erinnerungswert braucht mehr als 1 € Buchwert");
  }
  return issues;
}

/**
 * Übernahme degressiver und Elektro-Anlagen: Die AfA hängt am Verlauf seit der Anschaffung, darum nur zum 01.01. eines
 * späteren Jahres und nur, wenn der Restbuchwert zum eigenen Plan passt (je Jahr bis 1 € Rundung). Sonst übernimmst du
 * die Anlage linear mit Restbuchwert und Restnutzungsdauer; das ist der Wechsel nach § 7 Abs. 3 Satz 2 EStG.
 */
function takeoverIssues(asset: ScheduleAsset): string[] {
  const opening = asset.opening!;
  const openingYear = Number(opening.date.slice(0, 4));
  const years = openingYear - Number(asset.acquisitionDate.slice(0, 4));
  if (!opening.date.endsWith("-01-01") || years < 1) {
    return ["Degressive und Elektro-AfA nur zum 01.01. eines Jahres nach der Anschaffung übernehmen"];
  }
  const plan = depreciationSchedule({ ...asset, opening: null, disposalDate: null }, openingYear - 1);
  const expected = plan.find((r) => r.year === openingYear - 1)?.closing ?? 0;
  if (Math.abs(expected - opening.bookValue) > years * 100) {
    const euro = (expected / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const method = asset.method === "elektro" ? "AfA nach § 7 Abs. 2a EStG" : "degressiven AfA";
    return [`Restbuchwert passt nicht zur ${method} (rechnerisch ${euro} €); dann linear übernehmen`];
  }
  return [];
}

/**
 * Abschreibungsplan je Jahr, vom Anschaffungs- bzw. Übernahmejahr bis der Buchwert 0 ist oder die
 * Anlage ausscheidet. Gerundet wird auf die Summe, damit am Ende genau die Anschaffungskosten
 * (bzw. der übernommene Buchwert) abgeschrieben sind. Mit Erinnerungswert bleibt 1 € stehen; der Plan reicht
 * dann bis untilYear (bzw. bis zum Abgang), damit jedes Jahr bis dahin seinen Buchwert hat.
 */
export function depreciationSchedule(asset: ScheduleAsset, untilYear?: number): ScheduleYear[] {
  const issues = assetIssues(asset);
  if (issues.length > 0) throw new AssetError(issues.join(", "));
  if (asset.method === "degressiv" || asset.method === "elektro") return stepSchedule(asset, untilYear);
  const memo = asset.memoValue ? MEMO_VALUE : 0;

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
      return Math.min(Math.round((base * Math.min(Math.max(months, 0), remaining)) / remaining), base - memo);
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
    if (planEnds(closing, memo, year, disposalYear, untilYear)) break;
  }
  return rows;
}

/** Ende des Plans: Buchwert 0, beim Erinnerungswert das letzte gewünschte Jahr ohne ausstehenden Abgang */
function planEnds(closing: Cents, memo: Cents, year: number, disposalYear: number | null, untilYear: number | undefined): boolean {
  if (closing === 0 || year >= 2200) return true;
  return closing <= memo && disposalYear === null && year >= (untilYear ?? year);
}

/**
 * Degressive und Elektro-AfA, Jahr für Jahr vom Buchwert aus.
 * - Degressiv: Satz × Buchwert am Jahresanfang × Monate / 12, im Anschaffungs- und im Abgangsjahr zeitanteilig
 *   (§ 7 Abs. 2 Satz 3 i. V. m. Abs. 1 Satz 4 EStG; R 7.4 Abs. 8 EStR). Linear (Buchwert / Restnutzungsdauer) ab dem
 *   Jahr, in dem das mindestens so viel ist, oder ab linearFromYear, danach nie zurück (§ 7 Abs. 3 EStG).
 * - Elektro: Staffel nach § 7 Abs. 2a EStG ohne Zwölftelung im Anschaffungsjahr (Satz 3); im Abgangsjahr zeitanteilig
 *   bis zum Abgangsmonat (R 7.4 Abs. 8 EStR, konservativ wie bei der linearen AfA).
 */
function stepSchedule(asset: ScheduleAsset, untilYear: number | undefined): ScheduleYear[] {
  const start = asset.opening?.date ?? asset.acquisitionDate;
  const firstYear = Number(start.slice(0, 4));
  const acquisitionYear = Number(asset.acquisitionDate.slice(0, 4));
  const disposalMonth = asset.disposalDate ? monthIndex(asset.disposalDate) : null;
  const disposalYear = asset.disposalDate ? Number(asset.disposalDate.slice(0, 4)) : null;
  const memo = asset.memoValue ? MEMO_VALUE : 0;
  let switched = false;

  const elektro = (year: number, available: Cents): Cents => {
    const k = year - acquisitionYear;
    const planned = k >= ELEKTRO_STAFFEL.length - 1 ? available - memo : elektroCumulative(asset.cost, k) - elektroCumulative(asset.cost, k - 1);
    const months = disposalYear === year ? disposalMonth! - year * 12 + 1 : 12;
    return Math.round((planned * months) / 12);
  };
  const degressive = (year: number, available: Cents): Cents => {
    const firstMonth = Math.max(year * 12, monthIndex(start));
    const months = Math.min(year * 12 + 11, disposalMonth ?? Infinity) - firstMonth + 1;
    const remaining = asset.usefulLifeMonths! - (firstMonth - monthIndex(asset.acquisitionDate));
    if (months <= 0) return 0;
    if (remaining <= months) return available - memo;
    const linearAmount = Math.round((available * months) / remaining);
    const degressiveAmount = Math.round((available * asset.degressiveRate! * months) / 120_000);
    if (!switched && ((asset.linearFromYear != null && year >= asset.linearFromYear) || linearAmount >= degressiveAmount)) switched = true;
    return switched ? linearAmount : degressiveAmount;
  };
  const amount = asset.method === "elektro" ? elektro : degressive;

  const rows: ScheduleYear[] = [];
  let bookValue = asset.opening ? asset.opening.bookValue : 0;
  for (let year = firstYear; ; year++) {
    const addition = !asset.opening && year === firstYear ? asset.cost : 0;
    const opening = bookValue;
    const available = opening + addition;
    const depreciation = Math.max(0, Math.min(amount(year, available), available - memo));
    let closing = available - depreciation;
    let disposal = 0;
    if (disposalYear === year) {
      disposal = closing;
      closing = 0;
    }
    rows.push({ year, opening, addition, depreciation, disposal, closing });
    bookValue = closing;
    if (planEnds(closing, memo, year, disposalYear, untilYear)) break;
  }
  return rows;
}
