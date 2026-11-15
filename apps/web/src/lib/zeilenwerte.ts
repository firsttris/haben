import type { UstErklaerungFigures } from "@haben/elster";
import { EUER_AUSGABEN, EUER_EINNAHMEN, EUER_FIELDS } from "@haben/elster/euer-felder";
import { z } from "zod";

/*
 * Zeilen der Jahreserklärungen, die außerhalb von Haben abgegeben werden (#997): Schlüssel und amtlicher
 * Zeilentext. Hier, damit Oberfläche und Server dieselbe Liste lesen, ohne den Servercode zu laden.
 *
 * Die Schlüssel sind die der Übermittlung: `EUER_FIELDS` der Anlage EÜR (Feldkennungen und Zeilentexte aus der
 * Jahresdokumentation des ERiC-Pakets E77) und `UstErklaerungFigures` der Umsatzsteuererklärung. Eine eigene
 * Liste von Kennzahlen gab es hier einmal; sie war an die Zeilennummern eines Vordruckjahres gebunden (2024/2025:
 * Zeile 17 statt Kz 15) und deckte die Zeilen nicht ab, die Haben selbst übermittelt.
 */

/** Eine Zeile, die außerhalb von Haben erklärt wurde: Schlüssel der Erklärung, Zeilentext und Anlage */
export interface ErklaerteZeile {
  /** Schlüssel wie in der Übermittlung: `steuerpflichtig`, `base19`, `gewinn`, … */
  field: string;
  text: string;
  /**
   * Anlage des Vordrucks, in der die Zeile steht: „Anlage N“, „Anlage Vorsorgeaufwand“, … Leer, wo die Aufstellung
   * keine Anlagen kennt (Umsatzsteuererklärung, Anlage EÜR).
   */
  gruppe?: string;
}

const euerZeile = (field: keyof typeof EUER_FIELDS): ErklaerteZeile => ({ field, text: EUER_FIELDS[field].label });

/**
 * Summenzeilen der Anlage EÜR. Sie stehen nicht in `EUER_FIELDS`, weil Haben sie rechnet und selbst ins XML
 * schreibt (E6005501, E6005301, E6007002); im Übermittlungsprotokoll stehen sie trotzdem.
 */
const EUER_SUMMEN = {
  einnahmen: { field: "einnahmen", text: "Summe der Betriebseinnahmen" },
  ausgaben: { field: "ausgaben", text: "Summe der Betriebsausgaben" },
  gewinn: { field: "gewinn", text: "Steuerpflichtiger Gewinn / Verlust" },
} as const satisfies Record<string, ErklaerteZeile>;

/**
 * Gleicht das Vorzeichen einer erklärten Zeile an den Vermerk an (#1082).
 *
 * Der Vordruck druckt „Erstattung oder Nachzahlung“ als Betrag ohne Richtung; Haben führt Erstattungen dagegen
 * negativ, so wie in den Vermerken und in der Abschlusszeile der Umsatzsteuer. Ohne diesen Abgleich stünde
 * dieselbe Erstattung mit zwei Vorzeichen auf einer Seite: −10.321,97 EUR im Vermerk, +10.321,97 EUR in der
 * erklärten Zeile.
 */
export function mitVorzeichen(field: string, wert: number, vermerkBetrag: number | null | undefined): number {
  // Nur das Ergebnis der Veranlagung trägt eine Richtung; alle anderen Zeilen sind Beträge in eine Richtung
  if (field !== "erstattung" || !vermerkBetrag) return wert;
  return Math.sign(vermerkBetrag) * Math.abs(wert);
}

/**
 * Zeilen der Einkommensteuererklärung, nach den Anlagen des Vordrucks (#1082, #1149).
 *
 * Haben schickt die Erklärung auf viele Anlagen verteilt; für eine Erklärung, die außerhalb von Haben abgegeben
 * wurde, trägt der Betreiber die Zeilen aus dem Vordruck nach. Die Reihenfolge folgt dem Vordruck: erst die Anlagen,
 * in denen die Beträge entstehen, dann die Berechnung, die sie zusammenführt. Die Anlage steht am Feld, weil
 * `annual_submission_figures` nur Feldkennung und Betrag speichert. Die Schlüssel bleiben ASCII, die Texte sind die
 * des Vordrucks.
 */
const EST_ANLAGEN: readonly { anlage: string; felder: Readonly<Record<string, string>> }[] = [
  {
    anlage: "Anlage N",
    felder: {
      bruttoarbeitslohn: "Bruttoarbeitslohn",
      werbungskostenArbeitsmittel: "Aufwendungen für Arbeitsmittel",
      werbungskostenArbeitszimmer: "Aufwendungen für ein häusliches Arbeitszimmer",
      werbungskostenUebrige: "Übrige Werbungskosten",
      werbungskostenBewerbung: "davon Bewerbungskosten",
      werbungskostenSonstige: "davon weitere Werbungskosten",
      werbungskosten: "Werbungskosten insgesamt",
      einkuenfteNichtselbstaendig: "Einkünfte aus nichtselbständiger Arbeit",
    },
  },
  {
    anlage: "Anlage S",
    felder: {
      einkuenfteSelbstaendigLaufend: "Laufende Gewinne, darin Gewinne aus freiberuflicher Tätigkeit",
      einkuenfteSelbstaendig: "Einkünfte aus selbständiger Arbeit",
    },
  },
  {
    anlage: "Anlage Vorsorgeaufwand",
    felder: {
      altersvorsorgeArbeitnehmeranteil: "Arbeitnehmeranteil zu gesetzlichen Rentenversicherungen",
      altersvorsorgeEigeneVertraege: "Eigene kapitalgedeckte Rentenversicherungen",
      altersvorsorgeArbeitgeberanteil: "Arbeitgeberanteil zu gesetzlichen Rentenversicherungen",
      altersvorsorgeSumme: "Summe der Altersvorsorgeaufwendungen",
      altersvorsorgeHoechstbetrag: "Höchstbetrag nach § 10 Abs. 3 EStG",
      altersvorsorgeAbziehbar: "Abziehbare Altersvorsorgebeiträge",
      basisabsicherung: "Basisabsicherungen (Nr. 3)",
      pflegePflichtversicherung: "Pflege-Pflichtversicherungen (Nr. 3)",
      vorsorgeZuschuesse: "Zuschüsse und Erstattungen (Nr. 3)",
      vorsorgeAufwendungenNr3: "Summe der übrigen Vorsorgeaufwendungen (Nr. 3)",
      krankenPflegeUebrige: "Übrige Kranken- und Pflegeversicherungen (Nr. 3a)",
      arbeitslosenversicherung: "Arbeitslosenversicherungen (Nr. 3a)",
      berufsunfaehigkeit: "Erwerbs- und Berufsunfähigkeitsversicherungen (Nr. 3a)",
      unfallHaftpflicht: "Unfall-, Haftpflicht- und Risikoversicherungen (Nr. 3a)",
      vorsorgeAufwendungenNr3a: "Summe der übrigen Vorsorgeaufwendungen (Nr. 3a)",
      vorsorgeAufwendungenNr3aAbziehbar: "davon abziehbar",
      vorsorgeaufwendungen: "Summe der abziehbaren Vorsorgeaufwendungen",
    },
  },
  {
    anlage: "Sonderausgaben",
    felder: {
      sonderausgabenPauschbetrag: "Sonderausgaben-Pauschbetrag",
      erstattungsueberhang: "Erstattungsüberhang bei Beiträgen der Basisversorgung (§ 10 Abs. 4b EStG)",
    },
  },
  {
    anlage: "Anlage KAP",
    felder: {
      kapitalertraege: "Kapitalerträge",
      sparerPauschbetrag: "Sparer-Pauschbetrag",
      kapitalertraegeMassgeblich: "Maßgebliche Einkünfte nach § 32d EStG",
      abgeltungsteuer: "Steuern nach § 32d EStG (Abgeltungsteuer)",
      kapitalertragsteuer: "Einbehaltene Kapitalertragsteuer",
      kapitalertragsteuerSoli: "Solidaritätszuschlag auf Kapitalerträge",
    },
  },
  {
    anlage: "Progressionsvorbehalt",
    felder: {
      einkuenfteProgressionsvorbehalt: "Einkünfte unter Progressionsvorbehalt (§ 32b EStG)",
      tariflicheEinkommensteuer: "Tarifliche Einkommensteuer",
    },
  },
  {
    anlage: "Berechnung",
    felder: {
      summeEinkuenfte: "Summe der Einkünfte",
      gesamtbetrag: "Gesamtbetrag der Einkünfte",
      zuVersteuerndesEinkommen: "Zu versteuerndes Einkommen",
      // In der Erklärung setzt niemand etwas fest: Die Zahl kommt aus dem Steuerprogramm, festgesetzt wird sie erst im
      // Bescheid. Die Beschriftung sagt deshalb, woher sie stammt (#1084)
      festgesetzteSteuer: "Einkommensteuer laut Steuerprogramm",
      soli: "Solidaritätszuschlag laut Steuerprogramm",
      erstattung: "Erstattung oder Nachzahlung laut Steuerprogramm",
    },
  },
];

const EST_ZEILEN: readonly ErklaerteZeile[] = EST_ANLAGEN.flatMap(({ anlage, felder }) =>
  Object.entries(felder).map(([field, text]) => ({ field, text, gruppe: anlage })),
);

type UstBetrag = Exclude<keyof UstErklaerungFigures, "kz48Zeile47Nummern">;

/**
 * Zeilentexte der Umsatzsteuererklärung. Der Typ bindet die Liste an `UstErklaerungFigures`: eine fehlende oder
 * falsch geschriebene Kennzahl ist ein Übersetzungsfehler, keine stille Lücke.
 */
const UST_FELDER: Record<UstBetrag | "abschluss", string> = {
  base19: "Umsätze zu 19 %, Bemessungsgrundlage",
  tax19: "Umsatzsteuer auf Umsätze zu 19 %",
  base7: "Umsätze zu 7 %, Bemessungsgrundlage",
  tax7: "Umsatzsteuer auf Umsätze zu 7 %",
  kz41: "Steuerfreie innergemeinschaftliche Lieferungen (Kz 41)",
  kz43: "Steuerfreie Ausfuhrlieferungen (Kz 43)",
  kz21: "Nicht steuerbare Leistungen, Ort im EU-Ausland (Kz 21)",
  kz45: "Nicht steuerbare Umsätze Drittland (Kz 45)",
  kz46: "§-13b-Leistungen aus dem EU-Ausland, Bemessung (Kz 46)",
  kz47: "Steuer aus §-13b-Leistungen aus dem EU-Ausland (Kz 47)",
  kz84: "§-13b-Leistungen aus dem Drittland, Bemessung (Kz 84)",
  kz85: "Steuer aus §-13b-Leistungen aus dem Drittland (Kz 85)",
  kz89: "Innergemeinschaftliche Erwerbe zu 19 %, Bemessung (Kz 89)",
  tax89: "Steuer aus innergemeinschaftlichen Erwerben zu 19 % (Kz 89)",
  kz93: "Innergemeinschaftliche Erwerbe zu 7 %, Bemessung (Kz 93)",
  tax93: "Steuer aus innergemeinschaftlichen Erwerben zu 7 % (Kz 93)",
  kz48Zeile46: "Steuerfreie Umsätze ohne Vorsteuerabzug, Zeile 46: Vermietung (§ 4 Nr. 12 UStG)",
  kz48Zeile47: "Steuerfreie Umsätze ohne Vorsteuerabzug, Zeile 47: übrige (§ 4 UStG)",
  vorsteuer: "Abziehbare Vorsteuer aus Rechnungen (Kz 66)",
  kz61: "Vorsteuer aus innergemeinschaftlichem Erwerb (Kz 61)",
  kz62: "Entstandene Einfuhrumsatzsteuer (Kz 62)",
  kz67: "Vorsteuer aus §-13b-Leistungen (Kz 67)",
  vorauszahlungen: "Vorauszahlungssoll (Summe der Voranmeldungen des Jahres)",
  abschluss: "Abschlusszahlung / Erstattungsanspruch",
};

/** Die Reihenfolge der Umsatzsteuererklärung, vom Umsatz zur Abschlusszahlung */
const UST_REIHENFOLGE = [
  "base19",
  "tax19",
  "base7",
  "tax7",
  "kz41",
  "kz43",
  "kz21",
  "kz45",
  "kz46",
  "kz47",
  "kz84",
  "kz85",
  "kz89",
  "tax89",
  "kz93",
  "tax93",
  "kz48Zeile46",
  "kz48Zeile47",
  "vorsteuer",
  "kz61",
  "kz62",
  "kz67",
  "vorauszahlungen",
  "abschluss",
] as const satisfies readonly (keyof typeof UST_FELDER)[];

const ustZeile = (field: keyof typeof UST_FELDER): ErklaerteZeile => ({ field, text: UST_FELDER[field] });

/**
 * Aufwendungen für ein häusliches Arbeitszimmer, Spalte „abziehbar“ (E6003101, im ERiC-Prüfplugin der Anlage EÜR
 * unter /EUER/BAus/Beschr_abziehbar/Abziehbar/Arbeitszimmer). Sie hat in `EUER_FIELDS` kein Feld, weil Haben sie
 * nicht übermittelt; für eine außerhalb von Haben abgegebene Erklärung steht sie trotzdem im Protokoll (#1072).
 */
const EUER_ARBEITSZIMMER = {
  field: "arbeitszimmer",
  text: "Aufwendungen für ein häusliches Arbeitszimmer (abziehbar)",
} as const satisfies ErklaerteZeile;

/** Zeilen je Erklärungsart, in der Reihenfolge der amtlichen Vordrucke */
export const ERKLAERTE_ZEILEN = {
  ust: UST_REIHENFOLGE.map(ustZeile),
  euer: [
    ...EUER_EINNAHMEN.map(euerZeile),
    EUER_SUMMEN.einnahmen,
    // Im Vordruck steht das Arbeitszimmer vor der Tagespauschale
    ...EUER_AUSGABEN.flatMap((field) => (field === "tagespauschale" ? [EUER_ARBEITSZIMMER, euerZeile(field)] : [euerZeile(field)])),
    // Die nicht abziehbaren Teile stehen im Vordruck bei den beschränkt abziehbaren Ausgaben und zählen nicht zur Summe
    euerZeile("bewirtungNichtAbziehbar"),
    euerZeile("gewerbesteuerNichtAbziehbar"),
    EUER_SUMMEN.ausgaben,
    EUER_SUMMEN.gewinn,
    euerZeile("entnahmen"),
    euerZeile("einlagen"),
  ],
  est: EST_ZEILEN,
} as const satisfies Record<string, readonly ErklaerteZeile[]>;

export type ZeilenForm = keyof typeof ERKLAERTE_ZEILEN;

export const zeilenForm = z.enum(["ust", "euer", "est"]);

/** Die Feldkennungen, die zu dieser Erklärungsart gehören */
export function zeilenFelder(form: ZeilenForm): readonly string[] {
  return ERKLAERTE_ZEILEN[form].map((z) => z.field);
}

/** Der Zeilentext zu einer gespeicherten Feldkennung */
export function zeilenText(form: ZeilenForm, field: string): string | undefined {
  return ERKLAERTE_ZEILEN[form].find((z) => z.field === field)?.text;
}
