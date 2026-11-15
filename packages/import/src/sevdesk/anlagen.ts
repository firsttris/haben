import { type AssetKind, type Cents, depreciationSchedule, GWG_LIMIT, type Kontenrahmen, assetAccount } from "@haben/core";
import { assetKindFromText, type AssetRow } from "../csv-import/assets.ts";
import { duplicateKey, type DuplicateKey } from "../csv-import/plan.ts";
import { lexDate, lexToCents } from "../lexoffice/map.ts";
import { sevNumber } from "./map.ts";
import type { SevAsset } from "./types.ts";

/*
 * Anlagenverzeichnis aus sevDesk als Vorschlag für „Anlage übernehmen“ (docs/sevdesk.md, docs/anlagen.md). GET /Asset
 * liefert Anschaffungsdatum, Nettokaufpreis, Nutzungsdauer in Jahren und Verkaufsdatum, aber weder die AfA-Methode noch
 * bisherige Abschreibungen. sevDesk kennt nur lineare AfA und die Sofortabschreibung (Nutzungsdauer 0), keine degressive
 * AfA und keinen Sammelposten. Den Restbuchwert zum Stichtag rechnet Haben deshalb selbst: linear und monatsgenau nach
 * § 7 Abs. 1 Satz 1 und 4 EStG, mit demselben Plan, mit dem es danach weiter abschreibt. Alles, was sich daraus nicht
 * sicher ergibt, meldet der Vorschlag, statt zu raten.
 */

export type SevAnlageStand =
  /** Restbuchwert über 0: übernehmen, nach Bestätigung */
  | "uebernehmen"
  /** Am Stichtag voll abgeschrieben oder abgegangen: nichts zu übernehmen (docs/anlagen.md) */
  | "erledigt"
  /** Lässt sich nicht sicher abbilden: von Hand mit „Anlage übernehmen“ */
  | "ausgeschlossen";

export interface SevAnlage {
  sevId: string;
  nummer: string;
  name: string;
  acquisitionDate: string | null;
  cost: Cents;
  method: "linear" | "gwg" | null;
  usefulLifeMonths: number | null;
  /** Art, soweit sie aus dem Buchungskonto in sevDesk sicher folgt; null = vor dem Übernehmen wählen */
  kind: AssetKind | null;
  /** Name des Buchungskontos in sevDesk */
  kategorie: string | null;
  /** Anlagekonto laut sevDesk, nur bei dessen eigenen Anlagekonten (Pkw, Maschine) */
  sevKonto: { SKR03: string | null; SKR04: string | null } | null;
  openingBookValue: Cents | null;
  stand: SevAnlageStand;
  /** Warum erledigt oder ausgeschlossen */
  grund: string | null;
  hinweise: string[];
}

const dayOf = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;

/** Kontonummer aus sevDesk („320“) vierstellig wie in Haben („0320“) */
const konto = (value: string | null | undefined) => (value && /^\d{1,4}$/.test(value.trim()) ? value.trim().padStart(4, "0") : null);

/** Buchungskonten von sevDesk, deren Art feststeht (translationCode des Kontostamms, 1.0) */
const KIND_BY_CODE: Record<string, AssetKind> = {
  ACCOUNTING_TYPE_CARS: "kfz",
  ACCOUNTING_TYPE_VEHICLE: "kfz",
};

function kindOf(asset: SevAsset): { kind: AssetKind | null; ausschluss: string | null; hinweis: string | null } {
  const type = asset.accountingType;
  if (!type) {
    return {
      kind: null,
      ausschluss: null,
      hinweis: asset.accountDatev
        ? "Art wählen: Das Konto aus sevDesk (Buchhaltung 2.0) liest Haben nicht aus"
        : "Art wählen: sevDesk nennt kein Buchungskonto",
    };
  }
  const code = type.translationCode ?? "";
  if (code === "ACCOUNTING_TYPE_BUILDINGS") return { kind: null, ausschluss: "Gebäude führt Haben nicht im Anlagenverzeichnis", hinweis: null };
  if (KIND_BY_CODE[code]) return { kind: KIND_BY_CODE[code], ausschluss: null, hinweis: null };
  const name = type.name?.trim() ?? "";
  // Eigene Buchungskonten (mit sevClient, ohne translationCode) tragen nur den Namen, den der Kunde vergeben hat
  if (type.sevClient && !code) {
    const kind = assetKindFromText(name);
    if (kind) return { kind, ausschluss: null, hinweis: null };
  }
  return { kind: null, ausschluss: null, hinweis: `Art wählen: Die Kategorie „${name || type.id}“ in sevDesk legt sie nicht fest` };
}

/**
 * Bildet eine Anlage aus sevDesk auf den Vorschlag zum Übernahmestichtag ab. `openingDate` ist der erste Tag in Haben
 * und muss ein 1. Januar sein: Nur dann ist der Restbuchwert der Buchwert am Ende des Vorjahres im linearen Plan.
 */
export function mapSevAsset(asset: SevAsset, openingDate: string): SevAnlage {
  if (!openingDate.endsWith("-01-01")) throw new Error("Anlagen aus sevDesk nur zum 01.01. übernehmen");
  const acquisitionDate = lexDate(asset.acquisitionDate);
  const cost = lexToCents(sevNumber(asset.purchasePrice));
  const years = sevNumber(asset.usefulLife);
  const status = String(asset.status ?? "");
  const type = asset.accountingType;
  const { kind, ausschluss, hinweis } = kindOf(asset);
  const base: SevAnlage = {
    sevId: String(asset.id),
    nummer: String(asset.assetNumber ?? ""),
    name: asset.name?.trim() || `Anlage ${asset.assetNumber ?? asset.id}`,
    acquisitionDate,
    cost,
    method: null,
    usefulLifeMonths: null,
    kind,
    kategorie: type?.name ?? null,
    sevKonto: type && (konto(type.skr03) ?? "9999") < "1000" ? { SKR03: konto(type.skr03), SKR04: konto(type.skr04) } : null,
    openingBookValue: null,
    stand: "ausgeschlossen",
    grund: null,
    hinweise: hinweis ? [hinweis] : [],
  };
  const exclude = (grund: string): SevAnlage => ({ ...base, stand: "ausgeschlossen", grund });

  if (!acquisitionDate) return exclude("Ohne Anschaffungsdatum");
  if (cost <= 0) return exclude("Ohne Kaufpreis");
  if (lexToCents(sevNumber(asset.purchasePriceAccounting)) !== cost) return exclude("Kaufpreis und gebuchter Betrag weichen in sevDesk voneinander ab");
  if (!Number.isInteger(years) || years < 0) return exclude(`Nutzungsdauer „${asset.usefulLife}“ ist keine Zahl ganzer Jahre`);
  const saleDate = lexDate(asset.saleDate);
  if (saleDate && saleDate < openingDate) return { ...base, stand: "erledigt", grund: `Am ${dayOf(saleDate)} abgegangen` };
  if (acquisitionDate >= openingDate) return exclude("Am oder nach dem Stichtag angeschafft: als Beleg mit der Kategorie Anlagegut buchen");
  if (ausschluss) return exclude(ausschluss);

  // In 1.0 belegt: 100 bei Nutzungsdauer über 0, 500 bei Sofortabschreibung (test-fixtures/sevdesk); mehr beschreibt sevDesk nicht
  if (years === 0) {
    if (status !== "500") return exclude(`Status ${status} bei Nutzungsdauer 0 ist nicht belegt`);
    if (cost > GWG_LIMIT) return exclude("Sofort abgeschrieben, aber über 800 € netto: in sevDesk prüfen");
    return { ...base, method: "gwg", openingBookValue: 0, stand: "erledigt", grund: "Geringwertiges Wirtschaftsgut, im Anschaffungsjahr voll abgeschrieben" };
  }
  if (status !== "100") return exclude(`Status ${status} bei Nutzungsdauer ${years} Jahre ist nicht belegt`);

  const usefulLifeMonths = years * 12;
  const lastYear = Number(openingDate.slice(0, 4)) - 1;
  const plan = depreciationSchedule({ acquisitionDate, cost, method: "linear", usefulLifeMonths }, lastYear);
  const bookValue = plan.find((r) => r.year === lastYear)?.closing ?? 0;
  const linear = { ...base, method: "linear" as const, usefulLifeMonths, openingBookValue: bookValue };
  if (bookValue === 0) return { ...linear, stand: "erledigt", grund: "Am Stichtag voll abgeschrieben" };
  const hinweise = [...base.hinweise];
  if (years === 1) {
    hinweise.push("Nutzungsdauer 1 Jahr: Haben schreibt wie sevDesk linear über 12 Monate ab; Computer nach BMF vom 22.02.2022 übernimmst du von Hand");
  }
  if (saleDate) hinweise.push(`In sevDesk am ${dayOf(saleDate)} verkauft: Abgang nach dem Übernehmen auf der Seite der Anlage eintragen`);
  return { ...linear, stand: "uebernehmen", grund: null, hinweise };
}

/** Hinweis, wenn sevDesk ein anderes Anlagekonto führte als Haben für die Art nimmt */
export function sevKontoHinweis(anlage: SevAnlage, kind: AssetKind, kontenrahmen: Kontenrahmen): string | null {
  const sev = anlage.sevKonto?.[kontenrahmen];
  if (!sev || !anlage.method) return null;
  const haben = assetAccount(kind, anlage.method, kontenrahmen);
  return sev === haben ? null : `sevDesk führte die Anlage auf ${sev}, Haben bucht sie auf ${haben}`;
}

/** Vermerk in der Notiz; an ihm erkennt Haben die Anlage bei einem weiteren Abruf wieder */
export const sevAnlageNotiz = (anlage: Pick<SevAnlage, "nummer" | "sevId">) => `Aus sevDesk: Anlage Nr. ${anlage.nummer}, ID ${anlage.sevId}`;

/** Schlüssel einer schon übernommenen Anlage aus ihrer Notiz */
export function sevAnlageKeys(note: string | null): DuplicateKey[] {
  const match = /Aus sevDesk: Anlage Nr\. [^,\n]*, ID (\S+)/.exec(note ?? "");
  return match ? duplicateKey("sevDesk-Anlage ID", match[1]) : [];
}

/** Zeile für die Übernahme mit der gewählten Art; nur für Vorschläge mit Stand „uebernehmen“ */
export function sevAnlageRow(anlage: SevAnlage, kind: AssetKind, openingDate: string): AssetRow {
  if (anlage.stand !== "uebernehmen" || !anlage.acquisitionDate || !anlage.method || anlage.openingBookValue === null) {
    throw new Error(`Anlage ${anlage.nummer} ist kein Vorschlag zum Übernehmen`);
  }
  return {
    name: anlage.name,
    kind,
    method: anlage.method,
    acquisitionDate: anlage.acquisitionDate,
    cost: anlage.cost,
    usefulLifeMonths: anlage.usefulLifeMonths,
    degressiveRate: null,
    openingDate,
    openingBookValue: anlage.openingBookValue,
    note: sevAnlageNotiz(anlage),
  };
}
