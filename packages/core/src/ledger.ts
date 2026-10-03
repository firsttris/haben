import { csvDecimal, type Cents } from "./money.ts";
import type { Kontenrahmen } from "./posting.ts";

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
