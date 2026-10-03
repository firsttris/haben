import { csvDecimal, type Cents } from "./money.ts";
import { ACCOUNTS, type Kontenrahmen } from "./posting.ts";

/** Kontenklassen nach der ersten Ziffer der Kontonummer */
export const KONTENKLASSEN: Record<Kontenrahmen, Record<string, string>> = {
  SKR03: {
    "0": "Anlage- und Kapitalkonten",
    "1": "Finanz- und Privatkonten",
    "2": "Abgrenzungskonten",
    "3": "Wareneingangs- und Bestandskonten",
    "4": "Betriebliche Aufwendungen",
    "7": "Bestände an Erzeugnissen",
    "8": "Erlöskonten",
    "9": "Vortrags- und statistische Konten",
  },
  SKR04: {
    "0": "Anlagevermögen",
    "1": "Umlaufvermögen",
    "2": "Eigenkapital",
    "3": "Fremdkapital",
    "4": "Betriebliche Erträge",
    "5": "Betriebliche Aufwendungen (Material, Waren)",
    "6": "Betriebliche Aufwendungen",
    "7": "Weitere Erträge und Aufwendungen",
    "9": "Vortrags- und statistische Konten",
  },
};

export function kontenklasse(kontenrahmen: Kontenrahmen, account: string): string {
  return KONTENKLASSEN[kontenrahmen][account.charAt(0)] ?? "Sonstige Konten";
}

export type Kontoart = "ertrag" | "aufwand" | "bestand";

/**
 * Art eines Kontos nach Kontenklasse: Erlöse, Aufwand oder Bestand (Bank, Forderungen, Steuern,
 * Privat). Klassen mit gemischtem Inhalt (SKR03 2, SKR04 7) ordnet die Seite des Saldos zu.
 */
export function kontoart(kontenrahmen: Kontenrahmen, account: string, saldo = 0): Kontoart {
  const klasse = account.charAt(0);
  const gemischt = saldo < 0 ? "ertrag" : "aufwand";
  if (kontenrahmen === "SKR03") {
    if (klasse === "8") return "ertrag";
    if (klasse === "3" || klasse === "4") return "aufwand";
    if (klasse === "2") return gemischt;
    return "bestand";
  }
  if (klasse === "4") return "ertrag";
  if (klasse === "5" || klasse === "6") return "aufwand";
  if (klasse === "7") return gemischt;
  return "bestand";
}

export interface SaldoAnzeige {
  /** Betrag aus Sicht des Kontos: Erlöse und Aufwand positiv, Bestände ohne Vorzeichen */
  betrag: Cents;
  /** Erläuterung für Bestandskonten, sonst leer */
  hinweis: "Guthaben" | "Schuld" | "";
}

/** Saldo so, wie man ihn ohne Buchhaltungswissen liest */
export function saldoAnzeige(kontenrahmen: Kontenrahmen, account: string, saldo: Cents): SaldoAnzeige {
  const art = kontoart(kontenrahmen, account, saldo);
  if (art === "ertrag") return { betrag: -saldo, hinweis: "" };
  if (art === "aufwand") return { betrag: saldo, hinweis: "" };
  return { betrag: Math.abs(saldo), hinweis: saldo > 0 ? "Guthaben" : saldo < 0 ? "Schuld" : "" };
}

export interface Kontenkennzahlen {
  /** Bankkonto laut Buchungen ab Jahresbeginn (ohne Vortrag aus dem Vorjahr) */
  bank: Cents;
  forderungen: Cents;
  verbindlichkeiten: Cents;
  /** Fällige Umsatzsteuer abzüglich Vorsteuer und geleisteter Vorauszahlungen; negativ = Erstattung */
  umsatzsteuer: Cents;
  /** Erlöse und Aufwand im Zeitraum */
  ertraege: Cents;
  aufwand: Cents;
}

/** Kennzahlen für die Kacheln über der Saldenliste */
export function kontenkennzahlen(rows: SaldenZeile[]): Kontenkennzahlen {
  const result: Kontenkennzahlen = { bank: 0, forderungen: 0, verbindlichkeiten: 0, umsatzsteuer: 0, ertraege: 0, aufwand: 0 };
  for (const r of rows) {
    const a = ACCOUNTS[r.kontenrahmen];
    const steuer = [...Object.values(a.ust), ...Object.values(a.vorsteuer), a.ustVorauszahlung] as string[];
    if (r.account === a.bank) result.bank += r.saldo;
    else if (r.account === a.forderungen) result.forderungen += r.saldo;
    else if (r.account === a.verbindlichkeiten) result.verbindlichkeiten -= r.saldo;
    else if (steuer.includes(r.account)) result.umsatzsteuer -= r.saldo;
    const art = kontoart(r.kontenrahmen, r.account, r.saldo);
    if (art === "ertrag") result.ertraege += r.haben - r.soll;
    if (art === "aufwand") result.aufwand += r.soll - r.haben;
  }
  return result;
}

/** Saldo mit Seite wie in der Buchhaltung üblich: 1.234,00 S oder 56,00 H */
export function saldoSeite(saldo: Cents): "S" | "H" | "" {
  return saldo > 0 ? "S" : saldo < 0 ? "H" : "";
}

export interface SaldenZeile {
  kontenrahmen: Kontenrahmen;
  account: string;
  name: string;
  /** Saldo vor dem Zeitraum, ab Jahresbeginn; positiv = Soll */
  eroeffnung: Cents;
  soll: Cents;
  haben: Cents;
  /** eroeffnung + soll − haben */
  saldo: Cents;
}

export interface KontenblattZeile {
  date: string;
  description: string;
  /** Gegenkonten derselben Buchung */
  gegenkonten: string[];
  soll: Cents;
  haben: Cents;
  /** Laufender Saldo nach der Zeile */
  saldo: Cents;
}

function csvField(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const csv = (rows: string[][]) => "﻿" + rows.map((r) => r.map(csvField).join(";")).join("\r\n") + "\r\n";

export function saldenlisteToCsv(rows: SaldenZeile[]): string {
  return csv([
    ["Konto", "Bezeichnung", "Kontenklasse", "Eröffnung (EUR)", "Soll (EUR)", "Haben (EUR)", "Saldo (EUR)", "S/H"],
    ...rows.map((r) => [
      r.account,
      r.name,
      kontenklasse(r.kontenrahmen, r.account),
      csvDecimal(Math.abs(r.eroeffnung)) + (r.eroeffnung ? ` ${saldoSeite(r.eroeffnung)}` : ""),
      csvDecimal(r.soll),
      csvDecimal(r.haben),
      csvDecimal(Math.abs(r.saldo)),
      saldoSeite(r.saldo),
    ]),
  ]);
}

export function kontenblattToCsv(eroeffnung: Cents, rows: KontenblattZeile[]): string {
  return csv([
    ["Datum", "Buchungstext", "Gegenkonto", "Soll (EUR)", "Haben (EUR)", "Saldo (EUR)", "S/H"],
    ["", "Eröffnung", "", "", "", csvDecimal(Math.abs(eroeffnung)), saldoSeite(eroeffnung)],
    ...rows.map((r) => [r.date, r.description, r.gegenkonten.join(", "), r.soll ? csvDecimal(r.soll) : "", r.haben ? csvDecimal(r.haben) : "", csvDecimal(Math.abs(r.saldo)), saldoSeite(r.saldo)]),
  ]);
}
