import { ITEM_NUMBER_MAX, LINE_DETAIL_MAX, TAX_RATES, UNITS, type TaxRate } from "@haben/core";
import { parseImportUnit } from "../csv-import/values.ts";
import { lexToBasisPoints, lexToCents } from "../lexoffice/map.ts";
import { sevNumber } from "./map.ts";
import type { SevPart, SevUnity } from "./types.ts";
import { sevPlainText } from "./vorlagen.ts";

/*
 * Artikel aus sevDesk (GET /Part) als Artikel von Haben. Felder nach dem Schema Model_Part der OpenAPI
 * (https://api.sevdesk.de/openapi.yaml); die Einheit nennt ein Artikel nur als ID, Bezeichnung und UN/ECE-Code stehen
 * unter GET /Unity. Was Haben nicht abbilden kann, erfindet die Abbildung nicht: Ein Artikel ohne passende Einheit oder
 * mit anderem Steuersatz als 19, 7 oder 0 % bleibt mit Grund draußen, Angaben ohne Feld in Haben nennt sie.
 */

/** Längen wie im Formular (articleInputSchema): Bezeichnung und interne Notiz */
const DESCRIPTION_MAX = 500;
const NOTE_MAX = 1000;

/** Feste oder eigene Einheit von Haben mit ihrem Code nach UN/ECE Rec. 20/21 */
export interface SevUnitOption {
  label: string;
  code: string;
}

export interface SevArticle {
  sevdeskId: string;
  number: string;
  description: string;
  detail: string;
  unit: string;
  unitPrice: number;
  taxRate: TaxRate;
  priceIncludesTax: boolean;
  note: string;
  /** status 50 in sevDesk: in Haben archiviert */
  archived: boolean;
}

export type SevArticleResult =
  | { ok: true; article: SevArticle /** Angaben aus sevDesk ohne Feld in Haben, z. B. „Einkaufspreis“ */; ignored: string[] }
  | { ok: false; reason: string };

/**
 * Einheit von Haben zur Einheit eines Artikels: erst an der Bezeichnung wie beim CSV-Import („Stk“, „Stunde“, eigene
 * Einheiten), sonst am UN/ECE-Code, wenn genau eine Einheit von Haben ihn hat (sevDesk „Tag(e)“ mit DAY → „Tag“).
 * Ohne Treffer null: Die Einheit muss erst in Haben angelegt werden.
 */
export function resolveSevUnity(unity: SevUnity | undefined, own: readonly SevUnitOption[]): string | null {
  if (!unity) return null;
  const byName = parseImportUnit(
    unity.name ?? "",
    own.map((u) => u.label),
  );
  if (byName.ok) return byName.value;
  const code = unity.uneceTradeUnitCode?.trim().toUpperCase();
  if (!code) return null;
  const fixed = Object.entries(UNITS).map(([label, c]) => ({ label, code: c as string }));
  const matches = [...fixed, ...own].filter((u) => u.code.toUpperCase() === code);
  return matches.length === 1 ? matches[0]!.label : null;
}

function isSet(value: unknown): boolean {
  return value != null && value !== "" && value !== false && value !== "0" && value !== 0;
}

/** unity: die Einheit aus GET /Unity zur ID des Artikels; own: feste und eigene Einheiten von Haben */
export function mapSevPart(raw: SevPart, unity: SevUnity | undefined, own: readonly SevUnitOption[]): SevArticleResult {
  const description = (raw.name ?? "").trim();
  if (!description) return { ok: false, reason: "Bezeichnung fehlt" };
  const number = (raw.partNumber ?? "").trim();
  const detail = sevPlainText(raw.text);
  const note = (raw.internalComment ?? "").trim();
  if (number.length > ITEM_NUMBER_MAX) return { ok: false, reason: `Artikelnummer länger als ${ITEM_NUMBER_MAX} Zeichen` };
  if (description.length > DESCRIPTION_MAX) return { ok: false, reason: `Bezeichnung länger als ${DESCRIPTION_MAX} Zeichen` };
  if (detail.length > LINE_DETAIL_MAX) return { ok: false, reason: `Beschreibung länger als ${LINE_DETAIL_MAX} Zeichen` };
  if (note.length > NOTE_MAX) return { ok: false, reason: `Interner Kommentar länger als ${NOTE_MAX} Zeichen` };

  const rate = lexToBasisPoints(sevNumber(raw.taxRate));
  if (!(TAX_RATES as readonly number[]).includes(rate)) return { ok: false, reason: `Steuersatz ${sevNumber(raw.taxRate)} %; Haben kennt 19, 7 und 0 %` };

  const unit = resolveSevUnity(unity, own);
  if (!unit) {
    const name = unity?.name?.trim();
    return {
      ok: false,
      reason: name
        ? `Einheit „${name}“ gibt es in Haben nicht; unter Einstellungen › Rechnungen › Einheiten anlegen und erneut abrufen`
        : "Einheit in sevDesk nicht gefunden",
    };
  }

  // price ist laut OpenAPI der Nettopreis wie priceNet; nur ohne Nettopreis gilt der Bruttopreis (Artikel mit Endpreis)
  const given = (v: string | number | null | undefined) => v != null && v !== "";
  const net = [raw.priceNet, raw.price].find(given);
  const priceIncludesTax = net === undefined && given(raw.priceGross);
  // Ganz ohne Preis 0 wie in sevDesk, das leere Preise als 0,00 € zeigt
  const unitPrice = lexToCents(sevNumber(priceIncludesTax ? raw.priceGross : net));

  const ignored: string[] = [];
  if (sevNumber(raw.pricePurchase) !== 0) ignored.push("Einkaufspreis");
  if (isSet(raw.stockEnabled)) ignored.push("Lagerbestand");
  if (isSet(raw.image)) ignored.push("Bild");

  return {
    ok: true,
    article: {
      sevdeskId: String(raw.id),
      number,
      description,
      detail,
      unit,
      unitPrice,
      taxRate: rate as TaxRate,
      priceIncludesTax,
      note,
      archived: sevNumber(raw.status) === 50,
    },
    ignored,
  };
}
