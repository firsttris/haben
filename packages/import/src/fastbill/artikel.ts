import type { FbArticle } from "./types.ts";

/*
 * Artikel aus FastBill (article.get) als CSV für den Artikel-Import von Haben (docs/csv-import.md#artikel). Die Spalten
 * heißen wie die Felder des Imports, damit er sie von selbst zuordnet; Prüfung, Vorschau und Dubletten bleiben dort.
 *
 * UNIT_PRICE ist in FastBill immer netto, auch wenn der Preis brutto eingegeben wurde (IS_GROSS 1; beobachtet an einem
 * echten Konto, November 2026, mit vier Nachkommastellen, etwa 84,0336 für 100,00 € bei 19 %). Dann bekommt Haben einen Artikel mit Endpreis, den Bruttopreis aus
 * UNIT_PRICE und VAT_PERCENT ohne Gleitkomma auf den Cent gerundet. Ein Preis in anderer Währung steht mit ihrem Kürzel
 * in der Zelle, damit der Import ihn als Fehler meldet, statt ihn als Euro zu lesen.
 */

const HEADER = ["Artikelnummer", "Bezeichnung", "Beschreibung", "Einheit", "Nettopreis", "Bruttopreis", "Steuersatz"];

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());

/** Dezimalzahl als ganze Zahl und Zehnerpotenz: „84.0336“ → 840336 / 10⁴. Komma wie Punkt; sonst null. */
function decimal(value: unknown): { units: bigint; scale: bigint } | null {
  const raw = text(value).replace(",", ".");
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return null;
  const fraction = match[3] ?? "";
  return { units: BigInt(`${match[1]}${match[2]}${fraction}`), scale: 10n ** BigInt(fraction.length) };
}

/** Kaufmännisch gerundet (halbe Cent vom Nullpunkt weg), Nenner positiv */
function roundDiv(numerator: bigint, denominator: bigint): bigint {
  const sign = numerator < 0n ? -1n : 1n;
  return sign * ((2n * sign * numerator + denominator) / (2n * denominator));
}

/** Cent als „1234,56“ wie im Artikel-Import */
function euro(cents: bigint): string {
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n},${String(abs % 100n).padStart(2, "0")}`;
}

/** Netto- und Bruttopreis für die CSV; einer von beiden bleibt leer */
function prices(a: FbArticle): { net: string; gross: string } {
  const price = decimal(a.UNIT_PRICE);
  if (!price) return { net: text(a.UNIT_PRICE), gross: "" };
  const currency = text(a.CURRENCY_CODE).toUpperCase();
  const foreign = currency && currency !== "EUR" ? ` ${currency}` : "";
  const rate = decimal(a.VAT_PERCENT);
  if (text(a.IS_GROSS) === "1" && rate) {
    // netto · (1 + Satz / 100) in Cent: units/scale · (100·rScale + rUnits)/(100·rScale) · 100
    const gross = roundDiv(price.units * (100n * rate.scale + rate.units), price.scale * rate.scale);
    return { net: "", gross: `${euro(gross)}${foreign}` };
  }
  return { net: `${euro(roundDiv(price.units * 100n, price.scale))}${foreign}`, gross: "" };
}

/** Steuersatz ohne Nachkommastellen, wenn er ganz ist („19.00“ → „19“) */
function rate(a: FbArticle): string {
  const value = decimal(a.VAT_PERCENT);
  if (!value || value.units % value.scale !== 0n) return text(a.VAT_PERCENT);
  return String(value.units / value.scale);
}

const cell = (value: string) => (/[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export function fbArticlesCsv(articles: readonly FbArticle[]): string {
  const rows = articles.map((a) => {
    const { net, gross } = prices(a);
    return [text(a.ARTICLE_NUMBER), text(a.TITLE), text(a.DESCRIPTION), text(a.UNIT), net, gross, rate(a)];
  });
  // Mit BOM, damit Excel die Datei als UTF-8 öffnet, wenn sie jemand herunterlädt
  return `﻿${[HEADER, ...rows].map((r) => r.map(cell).join(";")).join("\r\n")}\r\n`;
}
