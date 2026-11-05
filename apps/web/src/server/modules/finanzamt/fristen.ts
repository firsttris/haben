import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  abgabefrist,
  dauerfristActive,
  dueDate,
  filingPeriodOfMonth,
  frequencyAt,
  isKapitalgesellschaft,
  lastMonthOfPeriod,
  kapestFrist,
  lstaFrist,
  lstaLabel,
  periodKey,
  periodLabel,
  previousPeriod,
  vorauszahlungstermine,
  zmFrist,
  type Bundesland,
  type VatPeriod,
} from "@haben/core";
import { and, eq, min } from "drizzle-orm";
import { kleinunternehmerHistory, lastDayOfMonth, loadCompany } from "../stammdaten/index.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { openAppealDeadlines } from "./postfach.ts";
import { kapestAnmeldungen } from "../ausschuettung/index.ts";
import { lstaZeitraeume } from "../lohn/index.ts";
import { loadActiveCertificate } from "../elster/index.ts";
import { loadDauerfrist, loadFrequencies, zmQuartale } from "../umsatzsteuer/index.ts";
import { svFristen } from "../sv-meldungen/index.ts";

export type FristArt = "ustva" | "zm" | "kapest" | "lsta" | "erklaerung" | "vorauszahlung" | "einspruch" | "zertifikat" | "sv";

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

const FORM_LABEL = {
  ust: "Umsatzsteuererklärung",
  euer: "Anlage EÜR",
  est: "Einkommensteuererklärung",
  kst: "Körperschaftsteuererklärung",
  gewst: "Gewerbesteuererklärung",
  ebilanz: "E-Bilanz",
} as const;
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

  // Umsatzsteuer-Voranmeldungen: jeder Monat ab der ersten Buchung, bis zum letzten mit Fälligkeit im Fenster; nicht in
  // Monaten als Kleinunternehmer. Maßgeblich ist der Stand im Monat, nicht der heutige: Wer zum Jahreswechsel umstellt,
  // schuldet die Voranmeldung für Dezember noch.
  const kleinunternehmerAm = await kleinunternehmerHistory();
  const [frequencies, dauerfrist] = await Promise.all([loadFrequencies(), loadDauerfrist()]);
  {
    const sent = new Set(sentReturns.map((r) => periodKey(r)));
    // Je Monat der Zeitraum, zu dem er gehört (Monat, Quartal oder befreit); ein Zeitraum zählt mit seinem letzten Monat
    const periods: VatPeriod[] = [];
    for (let p = previousPeriod({ year: Number(bis.slice(0, 4)), month: Number(bis.slice(5, 7)) }); periodKey(p) >= start; p = previousPeriod(p)) {
      const period = filingPeriodOfMonth(p, frequencyAt(frequencies, p));
      if (period && lastMonthOfPeriod(period).month === p.month && !kleinunternehmerAm(lastDayOfMonth(p.year, p.month))) periods.unshift(period);
    }
    for (const period of periods) {
      // Mit Dauerfristverlängerung einen Monat später (§ 46 UStDV)
      const datum = dueDate(period, bundesland, dauerfristActive(dauerfrist, period.year));
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

  // Sondervorauszahlung: Bei monatlicher Abgabe mit Dauerfristverlängerung jedes Jahr neu, bis zum gesetzlichen Termin der
  // ersten Voranmeldung, also dem 10. Februar (§ 48 Abs. 2 UStDV). Erledigt, sobald sie für das Jahr eingetragen ist.
  for (let year = Number(start.slice(0, 4)) + 1; year <= Number(bis.slice(0, 4)); year++) {
    if (frequencyAt(frequencies, { year, month: 1 }) !== "monatlich" || !dauerfristActive(dauerfrist, year)) continue;
    const datum = dueDate({ year, month: 1 }, bundesland);
    const erledigt = dauerfrist.some((d) => d.year === year && d.active && d.sondervorauszahlung !== null);
    if (!relevant(datum, !erledigt)) continue;
    fristen.push({
      id: `svz-${year}`,
      art: "ustva",
      datum,
      titel: `Sondervorauszahlung ${year} (Dauerfristverlängerung)`,
      detail: "Anmeldung und Zahlung, ein Elftel der Vorauszahlungen des Vorjahres",
      status: erledigt ? "erledigt" : "offen",
      link: `/umsatzsteuer/${year}-01`,
    });
  }

  // Zusammenfassende Meldung je Quartal mit sonstigen Leistungen ins EU-Ausland, bis zum 25. nach Quartalsende (§ 18a Abs. 2
  // UStG); nur Quartale mit solchen Umsätzen, erledigt mit der ersten Echtübermittlung
  for (const quartal of await zmQuartale()) {
    const datum = zmFrist(quartal.year, quartal.month - 40);
    if (!relevant(datum, !quartal.sent)) continue;
    fristen.push({
      id: `zm-${periodKey(quartal)}`,
      art: "zm",
      datum,
      titel: `Zusammenfassende Meldung ${periodLabel(quartal)}`,
      detail: "Sonstige Leistungen ins EU-Ausland je USt-IdNr. an das BZSt",
      status: quartal.sent ? "erledigt" : "offen",
      link: `/umsatzsteuer/zm/${periodKey(quartal)}`,
    });
  }

  // Jahreserklärungen ohne Steuerberater, ab dem ersten Buchungsjahr
  const sentForms = new Set(sentAnnual.map((s) => `${s.form}-${s.year}`));
  for (let year = Number(start.slice(0, 4)); year <= Number(today.slice(0, 4)); year++) {
    const datum = abgabefrist(year, bundesland);
    // Kleinunternehmer geben erst ab 2024 keine Umsatzsteuererklärung mehr ab (§ 18 Abs. 3 UStG); Stand im Jahr selbst
    const ust = !kleinunternehmerAm(`${year}-12-31`) || year < 2024;
    // GmbH und UG: keine EÜR und keine Einkommensteuer, dafür Körperschaft- und Gewerbesteuer und die E-Bilanz mit der
    // Frist der Steuererklärung (§ 5b EStG, § 149 Abs. 2 AO)
    const person = !isKapitalgesellschaft(company.rechtsform);
    const forms = [
      ...(ust ? (["ust"] as const) : []),
      ...(person ? (["euer"] as const) : (["kst", "gewst", "ebilanz"] as const)),
      ...(person && company.taxpayer.a ? (["est"] as const) : []),
    ];
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
        link: form === "ebilanz" ? `/abschluss/${year}` : `/jahreserklaerung/${year}`,
      });
    }
  }

  // Einkommensteuer-Vorauszahlungen; ob welche festgesetzt sind, steht im Bescheid
  if (company.taxpayer.a && !isKapitalgesellschaft(company.rechtsform)) {
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

  // Kapitalertragsteuer-Anmeldung je Ausschüttung (GmbH, UG), erledigt mit der Echtübermittlung
  if (isKapitalgesellschaft(company.rechtsform)) {
    for (const d of await kapestAnmeldungen()) {
      const datum = kapestFrist(d.zufluss, bundesland);
      if (!relevant(datum, !d.angemeldet)) continue;
      fristen.push({
        id: `kapest-${d.id}`,
        art: "kapest",
        datum,
        titel: `Kapitalertragsteuer-Anmeldung (Zufluss ${d.zufluss.split("-").reverse().join(".")})`,
        detail: "Anmeldung und Zahlung der einbehaltenen Kapitalertragsteuer, Soli und Kirchensteuer",
        status: d.angemeldet ? "erledigt" : "offen",
        link: `/ausschuettungen?jahr=${d.zufluss.slice(0, 4)}`,
      });
    }
  }

  // Lohnsteuer-Anmeldung je Anmeldungszeitraum mit festgeschriebenen Abrechnungen, am 10. nach Ablauf (§ 41a Abs. 1 EStG);
  // erledigt, solange die zuletzt echt übermittelte Anmeldung zu den Abrechnungen passt, sonst offen bis zur Berichtigung
  for (const z of await lstaZeitraeume(today)) {
    const datum = lstaFrist(z, bundesland);
    if (!relevant(datum, !z.angemeldet)) continue;
    fristen.push({
      id: `lsta-${z.key}`,
      art: "lsta",
      datum,
      titel: `Lohnsteuer-Anmeldung ${lstaLabel(z)}${z.gesendet && !z.angemeldet ? " (Berichtigung)" : ""}`,
      detail: "Anmeldung und Zahlung der einbehaltenen Lohnsteuer, Soli und Kirchensteuer",
      status: z.angemeldet ? "erledigt" : "offen",
      link: `/lohn/anmeldung/${z.key}`,
    });
  }

  // Beitragsnachweise und DEÜV-Meldungen im SV-Meldeportal; erledigt mit dem Vermerk „im Portal abgegeben“
  for (const f of await svFristen(today, bis)) {
    if (!relevant(f.datum, !f.erledigt)) continue;
    fristen.push({ id: f.id, art: "sv", datum: f.datum, titel: f.titel, detail: f.detail, status: f.erledigt ? "erledigt" : "offen", link: f.link });
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
  await withActor(actor, (tx) =>
    tx
      .update(schema.company)
      .set({ calendarTokenHash: hashToken(token), updatedAt: new Date() })
      .where(eq(schema.company.id, 1)),
  );
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
