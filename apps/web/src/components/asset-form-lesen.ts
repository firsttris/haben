import {
  allowsMemoValue,
  amountError,
  type AssetKind,
  type AssetMethod,
  type CarDrive,
  type CarPrivateUse,
  formatDecimal,
  formatDegressiveRate,
  maxDegressiveRate,
  parseEuro,
  type PrivateUseRate,
  privateUseMonth,
  suggestedPrivateUseRate,
  usesUsefulLife,
} from "@haben/core";
import { parseUsefulLifeMonths } from "../lib/format.ts";
import { parseRatePercent, ratePercentText } from "./AssetMethodOptions.tsx";
import type { AssetFormValues } from "./AssetForm.tsx";

/*
 * Stand des Formulars für eine Anlage (AssetForm.tsx) und was daraus folgt: gelesene Beträge, Vorschlag für die
 * Privatnutzung, Fehler je Feld und die Werte zum Speichern. Ohne React, damit es sich für sich prüfen lässt.
 */

/** Bearbeitbarer Stand; Beträge, Jahre und Satz als getippter Text */
export type AssetState = {
  name: string;
  kind: AssetKind;
  method: AssetMethod;
  acquisitionDate: string;
  cost: string;
  years: string;
  rateText: string;
  linearFrom: string;
  memoValue: boolean;
  openingDate: string;
  openingBookValue: string;
  disposalDate: string;
  note: string;
  privateUsed: boolean;
  listPrice: string;
  drive: CarDrive;
  rate: PrivateUseRate;
  /** Satz von Hand gewählt; sonst folgt er dem Vorschlag */
  rateTouched: boolean;
  vat: boolean;
};

export function assetState(initial: AssetFormValues): AssetState {
  return {
    name: initial.name,
    kind: initial.kind,
    method: initial.method,
    acquisitionDate: initial.acquisitionDate,
    cost: initial.cost ? formatDecimal(initial.cost) : "",
    years: initial.usefulLifeMonths ? String(initial.usefulLifeMonths / 12) : "",
    rateText: ratePercentText(initial.degressiveRate),
    linearFrom: initial.linearFromYear ? String(initial.linearFromYear) : "",
    memoValue: initial.memoValue,
    openingDate: initial.openingDate,
    openingBookValue: initial.openingDate ? formatDecimal(initial.openingBookValue) : "",
    disposalDate: initial.disposalDate ?? "",
    note: initial.note,
    privateUsed: initial.privateUse !== null,
    listPrice: initial.privateUse ? formatDecimal(initial.privateUse.listPrice) : "",
    drive: initial.privateUse?.drive ?? "elektro",
    rate: initial.privateUse?.rate ?? 25,
    rateTouched: initial.privateUse !== null,
    vat: initial.privateUse?.vat ?? true,
  };
}

export type AssetErrorKey = "name" | "acquisitionDate" | "cost" | "years" | "rate" | "linearFrom" | "openingDate" | "opening" | "listPrice";

function privateUseOf(v: AssetState) {
  const parsedListPrice = parseEuro(v.listPrice);
  // Satz folgt Antrieb, Listenpreis und Anschaffungsdatum, bis er von Hand gewählt wurde (ohne Datum: 1 %)
  const suggestion = suggestedPrivateUseRate(v.drive, parsedListPrice ?? 0, v.acquisitionDate);
  const effectiveRate = v.rateTouched ? v.rate : suggestion;
  const privateUse: CarPrivateUse | null =
    v.kind === "kfz" && v.privateUsed && parsedListPrice ? { listPrice: parsedListPrice, drive: v.drive, rate: effectiveRate, vat: v.vat } : null;
  const privateUseValid = v.kind !== "kfz" || !v.privateUsed || (parsedListPrice !== null && parsedListPrice > 0);
  return { suggestion, effectiveRate, privateUse, privateUseValid, monthly: privateUse ? privateUseMonth(privateUse) : null };
}

/** Alles, was das Formular aus dem Stand braucht; `values` ist null, solange ein Feld nicht stimmt */
export function readAsset(v: AssetState, showOpening: boolean) {
  const parsedCost = parseEuro(v.cost);
  const parsedOpening = parseEuro(v.openingBookValue);
  const lifeMonths = parseUsefulLifeMonths(v.years);
  const lifeValid = !usesUsefulLife(v.method) || lifeMonths !== null;
  const parsedRate = parseRatePercent(v.rateText);
  const linearFrom = v.linearFrom.trim();
  const parsedLinearFrom = /^\d{4}$/.test(linearFrom) ? Number(linearFrom) : linearFrom ? Number.NaN : null;
  const privat = privateUseOf(v);
  // Über dem Höchstsatz (§ 7 Abs. 2 EStG) ist ein Fehler am Satz, wie der Hinweis darunter sagt
  const maxRate = v.method === "degressiv" && v.acquisitionDate && lifeMonths ? maxDegressiveRate(v.acquisitionDate, lifeMonths) : null;
  const rateAboveMax =
    parsedRate !== null && maxRate !== null && parsedRate > maxRate ? `Höchstens ${formatDegressiveRate(maxRate)}; leer lassen für den Höchstsatz.` : null;
  const errors: Record<AssetErrorKey, string | null> = {
    name: v.name.trim() === "" ? "Trag eine Bezeichnung ein." : null,
    acquisitionDate: v.acquisitionDate ? null : "Wähle das Anschaffungsdatum.",
    cost: parsedCost !== null && parsedCost > 0 ? null : amountError("die Anschaffungskosten netto", 120_000),
    years: lifeValid ? null : "Trag die Nutzungsdauer in Jahren ein, etwa 3 oder 2,5.",
    rate: v.method !== "degressiv" ? null : Number.isNaN(parsedRate) ? "Trag den Satz als Zahl ein, etwa 20 oder 23,07." : rateAboveMax,
    linearFrom: v.method === "degressiv" && Number.isNaN(parsedLinearFrom) ? "Trag das Jahr vierstellig ein, etwa 2027." : null,
    openingDate: showOpening && !v.openingDate ? "Wähle den Übernahmestichtag." : null,
    opening: showOpening && (parsedOpening === null || parsedOpening < 0) ? amountError("den Restbuchwert", 85_000) : null,
    listPrice: privat.privateUseValid ? null : amountError("den Bruttolistenpreis", 4_500_000),
  };
  const degressiveValid = v.method !== "degressiv" || (!Number.isNaN(parsedRate) && !Number.isNaN(parsedLinearFrom));
  const valid =
    privat.privateUseValid &&
    v.name.trim() !== "" &&
    Boolean(v.acquisitionDate) &&
    parsedCost !== null &&
    parsedCost > 0 &&
    lifeValid &&
    degressiveValid &&
    (!showOpening || (Boolean(v.openingDate) && parsedOpening !== null && parsedOpening >= 0));
  const values: AssetFormValues | null = valid
    ? {
        name: v.name.trim(),
        kind: v.kind,
        method: v.method,
        acquisitionDate: v.acquisitionDate,
        cost: parsedCost!,
        usefulLifeMonths: usesUsefulLife(v.method) ? lifeMonths : null,
        degressiveRate: v.method === "degressiv" ? parsedRate : null,
        linearFromYear: v.method === "degressiv" ? parsedLinearFrom : null,
        // Ein ausgeblendetes Häkchen (GWG, Sammelposten, Computer) geht nicht mit
        memoValue: allowsMemoValue(v.method) && v.memoValue,
        openingDate: v.openingDate,
        openingBookValue: parsedOpening ?? 0,
        disposalDate: v.disposalDate || null,
        privateUse: privat.privateUse,
        note: v.note,
      }
    : null;
  return { lifeMonths, suggestion: privat.suggestion, effectiveRate: privat.effectiveRate, monthly: privat.monthly, errors, values };
}
