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
  lstbFrist,
  periodKey,
  periodLabel,
  previousPeriod,
  vorauszahlungstermine,
  zmFrist,
  type Bundesland,
  type VatPeriod,
} from "@haben/core";
import { type kleinunternehmerHistory, lastDayOfMonth, type loadCompany } from "../stammdaten/index.ts";
import { kapestAnmeldungen } from "../ausschuettung/index.ts";
import { lstaZeitraeume, lstbJahre } from "../lohn/index.ts";
import { type loadDauerfrist, type loadFrequencies, zmQuartale } from "../umsatzsteuer/index.ts";
import { svFristen } from "../sv-meldungen/index.ts";
import type { Frist } from "./fristen.ts";

/* Fristen je Art für die Übersicht (fristen.ts) */

const FORM_LABEL = {
  ust: "Umsatzsteuererklärung",
  euer: "Anlage EÜR",
  est: "Einkommensteuererklärung",
  kst: "Körperschaftsteuererklärung",
  gewst: "Gewerbesteuererklärung",
  ebilanz: "E-Bilanz",
} as const;

/** Was alle Arten von Fristen brauchen */
export interface Kontext {
  today: string;
  /** Ende des Fensters, ein Jahr ab heute */
  bis: string;
  /** Erster Buchungsmonat (JJJJ-MM) */
  start: string;
  bundesland: Bundesland | null;
  company: Awaited<ReturnType<typeof loadCompany>>;
  /** Im Fenster: Erledigtes der letzten 60 Tage, Offenes ohne Grenze */
  relevant: (datum: string, offen: boolean) => boolean;
  kleinunternehmerAm: Awaited<ReturnType<typeof kleinunternehmerHistory>>;
}

export type Frequencies = Awaited<ReturnType<typeof loadFrequencies>>;
export type Dauerfrist = Awaited<ReturnType<typeof loadDauerfrist>>;

/**
 * Umsatzsteuer-Voranmeldungen: jeder Monat ab der ersten Buchung, bis zum letzten mit Fälligkeit im Fenster; nicht in
 * Monaten als Kleinunternehmer. Maßgeblich ist der Stand im Monat, nicht der heutige: Wer zum Jahreswechsel umstellt,
 * schuldet die Voranmeldung für Dezember noch.
 */
export function ustvaFristen(c: Kontext, sentReturns: { year: number; month: number }[], frequencies: Frequencies, dauerfrist: Dauerfrist): Frist[] {
  const fristen: Frist[] = [];
  const sent = new Set(sentReturns.map((r) => periodKey(r)));
  // Je Monat der Zeitraum, zu dem er gehört (Monat, Quartal oder befreit); ein Zeitraum zählt mit seinem letzten Monat
  const periods: VatPeriod[] = [];
  for (let p = previousPeriod({ year: Number(c.bis.slice(0, 4)), month: Number(c.bis.slice(5, 7)) }); periodKey(p) >= c.start; p = previousPeriod(p)) {
    const period = filingPeriodOfMonth(p, frequencyAt(frequencies, p));
    if (period && lastMonthOfPeriod(period).month === p.month && !c.kleinunternehmerAm(lastDayOfMonth(p.year, p.month))) periods.unshift(period);
  }
  for (const period of periods) {
    // Mit Dauerfristverlängerung einen Monat später (§ 46 UStDV)
    const datum = dueDate(period, c.bundesland, dauerfristActive(dauerfrist, period.year));
    const erledigt = sent.has(periodKey(period));
    if (!c.relevant(datum, !erledigt)) continue;
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
  return fristen;
}

/** Sondervorauszahlungen bei Dauerfristverlängerung */
export function sondervorauszahlungFristen(c: Kontext, frequencies: Frequencies, dauerfrist: Dauerfrist): Frist[] {
  const fristen: Frist[] = [];
  // Sondervorauszahlung: Bei monatlicher Abgabe mit Dauerfristverlängerung jedes Jahr neu, bis zum gesetzlichen Termin der
  // ersten Voranmeldung, also dem 10. Februar (§ 48 Abs. 2 UStDV). Erledigt, sobald sie für das Jahr eingetragen ist.
  for (let year = Number(c.start.slice(0, 4)) + 1; year <= Number(c.bis.slice(0, 4)); year++) {
    if (frequencyAt(frequencies, { year, month: 1 }) !== "monatlich" || !dauerfristActive(dauerfrist, year)) continue;
    const datum = dueDate({ year, month: 1 }, c.bundesland);
    const erledigt = dauerfrist.some((d) => d.year === year && d.active && d.sondervorauszahlung !== null);
    if (!c.relevant(datum, !erledigt)) continue;
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
  return fristen;
}

/** Zusammenfassende Meldungen je Quartal */
export async function zmFristen(c: Kontext): Promise<Frist[]> {
  const fristen: Frist[] = [];
  // Zusammenfassende Meldung je Quartal mit sonstigen Leistungen ins EU-Ausland, bis zum 25. nach Quartalsende (§ 18a Abs. 2
  // UStG); nur Quartale mit solchen Umsätzen, erledigt mit der ersten Echtübermittlung
  for (const quartal of await zmQuartale()) {
    const datum = zmFrist(quartal.year, quartal.month - 40);
    if (!c.relevant(datum, !quartal.sent)) continue;
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
  return fristen;
}

/** Jahreserklärungen ohne Steuerberater */
export function erklaerungFristen(c: Kontext, sentAnnual: { form: string; year: number }[]): Frist[] {
  const fristen: Frist[] = [];
  // Jahreserklärungen ohne Steuerberater, ab dem ersten Buchungsjahr
  const sentForms = new Set(sentAnnual.map((s) => `${s.form}-${s.year}`));
  for (let year = Number(c.start.slice(0, 4)); year <= Number(c.today.slice(0, 4)); year++) {
    const datum = abgabefrist(year, c.bundesland);
    // Kleinunternehmer geben erst ab 2024 keine Umsatzsteuererklärung mehr ab (§ 18 Abs. 3 UStG); Stand im Jahr selbst
    const ust = !c.kleinunternehmerAm(`${year}-12-31`) || year < 2024;
    // GmbH und UG: keine EÜR und keine Einkommensteuer, dafür Körperschaft- und Gewerbesteuer und die E-Bilanz mit der
    // Frist der Steuererklärung (§ 5b EStG, § 149 Abs. 2 AO)
    const person = !isKapitalgesellschaft(c.company.rechtsform);
    const forms = [
      ...(ust ? (["ust"] as const) : []),
      ...(person ? (["euer"] as const) : (["kst", "gewst", "ebilanz"] as const)),
      ...(person && c.company.taxpayer.a ? (["est"] as const) : []),
    ];
    for (const form of forms) {
      const erledigt = sentForms.has(`${form}-${year}`);
      if (!c.relevant(datum, !erledigt)) continue;
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
  return fristen;
}

/** Einkommensteuer-Vorauszahlungen als Hinweis */
export function vorauszahlungFristen(c: Kontext): Frist[] {
  const fristen: Frist[] = [];
  // Einkommensteuer-Vorauszahlungen; ob welche festgesetzt sind, steht im Bescheid. Wer keine zahlt, schaltet die
  // Hinweise in den Einstellungen ab (#1240) und bekommt dann auch keinen Kalendereintrag
  if (c.company.taxpayer.a && !isKapitalgesellschaft(c.company.rechtsform) && !c.company.taxpayer.keineVorauszahlungen) {
    for (const year of [Number(c.today.slice(0, 4)), Number(c.today.slice(0, 4)) + 1]) {
      for (const [index, datum] of vorauszahlungstermine(year, c.bundesland).entries()) {
        if (datum < c.today || datum > c.bis) continue;
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
  return fristen;
}

/** Kapitalertragsteuer-Anmeldungen je Ausschüttung */
export async function kapestFristen(c: Kontext): Promise<Frist[]> {
  const fristen: Frist[] = [];
  // Kapitalertragsteuer-Anmeldung je Ausschüttung (GmbH, UG), erledigt mit der Echtübermittlung
  if (isKapitalgesellschaft(c.company.rechtsform)) {
    for (const d of await kapestAnmeldungen()) {
      const datum = kapestFrist(d.zufluss, c.bundesland);
      if (!c.relevant(datum, !d.angemeldet)) continue;
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
  return fristen;
}

/** Lohnsteuer-Anmeldungen, Lohnsteuerbescheinigungen und Meldungen im SV-Meldeportal */
export async function lohnFristen(c: Kontext): Promise<Frist[]> {
  const fristen: Frist[] = [];
  // Lohnsteuer-Anmeldung je Anmeldungszeitraum mit festgeschriebenen Abrechnungen, am 10. nach Ablauf (§ 41a Abs. 1 EStG);
  // erledigt, solange die zuletzt echt übermittelte Anmeldung zu den Abrechnungen passt, sonst offen bis zur Berichtigung
  for (const z of await lstaZeitraeume(c.today)) {
    const datum = lstaFrist(z, c.bundesland);
    if (!c.relevant(datum, !z.angemeldet)) continue;
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

  // Lohnsteuerbescheinigungen je Jahr mit festgeschriebenen Abrechnungen, bis zum letzten Tag im Februar des Folgejahres
  // (§ 93c Abs. 1 Nr. 1 AO); erledigt, wenn für jeden Arbeitnehmer eine passende Bescheinigung übermittelt ist
  for (const j of await lstbJahre(c.today)) {
    const datum = lstbFrist(j.year, c.bundesland);
    if (!c.relevant(datum, !j.erledigt)) continue;
    fristen.push({
      id: `lstb-${j.year}`,
      art: "lstb",
      datum,
      titel: `Lohnsteuerbescheinigungen ${j.year}`,
      detail: "Elektronische Lohnsteuerbescheinigung je Arbeitnehmer (§ 41b EStG) und Ausdruck für den Arbeitnehmer",
      status: j.erledigt ? "erledigt" : "offen",
      link: `/lohn/bescheinigung/${j.year}`,
    });
  }

  // Beitragsnachweise und DEÜV-Meldungen im SV-Meldeportal; erledigt mit dem Vermerk „im Portal abgegeben“
  for (const f of await svFristen(c.today, c.bis)) {
    if (!c.relevant(f.datum, !f.erledigt)) continue;
    fristen.push({ id: f.id, art: "sv", datum: f.datum, titel: f.titel, detail: f.detail, status: f.erledigt ? "erledigt" : "offen", link: f.link });
  }
  return fristen;
}
