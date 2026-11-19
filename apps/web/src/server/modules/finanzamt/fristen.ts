import type { Bundesland } from "@haben/core";
import { and, eq, inArray, min } from "drizzle-orm";
import { kleinunternehmerHistory, loadCompany } from "../stammdaten/index.ts";
import { db, schema } from "../../db/index.ts";
import { openAppealDeadlines } from "./postfach.ts";
import { loadActiveCertificate } from "../elster/index.ts";
import { loadDauerfrist, loadFrequencies } from "../umsatzsteuer/index.ts";
import {
  type Kontext,
  erklaerungFristen,
  kapestFristen,
  lohnFristen,
  sondervorauszahlungFristen,
  ustvaFristen,
  vorauszahlungFristen,
  zmFristen,
} from "./fristen-arten.ts";

export type FristArt = "ustva" | "zm" | "kapest" | "lsta" | "lstb" | "erklaerung" | "vorauszahlung" | "einspruch" | "zertifikat" | "sv";

export interface Frist {
  /** stabil, auch als UID im Kalender */
  id: string;
  art: FristArt;
  /** JJJJ-MM-TT */
  datum: string;
  titel: string;
  detail: string;
  /** erledigt/offen, wo Haben es weiß; hinweis bei Zahlungen, die Haben nicht nachverfolgt */
  status: "offen" | "erledigt" | "hinweis";
  /** Seite in Haben, auf der sich die Frist erledigen lässt */
  link: string;
}

const TAG = 86_400_000;
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * TAG).toISOString().slice(0, 10);

/**
 * Alle Fristen der letzten 60 Tage bis in einem Jahr, dazu alles Offene aus der Vergangenheit, ab dem ersten
 * Buchungsmonat. Erledigt ist eine Voranmeldung oder Erklärung, sobald sie echt übermittelt oder außerhalb von Haben
 * abgegeben und hier vermerkt ist.
 */
export async function listFristen(today: string): Promise<Frist[]> {
  const [company, certificate, appeals, [first], sentReturns, sentAnnual] = await Promise.all([
    loadCompany(),
    loadActiveCertificate(),
    openAppealDeadlines(today),
    db.select({ date: min(schema.journalEntries.date) }).from(schema.journalEntries),
    db.select({ year: schema.vatReturns.year, month: schema.vatReturns.month }).from(schema.vatReturns).where(eq(schema.vatReturns.status, "sent")),
    db
      .select({ form: schema.annualSubmissions.form, year: schema.annualSubmissions.year })
      .from(schema.annualSubmissions)
      .where(and(inArray(schema.annualSubmissions.kind, ["send", "vermerk"]), eq(schema.annualSubmissions.ok, true))),
  ]);
  const bis = shift(today, 365);
  // Erledigtes der letzten 60 Tage zur Übersicht, Offenes ohne Grenze
  const seit = shift(today, -60);
  const c: Kontext = {
    today,
    bis,
    start: (first?.date ?? today).slice(0, 7),
    bundesland: company.bundesland as Bundesland | null,
    company,
    relevant: (datum: string, offen: boolean) => (datum >= seit || offen) && datum <= bis,
    kleinunternehmerAm: await kleinunternehmerHistory(),
  };
  const [frequencies, dauerfrist] = await Promise.all([loadFrequencies(), loadDauerfrist()]);
  const fristen: Frist[] = [
    ...ustvaFristen(c, sentReturns, frequencies, dauerfrist),
    ...sondervorauszahlungFristen(c, frequencies, dauerfrist),
    ...(await zmFristen(c)),
    ...erklaerungFristen(c, sentAnnual),
    ...vorauszahlungFristen(c),
    ...(await kapestFristen(c)),
    ...(await lohnFristen(c)),
  ];

  for (const appeal of appeals) {
    fristen.push({
      id: `einspruch-${appeal.bereitstellungId}`,
      art: "einspruch",
      datum: appeal.frist!.fristende,
      titel: `Einspruchsfrist: ${appeal.dateibezeichnung || appeal.filename}`,
      detail: `Bescheid${appeal.veranlagungszeitraum ? ` für ${appeal.veranlagungszeitraum}` : ""}, bekannt gegeben am ${appeal.frist!.bekanntgabe}`,
      status: "offen",
      link: "/finanzamt",
    });
  }

  if (certificate?.validUntil && certificate.validUntil <= bis) {
    fristen.push({
      id: `zertifikat-${certificate.id}`,
      art: "zertifikat",
      datum: certificate.validUntil,
      titel: "ELSTER-Zertifikat läuft ab",
      detail: `${certificate.filename}; in Mein ELSTER verlängern und neu hochladen`,
      status: "offen",
      link: "/einstellungen?bereich=elster",
    });
  }

  return fristen.sort((a, b) => a.datum.localeCompare(b.datum) || a.titel.localeCompare(b.titel));
}

const icsText = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n?|\n/g, "\\n");

/** Zeilen nach RFC 5545 höchstens 75 Oktette lang, Fortsetzung mit Leerzeichen */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    if (Buffer.byteLength(current + char, "utf8") > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
    }
    current += char;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/**
 * Offene Fristen als iCalendar: ganztägige Termine mit Erinnerung drei Tage vorher und am Morgen des Tages.
 * Erledigtes fehlt, damit der Kalender nur zeigt, was noch zu tun ist.
 */
export function fristenToIcs(fristen: Frist[], baseUrl: string, now = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Haben//Fristen//DE",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Haben Steuerfristen",
    "X-PUBLISHED-TTL:PT6H",
  ];
  for (const frist of fristen.filter((f) => f.status !== "erledigt")) {
    const day = frist.datum.replace(/-/g, "");
    const next = shift(frist.datum, 1).replace(/-/g, "");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${frist.id}@haben`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day}`,
      `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${icsText(frist.titel)}`,
      `DESCRIPTION:${icsText(frist.detail)}`,
      `URL:${baseUrl}${frist.link}`,
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsText(frist.titel)}`,
      "TRIGGER:-P3D",
      "END:VALARM",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsText(frist.titel)}`,
      "TRIGGER:PT8H",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
