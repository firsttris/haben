import type { Cents } from "./money.ts";
import { ACCOUNTS, side, type Kontenrahmen, type PostingLine } from "./posting.ts";
import { isKapitalgesellschaft, type Rechtsform } from "./rechtsform.ts";

/*
 * Steuerzahlungen im Bankabgleich: Zahlung oder Erstattung einer Steuer mit Steuerart, Bezugsjahr und Teil (Steuer oder
 * steuerliche Nebenleistung nach § 3 Abs. 4 AO). Die Kontierung richtet sich nach Steuerart und Teil, nicht nach dem
 * Wort „Zinsen“ im Verwendungszweck: Zinsen und Zuschläge zur Umsatzsteuer sind Betriebsausgaben, zur Gewerbesteuer nicht
 * (§ 4 Abs. 5b EStG), zur Einkommensteuer privat (§ 12 Nr. 3 EStG), zur Körperschaftsteuer nicht abziehbar (§ 10 Nr. 2
 * KStG). Reine Steuerzahlungen erzeugen weder Umsatz noch Vorsteuer: Keine Zeile trägt einen Steuerschlüssel.
 *
 * Konten aus dem DATEV-Kontenrahmen 2026 (SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175). Die Umsatzsteuer des laufenden
 * Jahres läuft weiter über die Voranmeldung als offenen Posten bzw. „Umsatzsteuer an das Finanzamt“ (1780 bzw. 3820);
 * hier geht es um die Umsatzsteuer früherer Jahre aus Jahreserklärung und Bescheid.
 */

export const STEUERARTEN = {
  ust: "Umsatzsteuer",
  gewst: "Gewerbesteuer",
  est: "Einkommensteuer",
  kist: "Kirchensteuer",
  soli: "Solidaritätszuschlag",
  kst: "Körperschaftsteuer",
  kapest: "Kapitalertragsteuer (von der Bank einbehalten)",
  kapestSoli: "Solidaritätszuschlag zur Kapitalertragsteuer (von der Bank einbehalten)",
} as const;

export type Steuerart = keyof typeof STEUERARTEN;

export const STEUERART_KEYS = Object.keys(STEUERARTEN) as [Steuerart, ...Steuerart[]];

/** Teil einer Zahlung: die Steuer selbst oder eine steuerliche Nebenleistung (§ 3 Abs. 4 AO) */
export const STEUER_POSTEN = {
  steuer: "Steuer",
  zinsen233a: "Nachzahlungs- oder Erstattungszinsen (§ 233a AO)",
  zinsen: "Stundungs-, Hinterziehungs- oder Aussetzungszinsen (§§ 234 bis 237 AO)",
  saeumnis: "Säumniszuschlag (§ 240 AO)",
  verspaetung: "Verspätungszuschlag (§ 152 AO) oder Zwangsgeld (§ 329 AO)",
} as const;

export type SteuerPosten = keyof typeof STEUER_POSTEN;

export const STEUER_POSTEN_KEYS = Object.keys(STEUER_POSTEN) as [SteuerPosten, ...SteuerPosten[]];

/** Steuerart, Bezugsjahr (Jahr, für das die Steuer festgesetzt ist) und Teil einer Steuerzahlung */
export interface Steuerangabe {
  art: Steuerart;
  jahr: number;
  posten: SteuerPosten;
}

/** Ältestes Bezugsjahr; Bescheide verjähren nach höchstens zehn Jahren (§ 169 Abs. 2 Satz 2 AO) mit Ablaufhemmung */
export const STEUER_JAHR_MIN = 2000;

/**
 * Wie eine Steuerart steuerlich wirkt: betriebliche Steuer mit abziehbaren Nebenleistungen (Umsatzsteuer), Gewerbesteuer
 * (keine Betriebsausgabe, § 4 Abs. 5b EStG), Steuern vom Einkommen der GmbH (nicht abziehbar, § 10 Nr. 2 KStG) oder
 * Steuern des Inhabers im Einzelunternehmen (privat, § 12 Nr. 3 EStG; Entnahme bzw. Einlage).
 */
export type SteuerGruppe = "betrieblich" | "gewerbesteuer" | "ertragsteuer" | "privat";

export function steuerGruppe(art: Steuerart, rechtsform: Rechtsform): SteuerGruppe {
  if (art === "ust") return "betrieblich";
  if (art === "gewst") return "gewerbesteuer";
  return isKapitalgesellschaft(rechtsform) ? "ertragsteuer" : "privat";
}

/** Steuerarten der Rechtsform: Einkommen- und Kirchensteuer hat nur der Inhaber, Körperschaftsteuer nur die GmbH oder UG */
export function steuerartenFor(rechtsform: Rechtsform): Steuerart[] {
  const kapg = isKapitalgesellschaft(rechtsform);
  return STEUERART_KEYS.filter((art) => (art === "kst" ? kapg : art === "est" || art === "kist" ? !kapg : true));
}

/** Konten des DATEV-Kontenrahmens 2026 (SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175) */
export const STEUER_KONTEN = {
  SKR03: {
    ustVorjahr: "1790",
    ustFruehereJahre: "1791",
    gewst: "4320",
    /** Gewerbesteuernachzahlungen und -erstattungen für Vorjahre nach § 4 Abs. 5b EStG */
    gewstVorjahre: "2281",
    kst: "2200",
    kstVorjahre: "2203",
    kstErstattungVorjahre: "2204",
    soli: "2208",
    soliVorjahre: "2209",
    soliErstattungVorjahre: "2210",
    kapest: "2213",
    kapestSoli: "2216",
    rueckstellungKst: "0963",
    rueckstellungGewst: "0956",
    privatsteuern: "1810",
    zinsen233aAbziehbar: "2107",
    zinsen233aNichtAbziehbar: "2105",
    zinsenAbziehbar: "2111",
    zinsenNichtAbziehbar: "2108",
    nebenleistungenAbziehbar: "2103",
    nebenleistungenNichtAbziehbar: "2104",
    nebenleistungenGewst: "2102",
    verspaetungAbziehbar: "4396",
    verspaetungNichtAbziehbar: "4397",
    erstattungszinsen: "2657",
  },
  SKR04: {
    ustVorjahr: "3841",
    ustFruehereJahre: "3845",
    gewst: "7610",
    gewstVorjahre: "7641",
    kst: "7600",
    kstVorjahre: "7603",
    kstErstattungVorjahre: "7604",
    soli: "7608",
    soliVorjahre: "7609",
    soliErstattungVorjahre: "7607",
    kapest: "7630",
    kapestSoli: "7633",
    rueckstellungKst: "3040",
    rueckstellungGewst: "3035",
    privatsteuern: "2150",
    zinsen233aAbziehbar: "7305",
    zinsen233aNichtAbziehbar: "7308",
    zinsenAbziehbar: "7311",
    zinsenNichtAbziehbar: "7306",
    nebenleistungenAbziehbar: "7303",
    nebenleistungenNichtAbziehbar: "7304",
    nebenleistungenGewst: "7302",
    verspaetungAbziehbar: "6436",
    verspaetungNichtAbziehbar: "6437",
    erstattungszinsen: "7105",
  },
} as const;

/** Bezeichnungen der Konten wie im DATEV-Kontenrahmen 2026, für Journal und Kontenblatt */
export const STEUER_KONTO_NAMEN: Record<Kontenrahmen, Record<string, string>> = {
  SKR03: {
    "1790": "Umsatzsteuerverbindlichkeiten Vorjahr",
    "1791": "Umsatzsteuerverbindlichkeiten frühere Jahre",
    "1810": "Privatsteuern",
    "2102": "Steuerlich nicht abzugsfähige andere Nebenleistungen zu Steuern § 4 Abs. 5b EStG",
    "2103": "Steuerlich abzugsfähige andere Nebenleistungen zu Steuern",
    "2104": "Steuerlich nicht abzugsfähige andere Nebenleistungen zu Steuern",
    "2105": "Zinsaufwendungen § 233a AO nicht abzugsfähig",
    "2107": "Zinsaufwendungen § 233a AO abzugsfähig",
    "2108": "Zinsaufwendungen §§ 234 bis 237 AO nicht abzugsfähig",
    "2111": "Zinsaufwendungen §§ 234 bis 237 AO abzugsfähig",
    "2203": "Körperschaftsteuer für Vorjahre",
    "2204": "Körperschaftsteuererstattungen für Vorjahre",
    "2209": "Solidaritätszuschlag für Vorjahre",
    "2210": "Solidaritätszuschlagerstattungen für Vorjahre",
    "2213": "Kapitalertragsteuer 25 %",
    "2216": "Anrechenbarer Solidaritätszuschlag auf Kapitalertragsteuer 25 %",
    "2281": "Gewerbesteuernachzahlungen und Gewerbesteuererstattungen für Vorjahre nach § 4 Abs. 5b EStG",
    "2657": "Zinserträge § 233a AO, steuerpflichtig",
    "4396": "Steuerlich abzugsfähige Verspätungszuschläge und Zwangsgelder",
    "4397": "Steuerlich nicht abzugsfähige Verspätungszuschläge und Zwangsgelder",
  },
  SKR04: {
    "2150": "Privatsteuern",
    "3841": "Umsatzsteuerverbindlichkeiten Vorjahr",
    "3845": "Umsatzsteuerverbindlichkeiten frühere Jahre",
    "6436": "Steuerlich abzugsfähige Verspätungszuschläge und Zwangsgelder",
    "6437": "Steuerlich nicht abzugsfähige Verspätungszuschläge und Zwangsgelder",
    "7105": "Zinserträge § 233a AO, steuerpflichtig",
    "7302": "Steuerlich nicht abzugsfähige andere Nebenleistungen zu Steuern § 4 Abs. 5b EStG",
    "7303": "Steuerlich abzugsfähige andere Nebenleistungen zu Steuern",
    "7304": "Steuerlich nicht abzugsfähige andere Nebenleistungen zu Steuern",
    "7305": "Zinsaufwendungen § 233a AO abzugsfähig",
    "7306": "Zinsaufwendungen §§ 234 bis 237 AO nicht abzugsfähig",
    "7308": "Zinsaufwendungen § 233a AO nicht abzugsfähig",
    "7311": "Zinsaufwendungen §§ 234 bis 237 AO abzugsfähig",
    "7603": "Körperschaftsteuer für Vorjahre",
    "7604": "Körperschaftsteuererstattungen für Vorjahre",
    "7607": "Solidaritätszuschlagerstattungen für Vorjahre",
    "7609": "Solidaritätszuschlag für Vorjahre",
    "7630": "Kapitalertragsteuer 25 %",
    "7633": "Anrechenbarer Solidaritätszuschlag auf Kapitalertragsteuer 25 %",
    "7641": "Gewerbesteuernachzahlungen und -erstattungen für Vorjahre nach § 4 Abs. 5b EStG",
  },
};

/**
 * Konten der Nebenleistungen, die eine GmbH oder UG dem Einkommen wieder hinzurechnet (§ 10 Nr. 2 KStG, § 4 Abs. 5b EStG);
 * die Steuerberechnung (koerperschaft.ts) liest sie mit den übrigen nicht abziehbaren Aufwendungen
 */
export function nichtAbziehbareNebenleistungen(kontenrahmen: Kontenrahmen): string[] {
  const k = STEUER_KONTEN[kontenrahmen];
  return [k.zinsen233aNichtAbziehbar, k.zinsenNichtAbziehbar, k.nebenleistungenNichtAbziehbar, k.nebenleistungenGewst, k.verspaetungNichtAbziehbar];
}

/** Konten der abziehbaren Nebenleistungen zu betrieblichen Steuern: in der EÜR Betriebsausgaben */
export function abziehbareNebenleistungen(kontenrahmen: Kontenrahmen): string[] {
  const k = STEUER_KONTEN[kontenrahmen];
  return [k.zinsen233aAbziehbar, k.zinsenAbziehbar, k.nebenleistungenAbziehbar, k.verspaetungAbziehbar];
}

/**
 * Kontierung einer Steuerzahlung: Gegenkonto der Bank und, bei einer GmbH oder UG, die Steuerrückstellung, die eine
 * Nachzahlung für ein Vorjahr zuerst verbraucht. Fehler als Wert: Was Haben nicht sicher richtig buchen kann, lehnt es ab.
 */
export type SteuerKontierung = { ok: true; konto: string; rueckstellung: string | null } | { ok: false; fehler: string };

const fehler = (text: string): SteuerKontierung => ({ ok: false, fehler: text });

/** Konto für Zinsen und Zuschläge: abziehbar zu betrieblichen Steuern, nicht abziehbar zu Gewerbe- und Ertragsteuern */
function nebenleistungKonto(posten: Exclude<SteuerPosten, "steuer">, gruppe: SteuerGruppe, kontenrahmen: Kontenrahmen): string {
  const k = STEUER_KONTEN[kontenrahmen];
  const abziehbar = gruppe === "betrieblich";
  if (posten === "zinsen233a") return abziehbar ? k.zinsen233aAbziehbar : k.zinsen233aNichtAbziehbar;
  if (posten === "zinsen") return abziehbar ? k.zinsenAbziehbar : k.zinsenNichtAbziehbar;
  if (posten === "verspaetung") return abziehbar ? k.verspaetungAbziehbar : k.verspaetungNichtAbziehbar;
  // Säumniszuschläge: „andere Nebenleistungen“; zur Gewerbesteuer mit eigenem Konto nach § 4 Abs. 5b EStG
  return abziehbar ? k.nebenleistungenAbziehbar : gruppe === "gewerbesteuer" ? k.nebenleistungenGewst : k.nebenleistungenNichtAbziehbar;
}

/** Konto der Steuer selbst; null bei der Umsatzsteuer des laufenden Jahres */
function steuerKonto(art: Steuerart, vorjahr: boolean, erstattung: boolean, jahr: number, zahlungsjahr: number, kontenrahmen: Kontenrahmen) {
  const k = STEUER_KONTEN[kontenrahmen];
  switch (art) {
    case "ust":
      return zahlungsjahr - jahr === 1 ? k.ustVorjahr : k.ustFruehereJahre;
    case "gewst":
      return vorjahr ? k.gewstVorjahre : k.gewst;
    case "kst":
      return vorjahr ? (erstattung ? k.kstErstattungVorjahre : k.kstVorjahre) : k.kst;
    case "soli":
      return vorjahr ? (erstattung ? k.soliErstattungVorjahre : k.soliVorjahre) : k.soli;
    case "kapest":
      return k.kapest;
    case "kapestSoli":
      return k.kapestSoli;
    default:
      return k.privatsteuern;
  }
}

export function steuerKontierung(
  angabe: Steuerangabe,
  amount: Cents,
  /** ISO-Datum der Zahlung (Buchungstag des Umsatzes) */
  zahlungsdatum: string,
  kontenrahmen: Kontenrahmen,
  rechtsform: Rechtsform,
): SteuerKontierung {
  const { art, jahr, posten } = angabe;
  const zahlungsjahr = Number(zahlungsdatum.slice(0, 4));
  if (!steuerartenFor(rechtsform).includes(art)) {
    return fehler(art === "kst" ? "Körperschaftsteuer gibt es nur in GmbH und UG." : `${STEUERARTEN[art]} gibt es nur im Einzelunternehmen.`);
  }
  if (!Number.isInteger(jahr) || jahr < STEUER_JAHR_MIN || jahr > zahlungsjahr) {
    return fehler(`Das Bezugsjahr muss zwischen ${STEUER_JAHR_MIN} und dem Jahr der Zahlung (${zahlungsjahr}) liegen.`);
  }
  if (amount === 0) return fehler("Die Steuerzahlung braucht einen Betrag.");
  const gruppe = steuerGruppe(art, rechtsform);
  const k = STEUER_KONTEN[kontenrahmen];
  const erstattung = amount > 0;

  if (art === "kapest" || art === "kapestSoli") {
    // Nur als Abzug von einer Zinsgutschrift (Aufteilen): Bruttozins als Zinsertrag, die einbehaltene Steuer als Teil
    if (posten !== "steuer") return fehler("Zur einbehaltenen Kapitalertragsteuer gibt es nur die Steuer selbst.");
    if (erstattung) return fehler("Einbehaltene Kapitalertragsteuer ist ein Abzug, also ein negativer Teil der Zinsgutschrift.");
    // Einzelunternehmen: auf die Einkommensteuer anrechenbar, also Entnahme (Privatsteuern); GmbH: Steueraufwand
    return { ok: true, konto: gruppe === "privat" ? k.privatsteuern : steuerKonto(art, false, false, jahr, zahlungsjahr, kontenrahmen), rueckstellung: null };
  }

  if (gruppe === "privat") {
    // § 12 Nr. 3 EStG: Steuern vom Einkommen und ihre Nebenleistungen sind privat; Erstattungszinsen sind private
    // Kapitalerträge (§ 20 Abs. 1 Nr. 7 EStG), auf dem Geschäftskonto also eine Einlage
    if (posten === "zinsen233a" && erstattung) return { ok: true, konto: ACCOUNTS[kontenrahmen].privateinlagen, rueckstellung: null };
    return { ok: true, konto: k.privatsteuern, rueckstellung: null };
  }

  if (posten !== "steuer") {
    if (posten === "zinsen233a" && erstattung) {
      // Erstattungszinsen zur Umsatzsteuer sind steuerpflichtige Betriebseinnahmen; zu Gewerbe- und Körperschaftsteuer führt
      // der DATEV-Kontenrahmen steuerfreie Konten, deren Kürzung die Erklärungen in Haben nicht abbilden
      if (gruppe !== "betrieblich") return fehler(`Erstattungszinsen zur ${STEUERARTEN[art]} bucht Haben nicht; bucht sie mit der Steuerberatung.`);
      return { ok: true, konto: k.erstattungszinsen, rueckstellung: null };
    }
    return { ok: true, konto: nebenleistungKonto(posten, gruppe, kontenrahmen), rueckstellung: null };
  }

  const vorjahr = jahr < zahlungsjahr;
  if (art === "ust" && !vorjahr) {
    return fehler(
      "Umsatzsteuer des laufenden Jahres: Ordne die Voranmeldung zu oder buche „Umsatzsteuer an das Finanzamt“. Hier geht es um Umsatzsteuer früherer Jahre.",
    );
  }
  const konto = steuerKonto(art, vorjahr, erstattung, jahr, zahlungsjahr, kontenrahmen);
  // GmbH und UG: Eine Nachzahlung für ein Vorjahr verbraucht zuerst die Rückstellung aus dem Jahresabschluss
  const rueckstellung =
    gruppe !== "betrieblich" && isKapitalgesellschaft(rechtsform) && vorjahr && !erstattung
      ? art === "gewst"
        ? k.rueckstellungGewst
        : k.rueckstellungKst
      : null;
  return { ok: true, konto, rueckstellung };
}

/**
 * Buchung einer Steuerzahlung, amount wie auf dem Konto (Ausgang negativ): Steuerkonto an Bank bzw. Bank an Steuerkonto.
 * ausRueckstellung (positiv) ist der Teil einer Nachzahlung, der die Steuerrückstellung verbraucht; der Rest geht auf das
 * Konto für Vorjahre.
 */
export function steuerzahlungPosting(
  kontierung: { konto: string; rueckstellung: string | null },
  amount: Cents,
  ausRueckstellung: Cents,
  kontenrahmen: Kontenrahmen,
): PostingLine[] {
  if (ausRueckstellung < 0 || (ausRueckstellung > 0 && (!kontierung.rueckstellung || ausRueckstellung > -amount))) {
    throw new RangeError("Der Teil aus der Rückstellung passt nicht zur Zahlung");
  }
  const lines = [side(ACCOUNTS[kontenrahmen].bank, amount, true, null)];
  if (ausRueckstellung > 0) lines.push(side(kontierung.rueckstellung!, -ausRueckstellung, false, null));
  lines.push(side(kontierung.konto, amount + ausRueckstellung, false, null));
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}

/** Text für Buchung und Liste, z. B. „Gewerbesteuer 2024 · Säumniszuschlag (§ 240 AO)“ oder „Umsatzsteuer 2024 · Erstattung“ */
export function steuerzahlungText(angabe: Steuerangabe, amount: Cents): string {
  if (angabe.art === "kapest" || angabe.art === "kapestSoli") return STEUERARTEN[angabe.art];
  const teil = angabe.posten === "steuer" ? (amount > 0 ? "Erstattung" : "Zahlung") : STEUER_POSTEN[angabe.posten];
  return `${STEUERARTEN[angabe.art]} ${angabe.jahr} · ${teil}`;
}

/**
 * Wirkung in der EÜR (Einzelunternehmen, § 4 Abs. 3 EStG, nach Zahlung): gezahlte bzw. erstattete Umsatzsteuer,
 * Erstattungszinsen als Einnahme, abziehbare Nebenleistungen als Ausgabe, Gewerbesteuer samt Nebenleistungen nur
 * nachrichtlich (Anlage EÜR: Zeile „sonstige beschränkt abziehbare Betriebsausgaben“, Spalte „nicht abziehbar“), private
 * Steuern als Entnahme bzw. Einlage (aus dem Journal, nicht hier).
 */
export type SteuerEuerWirkung = "umsatzsteuer" | "einnahme" | "nebenleistung" | "gewerbesteuer" | "privat";

export function steuerEuerWirkung(art: Steuerart, posten: SteuerPosten, amount: Cents): SteuerEuerWirkung {
  const gruppe = steuerGruppe(art, "einzelunternehmen");
  if (gruppe === "privat") return "privat";
  if (gruppe === "gewerbesteuer") return "gewerbesteuer";
  if (posten === "steuer") return "umsatzsteuer";
  return posten === "zinsen233a" && amount > 0 ? "einnahme" : "nebenleistung";
}
