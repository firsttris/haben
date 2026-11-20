import { dauerfristActive, type DauerfristSetting } from "./dauerfrist.ts";
import { vorauszahlungstermine } from "./fristen.ts";
import { addDays, naechsterWerktag } from "./holidays.ts";
import { postenAus, type LiquiditaetsPosten, type Sicherheit } from "./liquiditaet.ts";
import type { Cents } from "./money.ts";
import { dueDate, periodKey, periodLabel, periodRange, type VatPeriod } from "./period.ts";
import type { Steuerart } from "./steuerzahlung.ts";
import type { Bundesland } from "./steuernummer.ts";
import { filingPeriodOfMonth, frequencyAt, type VatFrequencySetting } from "./voranmeldungszeitraum.ts";

/*
 * Steuern in der Liquiditätsvorschau (#1381): Termine der Vorauszahlungen, die Umsatzsteuer noch nicht abgegebener
 * Voranmeldungszeiträume und die Sondervorauszahlung. Fällt ein Termin auf ein Wochenende oder einen Feiertag, gilt der
 * nächste Werktag (§ 108 Abs. 3 AO), wie bei den übrigen Fristen (fristen.ts).
 */

/** Gewerbesteuer-Vorauszahlungen: 15. Februar, Mai, August und November (§ 19 Abs. 1 Satz 1 GewStG) */
export function gewerbesteuertermine(year: number, bundesland: Bundesland | null): string[] {
  return ["02", "05", "08", "11"].map((month) => naechsterWerktag(`${year}-${month}-15`, bundesland));
}

/** Steuerarten mit Vorauszahlungen */
export type VorauszahlungsArt = Extract<Steuerart, "est" | "soli" | "kist" | "kst" | "gewst">;
export const VORAUSZAHLUNGS_ARTEN: readonly VorauszahlungsArt[] = ["est", "soli", "kist", "kst", "gewst"];

/**
 * Termine einer Steuerart zwischen `von` und `bis` (beide einschließlich). Einkommensteuer am 10. März, Juni, September
 * und Dezember (§ 37 Abs. 1 EStG), Solidaritätszuschlag und Kirchensteuer als Zuschlag mit ihr (§ 51a Abs. 1 EStG, § 1
 * Abs. 2 SolZG); Körperschaftsteuer an denselben Tagen (§ 31 Abs. 1 KStG verweist auf das EStG); Gewerbesteuer nach
 * `gewerbesteuertermine`.
 */
export function vorauszahlungsTermineZwischen(art: VorauszahlungsArt, von: string, bis: string, bundesland: Bundesland | null): string[] {
  const termine: string[] = [];
  for (let year = Number(von.slice(0, 4)); year <= Number(bis.slice(0, 4)); year++) {
    termine.push(...(art === "gewst" ? gewerbesteuertermine(year, bundesland) : vorauszahlungstermine(year, bundesland)));
  }
  return termine.filter((t) => t >= von && t <= bis);
}

/**
 * Abstand, ab dem ein Termin nach der letzten Zahlung als noch offen gilt. Die Termine liegen drei Monate auseinander; eine
 * Zahlung bis zu 30 Tage vor ihrem Termin deckt ihn noch ab, eine spätere Zahlung steht ohnehin nach ihm.
 */
const DECKT_TERMIN_TAGE = 30;

/**
 * Künftige Vorauszahlungen einer Steuerart im Horizont, je Termin derselbe Betrag. Vorschlag in #1381 bis zur Eingabe der
 * Bescheidbeträge: die letzte zugeordnete Zahlung fortschreiben (erwartet), ohne Zahlung ein Viertel der Prognose
 * (geschätzt). Termine bis 30 Tage nach der letzten Zahlung gelten als bezahlt.
 */
export function vorauszahlungsPosten(input: {
  art: VorauszahlungsArt;
  /** Je Termin, positiv */
  betrag: Cents;
  /** Tag der letzten Zahlung, die fortgeschrieben wird; null bei einer Schätzung */
  letzteZahlung: string | null;
  heute: string;
  bis: string;
  bundesland: Bundesland | null;
  sicherheit: Sicherheit;
  text: string;
  /** ID für den Link: die Zahlung im Bankabgleich bzw. das Jahr der Prognose */
  quelleId: string;
  privat: boolean;
}): LiquiditaetsPosten[] {
  if (input.betrag <= 0) return [];
  // Daten als Text: der spätere von beiden (Math.max kennt keine Texte)
  const ab = [input.heute, input.letzteZahlung ? addDays(input.letzteZahlung, DECKT_TERMIN_TAGE + 1) : input.heute].sort()[1]!;
  return vorauszahlungsTermineZwischen(input.art, ab, input.bis, input.bundesland).map((datum) => ({
    datum,
    betrag: input.betrag,
    richtung: "aus",
    text: input.text,
    quelle: { art: "vorauszahlung", id: input.quelleId },
    sicherheit: input.sicherheit,
    ...(input.privat ? { privat: true } : {}),
  }));
}

/** Ein noch nicht abgegebener Voranmeldungszeitraum mit dem, was für ihn bis heute gebucht ist */
export interface UstZeitraum {
  zeitraum: VatPeriod;
  /** Erster Tag und erster Tag danach (ausschließlich) */
  von: string;
  bis: string;
  faellig: string;
}

/**
 * Voranmeldungszeiträume, deren Fälligkeit bis zum Ende des Horizonts liegt und die noch nicht abgegeben sind, ab dem
 * Monat `ab`. Fälligkeit nach `dueDate`, mit Dauerfristverlängerung einen Monat später (§ 46 UStDV); ohne Voranmeldung
 * (Kleinunternehmer, befreit) gibt es keinen Zeitraum.
 */
export function offeneUstZeitraeume(input: {
  ab: VatPeriod;
  bis: string;
  frequencies: readonly VatFrequencySetting[];
  dauerfrist: readonly DauerfristSetting[];
  abgegeben: readonly VatPeriod[];
  bundesland: Bundesland | null;
}): UstZeitraum[] {
  const erledigt = new Set(input.abgegeben.map(periodKey));
  const zeitraeume = new Map<string, UstZeitraum>();
  let { year, month } = input.ab;
  // Ein Zeitraum ist frühestens einen Monat nach seinem Ende fällig: Monate bis zum Ende des Horizonts genügen
  while (`${year}-${String(month).padStart(2, "0")}` <= input.bis.slice(0, 7)) {
    const zeitraum = filingPeriodOfMonth({ year, month }, frequencyAt(input.frequencies, { year, month }));
    const key = zeitraum && periodKey(zeitraum);
    if (zeitraum && key && !erledigt.has(key) && !zeitraeume.has(key)) {
      const faellig = dueDate(zeitraum, input.bundesland, dauerfristActive(input.dauerfrist, zeitraum.year));
      const { start, end } = periodRange(zeitraum);
      if (faellig <= input.bis) zeitraeume.set(key, { zeitraum, von: start, bis: end, faellig });
    }
    month += 1;
    if (month === 13) {
      year += 1;
      month = 1;
    }
  }
  return [...zeitraeume.values()];
}

/**
 * Geschätzte Zahllast (Ausgang) bzw. Erstattung (Eingang) je Zeitraum: was bis heute gebucht ist (`gebucht`, Kz 83 aus
 * dem Journal, mit dem Abzug der Sondervorauszahlung) plus die Steuer jedes erwarteten Postens, die im Zeitraum entsteht
 * (`steuer.datum`). So steigt die Zahllast nicht linear, sondern mit den Zahlungen, die die Vorschau schon kennt (#1381).
 */
export function umsatzsteuerPosten(zeitraeume: readonly (UstZeitraum & { gebucht: Cents })[], posten: readonly LiquiditaetsPosten[]): LiquiditaetsPosten[] {
  return zeitraeume.flatMap((z) => {
    const erwartet = posten.reduce((s, p) => (p.steuer && p.steuer.datum >= z.von && p.steuer.datum < z.bis ? s + p.steuer.betrag : s), 0);
    // Zahllast geht ab, Erstattung kommt: das Vorzeichen der Steuer umgekehrt
    return postenAus(-(z.gebucht + erwartet), {
      datum: z.faellig,
      text: `Umsatzsteuer ${periodLabel(z.zeitraum)}`,
      quelle: { art: "umsatzsteuer", id: periodKey(z.zeitraum) },
      sicherheit: "geschaetzt",
    });
  });
}

/**
 * Sondervorauszahlung bei Dauerfristverlängerung und monatlicher Abgabe: anzumelden und zu zahlen bis zum 10. Februar
 * (§ 48 Abs. 2 UStDV). Der für das Jahr angemeldete Betrag ist fest; fehlt er noch, schätzt Haben den des letzten Jahres
 * davor. Angerechnet wird sie in der letzten Voranmeldung des Jahres (Kz 39), deren Fälligkeit nach dem längsten
 * Horizont liegt; für ein Jahr mit angemeldetem Betrag steckt der Abzug schon in `gebucht`.
 */
export function sondervorauszahlungsPosten(input: {
  heute: string;
  bis: string;
  frequencies: readonly VatFrequencySetting[];
  dauerfrist: readonly DauerfristSetting[];
  /** Jahre, für die die Sondervorauszahlung schon gezahlt ist */
  gezahlt: ReadonlySet<number>;
  bundesland: Bundesland | null;
}): LiquiditaetsPosten[] {
  const posten: LiquiditaetsPosten[] = [];
  for (let year = Number(input.heute.slice(0, 4)); year <= Number(input.bis.slice(0, 4)); year++) {
    const termin = naechsterWerktag(`${year}-02-10`, input.bundesland);
    if (termin < input.heute || termin > input.bis || input.gezahlt.has(year)) continue;
    if (!dauerfristActive(input.dauerfrist, year) || frequencyAt(input.frequencies, { year, month: 1 }) !== "monatlich") continue;
    const eigene = input.dauerfrist.find((s) => s.year === year && s.sondervorauszahlung !== null);
    const vorjahr = input.dauerfrist.filter((s) => s.year < year && s.active && s.sondervorauszahlung !== null).sort((a, b) => b.year - a.year)[0];
    const betrag = eigene?.sondervorauszahlung ?? vorjahr?.sondervorauszahlung ?? 0;
    if (betrag <= 0) continue;
    posten.push({
      datum: termin,
      betrag,
      richtung: "aus",
      text: `Sondervorauszahlung ${year}`,
      quelle: { art: "sondervorauszahlung", id: String(year) },
      sicherheit: eigene ? "fest" : "geschaetzt",
    });
  }
  return posten;
}
