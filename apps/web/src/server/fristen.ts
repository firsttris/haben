import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  abgabefrist,
  dueDate,
  periodKey,
  periodLabel,
  previousPeriod,
  vorauszahlungstermine,
  type Bundesland,
  type VatPeriod,
} from "@haben/core";
import { and, eq, min } from "drizzle-orm";
import { loadCompany } from "./company.ts";
import { withActor } from "./db/actor.ts";
import { db, schema } from "./db/index.ts";
import { openAppealDeadlines } from "./postfach.ts";
import { loadActiveCertificate } from "./vat.ts";

export type FristArt = "ustva" | "erklaerung" | "vorauszahlung" | "einspruch" | "zertifikat";

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

const FORM_LABEL = { ust: "Umsatzsteuererklärung", euer: "Anlage EÜR", est: "Einkommensteuererklärung" } as const;
const TAG = 86_400_000;
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * TAG).toISOString().slice(0, 10);

/**
 * Alle Fristen der letzten 60 Tage bis in einem Jahr, dazu alles Offene aus der Vergangenheit, ab dem ersten
 * Buchungsmonat. Erledigt ist eine Voranmeldung oder Erklärung, sobald sie echt übermittelt ist.
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
      .where(and(eq(schema.annualSubmissions.kind, "send"), eq(schema.annualSubmissions.ok, true))),
  ]);
  const bundesland = company.bundesland as Bundesland | null;
  const bis = shift(today, 365);
  // Erledigtes der letzten 60 Tage zur Übersicht, Offenes ohne Grenze
  const seit = shift(today, -60);
  const start = (first?.date ?? today).slice(0, 7);
  const fristen: Frist[] = [];
  const relevant = (datum: string, offen: boolean) => (datum >= seit || offen) && datum <= bis;

  // Umsatzsteuer-Voranmeldungen: jeder Monat ab der ersten Buchung, bis zum letzten mit Fälligkeit im Fenster
  if (!company.kleinunternehmer) {
    const sent = new Set(sentReturns.map((r) => periodKey(r)));
    const periods: VatPeriod[] = [];
    for (let p = previousPeriod({ year: Number(bis.slice(0, 4)), month: Number(bis.slice(5, 7)) }); periodKey(p) >= start; p = previousPeriod(p)) {
      periods.unshift(p);
    }
    for (const period of periods) {
      const datum = dueDate(period, bundesland);
      const erledigt = sent.has(periodKey(period));
      if (!relevant(datum, !erledigt)) continue;
      fristen.push({
        id: `ustva-${periodKey(period)}`,
        art: "ustva",
        datum,
        titel: `Umsatzsteuer-Voranmeldung ${periodLabel(period)}`,
        detail: "Abgabe und Zahlung der Zahllast",
        status: erledigt ? "erledigt" : "offen",
        link: `/umsatzsteuer/${periodKey(period)}`,
      });
    }
  }

  // Jahreserklärungen ohne Steuerberater, ab dem ersten Buchungsjahr
  const sentForms = new Set(sentAnnual.map((s) => `${s.form}-${s.year}`));
  for (let year = Number(start.slice(0, 4)); year <= Number(today.slice(0, 4)); year++) {
    const datum = abgabefrist(year, bundesland);
    // Kleinunternehmer geben erst ab 2024 keine Umsatzsteuererklärung mehr ab (§ 18 Abs. 3 UStG)
    const ust = !company.kleinunternehmer || year < 2024;
    const forms = [...(ust ? (["ust"] as const) : []), "euer" as const, ...(company.taxpayer.a ? (["est"] as const) : [])];
    for (const form of forms) {
      const erledigt = sentForms.has(`${form}-${year}`);
      if (!relevant(datum, !erledigt)) continue;
      fristen.push({
        id: `${form}-${year}`,
        art: "erklaerung",
        datum,
        titel: `${FORM_LABEL[form]} ${year}`,
        detail: "Abgabefrist ohne Steuerberater",
        status: erledigt ? "erledigt" : "offen",
        link: `/jahreserklaerung/${year}`,
      });
    }
  }

  // Einkommensteuer-Vorauszahlungen; ob welche festgesetzt sind, steht im Bescheid
  if (company.taxpayer.a) {
    for (const year of [Number(today.slice(0, 4)), Number(today.slice(0, 4)) + 1]) {
      for (const [index, datum] of vorauszahlungstermine(year, bundesland).entries()) {
        if (datum < today || datum > bis) continue;
        fristen.push({
          id: `vz-${year}-q${index + 1}`,
          art: "vorauszahlung",
          datum,
          titel: `Einkommensteuer-Vorauszahlung ${index + 1}/${year}`,
          detail: "falls im Bescheid festgesetzt; Betrag laut Vorauszahlungsbescheid",
          status: "hinweis",
          link: "/finanzamt",
        });
      }
    }
  }

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
      link: "/einstellungen",
    });
  }

  return fristen.sort((a, b) => a.datum.localeCompare(b.datum) || a.titel.localeCompare(b.titel));
}

/* Kalender-Abo: Kalender-Apps können sich nicht anmelden, deshalb ein geheimer Link. Gespeichert ist nur der Hash. */

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Erzeugt einen neuen Abo-Link; ein alter wird damit ungültig. Das Token gibt es nur dieses eine Mal. */
export async function createCalendarToken(actor: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await loadCompany();
  await withActor(actor, (tx) => tx.update(schema.company).set({ calendarTokenHash: hashToken(token), updatedAt: new Date() }).where(eq(schema.company.id, 1)));
  return token;
}

export async function revokeCalendarToken(actor: string): Promise<void> {
  await withActor(actor, (tx) => tx.update(schema.company).set({ calendarTokenHash: null, updatedAt: new Date() }).where(eq(schema.company.id, 1)));
}

export async function calendarTokenActive(): Promise<boolean> {
  return Boolean((await loadCompany()).calendarTokenHash);
}

export async function checkCalendarToken(token: string): Promise<boolean> {
  const stored = (await loadCompany()).calendarTokenHash;
  if (!stored || !token) return false;
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(stored, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

const icsText = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

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
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Haben//Fristen//DE", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Haben Steuerfristen", "X-PUBLISHED-TTL:PT6H"];
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
