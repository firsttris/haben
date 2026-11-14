/*
 * Beträge der Anlage EÜR und ihre Feldkennungen. Eine Tabelle für XML, Vorschau, Vorprüfung und Abgabevermerk;
 * Feldkennungen und Zeilennummern stammen aus der Jahresdokumentation des ERiC-Pakets (E77). Zeilennummern hängen
 * am Jahr: 2023 sind es Zeile 17 und 56, ab 2024 Zeile 18 und 58.
 */
import type { Cents } from "@haben/core";

/** Beträge der Anlage EÜR in Cent; fehlende oder 0 entfallen */
export interface EuerFigures {
  // Betriebseinnahmen
  kleinunternehmer?: Cents;
  steuerpflichtig?: Cents;
  steuerfrei?: Cents;
  /** Vereinnahmte Umsatzsteuer und Umsatzsteuer auf unentgeltliche Wertabgaben */
  vereinnahmteUst?: Cents;
  erstatteteUst?: Cents;
  anlagenabgang?: Cents;
  privateKfz?: Cents;
  /** Sonstige Sach-, Nutzungs- und Leistungsentnahmen (Sachentnahme, freie Buchung) */
  sachentnahmen?: Cents;
  // Betriebsausgaben
  waren?: Cents;
  fremdleistungen?: Cents;
  /** Ausgaben für eigenes Personal: Löhne und Gehälter, Lohnsteuer und Beiträge zur Sozialversicherung */
  personal?: Cents;
  afaBeweglich?: Cents;
  gwg?: Cents;
  sammelposten?: Cents;
  restbuchwert?: Cents;
  telekommunikation?: Cents;
  reisekosten?: Cents;
  fortbildung?: Cents;
  beratung?: Cents;
  beitraegeVersicherungen?: Cents;
  edv?: Cents;
  arbeitsmittel?: Cents;
  werbung?: Cents;
  /** Schuldzinsen zur Finanzierung von Anschaffungs- und Herstellungskosten von Anlagevermögen bzw. übrige (Darlehen) */
  schuldzinsenAnlage?: Cents;
  schuldzinsen?: Cents;
  vorsteuer?: Cents;
  gezahlteUst?: Cents;
  uebrige?: Cents;
  /** Beschränkt abziehbar: Geschenke bis 50 €, Bewirtung (abziehbare 70 %), Verpflegungsmehraufwand, Homeoffice-Tagespauschale */
  geschenke?: Cents;
  bewirtung?: Cents;
  /** Nicht abziehbare 30 % der Bewirtung; nur zur Information, nicht in den Betriebsausgaben */
  bewirtungNichtAbziehbar?: Cents;
  /**
   * Gewerbesteuer und Nebenleistungen darauf, abzüglich Erstattungen, und Hinterziehungszinsen: keine Betriebsausgabe (§ 4
   * Abs. 5b, Abs. 5 Satz 1 Nr. 8a EStG); nach der
   * Anleitung zur Anlage EÜR in der Zeile der sonstigen beschränkt abziehbaren Betriebsausgaben, Spalte „nicht abziehbar“
   */
  gewerbesteuerNichtAbziehbar?: Cents;
  verpflegung?: Cents;
  tagespauschale?: Cents;
  kfzLeasing?: Cents;
  kfzSteuerVersicherung?: Cents;
  kfzSonstige?: Cents;
  /** Zeile 39 (Kz 150) und Zeile 48 (Kz 225) */
  miete?: Cents;
  erhaltung?: Cents;
  /** Fahrten mit dem Privatfahrzeug (Kilometersatz), als Nutzungseinlage */
  fahrtNutzungseinlage?: Cents;
  /** Zeile 73: Entfernungspauschale für Wege zwischen Wohnung und Betriebsstätte */
  entfernungspauschale?: Cents;
  // Entnahmen und Einlagen (Einzelunternehmen)
  entnahmen?: Cents;
  einlagen?: Cents;
}

export const EUER_EINNAHMEN = [
  "kleinunternehmer",
  "steuerpflichtig",
  "steuerfrei",
  "vereinnahmteUst",
  "erstatteteUst",
  "anlagenabgang",
  "privateKfz",
  "sachentnahmen",
] as const;
export const EUER_AUSGABEN = [
  "waren",
  "fremdleistungen",
  "personal",
  "afaBeweglich",
  "gwg",
  "sammelposten",
  "restbuchwert",
  "miete",
  "telekommunikation",
  "reisekosten",
  "fortbildung",
  "beratung",
  "erhaltung",
  "beitraegeVersicherungen",
  "edv",
  "arbeitsmittel",
  "werbung",
  "schuldzinsenAnlage",
  "schuldzinsen",
  "vorsteuer",
  "gezahlteUst",
  "uebrige",
  "geschenke",
  "bewirtung",
  "verpflegung",
  "tagespauschale",
  "kfzLeasing",
  "kfzSteuerVersicherung",
  "kfzSonstige",
  "fahrtNutzungseinlage",
  "entfernungspauschale",
] as const;

export type EuerFigureKey = (typeof EUER_EINNAHMEN)[number] | (typeof EUER_AUSGABEN)[number];

/** Zeile der Anlage EÜR 2025 und amtlicher Text, für die Vorschau */
export const EUER_FIELDS: Record<
  EuerFigureKey | "bewirtungNichtAbziehbar" | "gewerbesteuerNichtAbziehbar" | "entnahmen" | "einlagen",
  { kz: string; label: string }
> = {
  kleinunternehmer: { kz: "E6000101", label: "Betriebseinnahmen als umsatzsteuerlicher Kleinunternehmer" },
  steuerpflichtig: { kz: "E6000401", label: "Umsatzsteuerpflichtige Betriebseinnahmen" },
  steuerfrei: {
    kz: "E6000501",
    label: "Umsatzsteuerfreie, nicht umsatzsteuerbare Betriebseinnahmen sowie Betriebseinnahmen, für die der Leistungsempfänger die Umsatzsteuer schuldet",
  },
  vereinnahmteUst: { kz: "E6000601", label: "Vereinnahmte Umsatzsteuer sowie Umsatzsteuer auf unentgeltliche Wertabgaben" },
  // Zeile 18; kein Vorzeichen erlaubt. Jahresdokumentation E77 2025 im ERiC-Dokumentationspaket (Datenarten/
  // ElsterErklaerung/EUER/Jahresdokumentation/Jahresdokumentation_E77_2025.ods): "GeldBetragMitCent ohne Vorzeichen";
  // Schema E77-2025.xsd und E77-2026.xsd: type="DezimalzahlNichtNegOhneFuehrNull..." mit Muster \d{1,12}(,\d{2,2}).
  erstatteteUst: { kz: "E6000701", label: "Vom Finanzamt erstattete und ggf. verrechnete Umsatzsteuer" },
  anlagenabgang: { kz: "E6000801", label: "Veräußerung oder Entnahme von Anlagevermögen" },
  privateKfz: { kz: "E6000901", label: "Private Kfz-Nutzung" },
  // Schema E77-2023 bis E77-2026 im Dokumentationspaket von ERiC 44.3.6.0 bzw. 45.1.5.0: /EUER/BEin/Entnahme_Sonst/Sum/E6001001
  // (2023 Zeile 20, ab 2024 Zeile 21); nicht E6301001, das ist dieselbe Zeile der Sonderbetriebseinnahmen
  sachentnahmen: { kz: "E6001001", label: "Sonstige Sach-, Nutzungs- und Leistungsentnahmen" },
  // Kennung und Element aus den ERiC-Plugins libcheckEUER_2023 bis _2025: /EUER/BAus/Ware_Rohstoff_Hilfsstoff/Sum/E6001601
  waren: { kz: "E6001601", label: "Waren, Rohstoffe und Hilfsstoffe einschließlich der Nebenkosten" },
  fremdleistungen: { kz: "E6001701", label: "Bezogene Fremdleistungen" },
  // Schema E77-2023 bis E77-2026 im ERiC-Paket: /EUER/BAus/Personal/Sum/E6001801
  personal: { kz: "E6001801", label: "Ausgaben für eigenes Personal (z. B. Gehälter, Löhne und Versicherungsbeiträge)" },
  afaBeweglich: { kz: "E6002101", label: "AfA auf bewegliche Wirtschaftsgüter" },
  gwg: { kz: "E6002301", label: "Aufwendungen für geringwertige Wirtschaftsgüter" },
  sammelposten: { kz: "E6003302", label: "Auflösung Sammelposten nach § 6 Abs. 2a EStG" },
  restbuchwert: { kz: "E6002401", label: "Restbuchwert der ausgeschiedenen Anlagegüter" },
  telekommunikation: { kz: "E6003901", label: "Aufwendungen für Telekommunikation (z. B. Telefon, Internet)" },
  reisekosten: { kz: "E6004004", label: "Übernachtungs- und Reisenebenkosten bei Geschäftsreisen" },
  fortbildung: { kz: "E6004003", label: "Fortbildungskosten" },
  beratung: { kz: "E6004801", label: "Rechts- und Steuerberatung, Buchführung" },
  beitraegeVersicherungen: { kz: "E6004402", label: "Beiträge, Gebühren, Abgaben und Versicherungen (ohne Kfz)" },
  edv: { kz: "E6004405", label: "Laufende EDV-Kosten" },
  arbeitsmittel: { kz: "E6004408", label: "Arbeitsmittel (z. B. Bürobedarf, Porto, Fachliteratur)" },
  werbung: { kz: "E6004501", label: "Werbekosten" },
  // Schema E77-2023 bis E77-2026: /EUER/BAus/Sonst_unbeschraenkt/Schuldzins_AnlageVerm/Sum/E6004202 und …/Schuldzins_Uebrige/Sum/E6004303
  schuldzinsenAnlage: {
    kz: "E6004202",
    label: "Schuldzinsen zur Finanzierung von Anschaffungs- und Herstellungskosten von Wirtschaftsgütern des Anlagevermögens",
  },
  schuldzinsen: { kz: "E6004303", label: "Übrige Schuldzinsen" },
  vorsteuer: { kz: "E6005001", label: "Gezahlte Vorsteuerbeträge" },
  // Zeile 58; wie E6000701 ohne Vorzeichen. ERiC 45.1.5.0 lehnt "-190,00" hier ab mit "Unzulässiges Vorzeichen.
  // Geldbeträge müssen ohne Vorzeichen eingetragen werden." (siehe euerVorzeichenMeldungen).
  gezahlteUst: { kz: "E6005101", label: "An das Finanzamt gezahlte und ggf. verrechnete Umsatzsteuer" },
  uebrige: { kz: "E6004901", label: "Übrige unbeschränkt abziehbare Betriebsausgaben" },
  kfzLeasing: { kz: "E6005801", label: "Leasingkosten für Kraftfahrzeuge" },
  kfzSteuerVersicherung: { kz: "E6005903", label: "Steuern, Versicherungen und Maut für Kraftfahrzeuge" },
  kfzSonstige: { kz: "E6006003", label: "Sonstige tatsächliche Fahrtkosten ohne AfA und Zinsen" },
  // Schema E77-2023 bis E77-2025 im Dokumentationspaket von ERiC 44.3.6.0: /EUER/BAus/Raumkosten_u_sonst/Miete_Pacht/Sum/E6003201
  // (Zeile 39, Kz 150) und /EUER/BAus/Sonst_unbeschraenkt/Erhaltungsaufwand/Sum/E6004313 (Zeile 48, Kz 225)
  miete: { kz: "E6003201", label: "Miete/Pacht für Geschäftsräume und betrieblich genutzte Grundstücke" },
  erhaltung: { kz: "E6004313", label: "Erhaltungsaufwendungen (z. B. Instandhaltung, Wartung, Reparatur; ohne solche für Gebäude und Kfz)" },
  // Kennungen und Reihenfolge wie im EÜR-Formular 2025 von EasyCash&Tax, das ECTElster in dieser Reihenfolge übermittelt
  geschenke: { kz: "E6004002", label: "Geschenke (abziehbar)" },
  bewirtung: { kz: "E6004102", label: "Bewirtungsaufwendungen (abziehbar)" },
  bewirtungNichtAbziehbar: { kz: "E6004101", label: "Bewirtungsaufwendungen (nicht abziehbar)" },
  // Schema E77-2023 bis E77-2026: /EUER/BAus/Beschr_abziehbar/Nicht_abziehbar/Sonst/Sum/E6004301, darf negativ sein
  gewerbesteuerNichtAbziehbar: {
    kz: "E6004301",
    label: "Sonstige beschränkt abziehbare Betriebsausgaben (nicht abziehbar): Gewerbesteuer, Hinterziehungszinsen",
  },
  verpflegung: { kz: "E6005002", label: "Verpflegungsmehraufwendungen" },
  tagespauschale: { kz: "E6006405", label: "Tagespauschale für die Tätigkeit in der häuslichen Wohnung" },
  fahrtNutzungseinlage: { kz: "E6006103", label: "Fahrtkosten für nicht zum Betriebsvermögen gehörende Fahrzeuge (Nutzungseinlage)" },
  // EUER/BAus/KFZ_u_Fahrtkosten/Entfernungspausch_Familienheimfahrt/Sum/E6003702 im Schema E77-2025.xsd und E77-2026.xsd
  // (ERiC-Dokumentation 44.3.6.0 und 45.1.5.0); Zeile 73 der Anlage EÜR 2025, Zeile 74 der Anlage EÜR 2026
  entfernungspauschale: {
    kz: "E6003702",
    label: "Mindestens abziehbare Kraftfahrzeugkosten für Wege zwischen Wohnung und Betriebsstätte, Familienheimfahrten (Entfernungspauschale)",
  },
  entnahmen: { kz: "E6006601", label: "Entnahmen einschließlich Sach-, Leistungs- und Nutzungsentnahmen" },
  einlagen: { kz: "E6006701", label: "Einlagen einschließlich Sach-, Leistungs- und Nutzungseinlagen" },
};
