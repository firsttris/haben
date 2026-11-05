import { ASSET_KINDS, assetIssues, type AssetKind, type AssetMethod, type Cents, formatDecimal } from "@haben/core";
import { type ColumnMapping, type ImportField, rowReader } from "./mapping.ts";
import { duplicateKey, type RowCandidate } from "./plan.ts";
import type { CsvTable } from "./read.ts";
import { type Parsed, parseImportAmount, parseImportDate } from "./values.ts";

/**
 * Anlagen aus CSV, als Übernahme aus der Vorgänger-Buchhaltung mit Buchwert zum Stichtag, genau wie „Anlage übernehmen“
 * (docs/anlagen.md). Der Import bucht nichts: Die Eröffnungsbuchung entsteht wie bei einer von Hand übernommenen
 * Anlage erst mit der ersten AfA-Buchung, und bis dahin lässt sich die Anlage noch ändern oder löschen.
 * Lexware Office exportiert das Anlagenverzeichnis nicht als Datei; die Spaltennamen folgen dessen Anzeige und
 * den üblichen Namen eines Anlagenspiegels.
 */
export const ASSET_FIELDS = [
  { key: "name", label: "Bezeichnung", aliases: ["Bezeichnung", "Anlagegut", "Wirtschaftsgut", "Anlage", "Name", "Anlagenbezeichnung"] },
  {
    key: "kind",
    label: "Art",
    hint: "Fahrzeug, Computer, Büromöbel oder Sonstiges; leer = Sonstiges",
    aliases: ["Art", "Anlagenart", "Kategorie", "Anlagenklasse", "Anlagengruppe", "Gruppe"],
  },
  {
    key: "method",
    label: "Abschreibung",
    hint: "linear, GWG, Sammelposten oder digital; leer = Vorschlag zur Art",
    aliases: ["Abschreibung", "Abschreibungsart", "AfA-Art", "AfA-Methode", "Methode"],
  },
  {
    key: "acquisitionDate",
    label: "Anschaffungsdatum",
    hint: "TT.MM.JJJJ",
    aliases: ["Anschaffungsdatum", "Anschaffung", "Kaufdatum", "Zugangsdatum", "Datum"],
  },
  {
    key: "cost",
    label: "Anschaffungskosten",
    hint: "netto, Betrag wie 1.234,56",
    aliases: ["Anschaffungskosten", "Anschaffungskosten netto", "AK", "AHK", "Anschaffungswert", "Anschaffungs- und Herstellungskosten"],
  },
  {
    key: "usefulLifeYears",
    label: "Nutzungsdauer in Jahren",
    aliases: ["Nutzungsdauer", "Nutzungsdauer (Jahre)", "Nutzungsdauer in Jahren", "ND", "ND (Jahre)"],
  },
  { key: "usefulLifeMonths", label: "Nutzungsdauer in Monaten", aliases: ["Nutzungsdauer (Monate)", "Nutzungsdauer in Monaten", "ND (Monate)"] },
  {
    key: "bookValue",
    label: "Restbuchwert zum Stichtag",
    hint: "Buchwert am Tag vor dem Stichtag laut bisheriger Buchhaltung",
    aliases: ["Restbuchwert", "Buchwert", "Buchwert zum Stichtag", "Restbuchwert zum Stichtag", "Buchwert Ende", "Buchwert 31.12."],
  },
  {
    key: "accumulated",
    label: "Bisherige AfA",
    hint: "Statt des Restbuchwerts: Summe aller Abschreibungen bis zum Stichtag",
    aliases: ["bisherige AfA", "kumulierte AfA", "AfA kumuliert", "aufgelaufene AfA", "Abschreibungen kumuliert", "kumulierte Abschreibungen"],
  },
  { key: "note", label: "Notiz", aliases: ["Notiz", "Bemerkung", "Inventarnummer"] },
] as const satisfies readonly ImportField[];

export interface AssetRow {
  name: string;
  kind: AssetKind;
  method: AssetMethod;
  acquisitionDate: string;
  cost: Cents;
  usefulLifeMonths: number | null;
  openingDate: string;
  openingBookValue: Cents;
  note: string;
}

const KIND_PATTERNS: [RegExp, AssetKind][] = [
  [/^kfz$|fahrzeug|pkw|lkw|auto|motorrad|transporter/, "kfz"],
  [/^edv$|computer|hardware|software|laptop|notebook|rechner|server|drucker|monitor|tablet|smartphone/, "edv"],
  [/^buero$|büro|buero|möbel|moebel|einrichtung/, "buero"],
  [/^sonstiges$|sonstig|bga|geschäftsausstattung|geschaeftsausstattung|maschine|werkzeug/, "sonstiges"],
];

function parseKind(raw: string): Parsed<AssetKind> {
  const value = raw.trim().toLowerCase();
  if (!value) return { ok: true, value: "sonstiges" };
  const match = KIND_PATTERNS.find(([pattern]) => pattern.test(value));
  return match ? { ok: true, value: match[1] } : { ok: false, error: `Art: „${raw}“; möglich sind Fahrzeug, Computer, Büromöbel und Sonstiges` };
}

function parseMethod(raw: string, kind: AssetKind): Parsed<AssetMethod> {
  const value = raw.trim().toLowerCase();
  if (!value) return { ok: true, value: ASSET_KINDS[kind].method };
  if (/gwg|geringwertig/.test(value)) return { ok: true, value: "gwg" };
  if (/sammelposten|pool/.test(value)) return { ok: true, value: "sammelposten" };
  if (/digital|1 jahr|ein jahr/.test(value)) return { ok: true, value: "digital" };
  if (/linear/.test(value)) return { ok: true, value: "linear" };
  return {
    ok: false,
    error: `Abschreibung: „${raw}“; möglich sind linear, GWG, Sammelposten und digital (Computer, 1 Jahr). Degressive AfA kennt Haben nicht`,
  };
}

/** Nutzungsdauer in Monaten aus der Monats- oder Jahresspalte („6“, „2,5“) */
function usefulLife(months: string, years: string): Parsed<number> | null {
  if (months) {
    return /^\d{1,3}$/.test(months) && Number(months) > 0
      ? { ok: true, value: Number(months) }
      : { ok: false, error: `Nutzungsdauer: „${months}“ Monate ist keine ganze Zahl` };
  }
  if (!years) return null;
  const match = /^(\d{1,2})(?:,(\d{1,2}))?$/.exec(years);
  const value = match ? Number(match[1]) * 12 + (Number(match[2] ?? "0") * 12) / 10 ** (match[2]?.length ?? 0) : Number.NaN;
  return Number.isInteger(value) && value > 0 ? { ok: true, value } : { ok: false, error: `Nutzungsdauer: „${years}“ Jahre ergibt keine ganzen Monate` };
}

const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

/**
 * Restbuchwert zum Stichtag: angegeben oder Anschaffungskosten minus bisherige AfA. Stehen beide da, müssen sie
 * zusammenpassen, sonst wäre eine Zahl falsch abgeschrieben.
 */
function bookValue(cost: Cents, stated: Parsed<Cents> | null, accumulated: Parsed<Cents> | null): Parsed<Cents> {
  if (stated && !stated.ok) return stated;
  if (accumulated && !accumulated.ok) return accumulated;
  const fromAccumulated = accumulated?.ok ? cost - accumulated.value : null;
  if (stated?.ok && fromAccumulated !== null && stated.value !== fromAccumulated) {
    return { ok: false, error: "Restbuchwert und bisherige AfA ergeben zusammen nicht die Anschaffungskosten" };
  }
  const value = stated?.ok ? stated.value : fromAccumulated;
  return value === null ? { ok: false, error: "Restbuchwert fehlt (oder bisherige AfA)" } : { ok: true, value };
}

/**
 * Fachliche Grenzen einer Übernahme, über assetIssues hinaus. Haben schriebe in diesen Fällen im Jahr des Stichtags ab,
 * was in die Vorjahre gehört, also lieber ablehnen:
 * - Anschaffung am oder nach dem Stichtag ist keine Übernahme, sondern ein Zugang per Beleg (mit Vorsteuer).
 * - GWG und digitale Wirtschaftsgüter sind im Anschaffungsjahr voll abgeschrieben; ein Restbuchwert danach passt nicht.
 * - Linear mit abgelaufener Nutzungsdauer bzw. Sammelposten nach fünf Jahren müssen bei 0 stehen.
 */
export function takeoverProblems(asset: AssetRow): string[] {
  const problems: string[] = [];
  if (asset.acquisitionDate >= asset.openingDate) {
    problems.push("Angeschafft am oder nach dem Stichtag: keine Übernahme, sondern als Beleg mit der Kategorie Anlagegut buchen");
    return problems;
  }
  const value = asset.openingBookValue;
  const yearsBefore = Number(asset.openingDate.slice(0, 4)) - Number(asset.acquisitionDate.slice(0, 4));
  if ((asset.method === "gwg" || asset.method === "digital") && yearsBefore > 0 && value > 0) {
    problems.push("Im Anschaffungsjahr voll abgeschrieben; der Restbuchwert muss 0 sein");
  }
  if (
    asset.method === "linear" &&
    asset.usefulLifeMonths &&
    monthIndex(asset.openingDate) - monthIndex(asset.acquisitionDate) >= asset.usefulLifeMonths &&
    value > 0
  ) {
    problems.push("Nutzungsdauer am Stichtag abgelaufen; der Restbuchwert muss 0 sein");
  }
  if (asset.method === "sammelposten" && yearsBefore >= 5 && value > 0) problems.push("Sammelposten nach fünf Jahren aufgelöst; der Restbuchwert muss 0 sein");
  return [...problems, ...assetIssues({ ...asset, opening: { date: asset.openingDate, bookValue: value } })];
}

export function assetCandidates(table: CsvTable, mapping: ColumnMapping, openingDate: string): RowCandidate<AssetRow>[] {
  return table.rows.map((row) => {
    const read = rowReader(row, mapping, ASSET_FIELDS);
    const { errors } = read;
    const name = read.text("name");
    const note = read.text("note");
    if (!name) errors.push("Bezeichnung fehlt");
    const kind = parseKind(read.raw("kind"));
    const method = kind.ok ? parseMethod(read.raw("method"), kind.value) : null;
    const rawDate = read.raw("acquisitionDate");
    const date = rawDate ? parseImportDate(rawDate, "Anschaffungsdatum") : { ok: false as const, error: "Anschaffungsdatum fehlt" };
    const rawCost = read.raw("cost");
    const cost = rawCost ? parseImportAmount(rawCost, "Anschaffungskosten") : { ok: false as const, error: "Anschaffungskosten fehlen" };
    const life = usefulLife(read.raw("usefulLifeMonths"), read.raw("usefulLifeYears"));
    const stated = read.raw("bookValue") ? parseImportAmount(read.raw("bookValue"), "Restbuchwert") : null;
    const accumulated = read.raw("accumulated") ? parseImportAmount(read.raw("accumulated"), "Bisherige AfA") : null;
    const value = cost.ok ? bookValue(cost.value, stated, accumulated) : null;
    for (const parsed of [kind, method, date, cost, life, value]) if (parsed && !parsed.ok) errors.push(parsed.error);
    const linear = method?.ok && method.value === "linear";
    if (linear && !life) errors.push("Nutzungsdauer fehlt");

    let asset: AssetRow | null = null;
    if (errors.length === 0 && kind.ok && method?.ok && date.ok && cost.ok && value?.ok) {
      asset = {
        name,
        kind: kind.value,
        method: method.value,
        acquisitionDate: date.value,
        cost: cost.value,
        usefulLifeMonths: linear && life?.ok ? life.value : null,
        openingDate,
        openingBookValue: value.value,
        note,
      };
      errors.push(...takeoverProblems(asset));
    }
    return {
      line: row.line,
      title: name || "(ohne Bezeichnung)",
      value: errors.length > 0 ? null : asset,
      errors,
      keys: asset ? assetKeys(asset) : [],
    };
  });
}

/** Eine Anlage erkennt Haben an Bezeichnung, Anschaffungsdatum und Anschaffungskosten zusammen */
export function assetKeys(a: { name: string; acquisitionDate: string; cost: Cents }) {
  const [year, month, day] = a.acquisitionDate.split("-");
  return duplicateKey("Bezeichnung, Anschaffung und Kosten", `${a.name} · ${day}.${month}.${year} · ${formatDecimal(a.cost)} €`);
}
