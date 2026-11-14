import { finanzamtsnummer, formatEuro, type Cents } from "@haben/core";
import { germanDate } from "./bankverbindung.ts";
import { checkSteuernummer13, elsterDecimal, ElsterEingabeError, elsterXml, escapeXml, PRODUKT_NAME, TESTMERKER, wholeEuros } from "./xml.ts";

/**
 * Jahreserklärungen im Verfahren ElsterErklaerung: Umsatzsteuererklärung (E50, Datenart USt) und
 * Anlage EÜR mit Anlage AVEÜR (E77, Datenart EUER).
 *
 * Feldkennungen und Reihenfolge stammen aus Implementierungen, die damit erfolgreich an ELSTER
 * übermitteln (EasyCash&Tax ECTElster, viking, finamt); die amtliche Quelle ist die
 * Jahresdokumentation im ERiC-Paket. Das Finanzamt ändert die Vordrucke jährlich; vor dem
 * Echtversand prüft ERiC jedes XML gegen das Schema des Jahres (Prüfen bzw. Testübermittlung).
 */

/** Ab diesem Jahr gilt die Struktur mit den Tabelle-Elementen (E50) */
export const ERSTES_ERKLAERUNGSJAHR = 2023;

/** Element mit Text, mit Kindelementen oder weggelassen (undefined bzw. ohne Kinder) */
export type XmlNode = readonly [name: string, content: string | readonly (XmlNode | null | undefined | false)[] | undefined];

export function render(node: XmlNode | null | undefined | false, indent: string): string[] {
  if (!node) return [];
  const [name, content] = node;
  if (content === undefined) return [];
  if (typeof content === "string") return [`${indent}<${name}>${escapeXml(content)}</${name}>`];
  const children = content.flatMap((child) => render(child, `${indent}  `));
  if (children.length === 0) return [];
  return [`${indent}<${name}>`, ...children, `${indent}</${name}>`];
}

/** Betrag mit Cent, leer bei 0 (das Feld entfällt dann) */
const amount = (cents: Cents | undefined): string | undefined => (cents ? elsterDecimal(cents) : undefined);

/** TT.MM.JJJJ */

export interface ErklaerungAbsender {
  name: string;
  strasse: string;
  plz: string;
  ort: string;
}

export interface Envelope {
  datenArt: "USt" | "EUER" | "ESt" | "GewSt" | "KSt";
  year: number;
  steuernummer13: string;
  /** Kürzel des Bundeslands, z. B. "BW"; Empfänger im TransferHeader */
  bundesland: string;
  absender: ErklaerungAbsender;
  herstellerId: string;
  produktVersion: string;
  test: boolean;
}

export function checkEnvelope(input: Envelope) {
  checkSteuernummer13(input.steuernummer13);
  if (!Number.isInteger(input.year) || input.year < ERSTES_ERKLAERUNGSJAHR) {
    throw new ElsterEingabeError(`Jahreserklärungen gehen ab ${ERSTES_ERKLAERUNGSJAHR}, nicht für ${input.year}.`);
  }
  if (!/^[A-Z]{2}$/.test(input.bundesland)) throw new ElsterEingabeError(`Bundesland fehlt: ${input.bundesland}`);
}

/** Identifikationsnummern stehen bei der Einkommensteuer im Vorsatz, nicht in den Personendaten */
export function vorsatz(unterfallart: "10" | "20" | "30" | "50" | "77", input: Envelope, idnr?: { a: string; b?: string }): XmlNode {
  const a = input.absender;
  return [
    "Vorsatz",
    [
      ["Unterfallart", unterfallart],
      ["Vorgang", "01"],
      ["StNr", input.steuernummer13],
      ["ID", idnr?.a],
      ["IDEhefrau", idnr?.b],
      ["Zeitraum", String(input.year)],
      ["AbsName", a.name.slice(0, 45)],
      ["AbsStr", a.strasse.slice(0, 30)],
      ["AbsPlz", a.plz],
      ["AbsOrt", a.ort.slice(0, 29)],
      ["Copyright", PRODUKT_NAME],
      ["OrdNrArt", "S"],
      // 2 = kein elektronischer Bescheid über diesen Weg; der Bescheid kommt wie gewohnt
      ["Rueckuebermittlung", [["Bescheid", "2"]]],
    ],
  ];
}

export function envelope(input: Envelope, nutzdaten: string[]): string {
  const a = input.absender;
  return elsterXml(
    {
      verfahren: "ElsterErklaerung",
      datenArt: input.datenArt,
      testmerker: input.test ? TESTMERKER : undefined,
      ziel: input.bundesland,
      herstellerId: input.herstellerId,
      datenlieferant: `${a.name}, ${a.strasse}, ${a.plz} ${a.ort}`,
    },
    [{ ticket: "1", empfaenger: { id: "F", wert: finanzamtsnummer(input.steuernummer13) }, produktVersion: input.produktVersion, nutzdaten }],
  );
}

// ------------------------------------------------------------------ Umsatzsteuererklärung

export interface UstErklaerungFigures {
  /** Bemessungsgrundlage 19 % bzw. 7 % in Cent; ELSTER nimmt volle Euro */
  base19: Cents;
  tax19: Cents;
  base7: Cents;
  tax7: Cents;
  /** Abziehbare Vorsteuer aus Rechnungen (Kz 66) */
  vorsteuer: Cents;
  /** Vorauszahlungssoll: Summe der Voranmeldungen des Jahres */
  vorauszahlungen: Cents;
  /** Steuerfreie innergemeinschaftliche Lieferungen (Kz 41, E3103301) */
  kz41?: Cents;
  /** Ausfuhrlieferungen (Kz 43, E3103801; bis 2024 zählt E3104201 mit) */
  kz43?: Cents;
  /** Innergemeinschaftlicher Erwerb: Bemessung und Erwerbsteuer 19 % (Kz 89, E3100902/E3100903) */
  kz89?: Cents;
  tax89?: Cents;
  /** Innergemeinschaftlicher Erwerb 7 % (Kz 93, E3101301/E3101302) */
  kz93?: Cents;
  tax93?: Cents;
  /** § 13b als Leistungsempfänger: Bemessung und Steuer EU (Kz 46/47, E3102205/E3102206) */
  kz46?: Cents;
  kz47?: Cents;
  /** § 13b Drittland (Kz 84/85, E3102503/E3102504) */
  kz84?: Cents;
  kz85?: Cents;
  /** Im Inland nicht steuerbare Leistungen, Ort im EU-Ausland (Kz 21, E3105702) */
  kz21?: Cents;
  /** Nicht steuerbare Umsätze Drittland (Kz 45, E3105801) */
  kz45?: Cents;
  /** Vorsteuer aus innergemeinschaftlichem Erwerb (Kz 61, E3006301) */
  kz61?: Cents;
  /** Entstandene Einfuhrumsatzsteuer (Kz 62, E3006401) */
  kz62?: Cents;
  /** Vorsteuer aus §-13b-Leistungen (Kz 67, E3006502) */
  kz67?: Cents;
}

export interface UstErklaerungResult {
  /** Umsatzsteuer abzüglich Vorsteuer; negativ = Überschuss */
  steuer: Cents;
  /** Abschlusszahlung (positiv) bzw. Erstattung (negativ) */
  abschluss: Cents;
}

export function ustErklaerungResult(f: UstErklaerungFigures): UstErklaerungResult {
  const steuer =
    f.tax19 + f.tax7 + (f.tax89 ?? 0) + (f.tax93 ?? 0) + (f.kz47 ?? 0) + (f.kz85 ?? 0) - (f.vorsteuer + (f.kz61 ?? 0) + (f.kz62 ?? 0) + (f.kz67 ?? 0));
  return { steuer, abschluss: steuer - f.vorauszahlungen };
}

/** true, wenn alle Beträge der Erklärung 0 sind (das Vorauszahlungssoll zählt nicht): eine Nullerklärung geht über das ELSTER-Portal */
export function ustErklaerungLeer(f: UstErklaerungFigures): boolean {
  const betraege: (Cents | undefined)[] = [
    f.base19,
    f.tax19,
    f.base7,
    f.tax7,
    f.vorsteuer,
    f.kz41,
    f.kz43,
    f.kz89,
    f.tax89,
    f.kz93,
    f.tax93,
    f.kz46,
    f.kz47,
    f.kz84,
    f.kz85,
    f.kz21,
    f.kz45,
    f.kz61,
    f.kz62,
    f.kz67,
  ];
  return betraege.every((betrag) => (betrag ?? 0) === 0);
}

export interface UstErklaerungXmlInput extends Omit<Envelope, "datenArt"> {
  versteuerung: "soll" | "ist";
  figures: UstErklaerungFigures;
}

const kz = (wert: Cents | undefined) => wert ?? 0;

/** Steuerfreie Umsätze mit Vorsteuerabzug (Kz 41 und 43); die Summenzeile entfällt ab 2025 (USt_30415 bis 2024) */
function ust2aStfrei(f: UstErklaerungFigures, year: number): XmlNode | false {
  return (
    (kz(f.kz41) !== 0 || kz(f.kz43) !== 0) && [
      "Ums_stfrei",
      [
        [
          "Tabelle",
          [
            [
              "Mit_VoSt_Abz",
              [
                kz(f.kz41) !== 0 && ["Ig_Lfg", [["E3103301", wholeEuros(f.kz41!)]]],
                kz(f.kz43) !== 0 && ["Ums_stfrei_weit", [["E3103801", wholeEuros(f.kz43!)], year <= 2024 && ["E3104201", wholeEuros(f.kz43!)]]],
              ],
            ],
          ],
        ],
      ],
    ]
  );
}

/** Innergemeinschaftlicher Erwerb zu 19 und 7 % mit der Summe der Erwerbsteuer (Kz 89, 93) */
function ust2aIgErw(f: UstErklaerungFigures, igErwerbSteuer: Cents): XmlNode | false {
  return (
    (kz(f.kz89) !== 0 || kz(f.kz93) !== 0) && [
      "Ig_Erw",
      [
        [
          "Tabelle",
          [
            [
              "Stpfl",
              [
                kz(f.kz89) !== 0 && ["E3100902", wholeEuros(f.kz89!)],
                kz(f.tax89) !== 0 && ["E3100903", elsterDecimal(f.tax89!)],
                kz(f.kz93) !== 0 && ["E3101301", wholeEuros(f.kz93!)],
                kz(f.tax93) !== 0 && ["E3101302", elsterDecimal(f.tax93!)],
              ],
            ],
            ["Ig_Erw_Sum", [["E3101501", elsterDecimal(igErwerbSteuer)]]],
          ],
        ],
      ],
    ]
  );
}

/** Leistungen nach § 13b UStG als Leistungsempfänger: EU (Kz 46/47) und Drittland (Kz 84/85) mit Summe der Steuer */
function ust2a13b(f: UstErklaerungFigures, s13bSteuer: Cents): XmlNode | false {
  return (
    (kz(f.kz46) !== 0 || kz(f.kz84) !== 0 || s13bSteuer !== 0) && [
      "Ums_13b",
      [
        [
          "Tabelle",
          [
            kz(f.kz46) !== 0 && ["E3102205", wholeEuros(f.kz46!)],
            kz(f.kz47) !== 0 && ["E3102206", elsterDecimal(f.kz47!)],
            kz(f.kz84) !== 0 && ["E3102503", wholeEuros(f.kz84!)],
            kz(f.kz85) !== 0 && ["E3102504", elsterDecimal(f.kz85!)],
            ["Ums_13b_Sum", [["E3102601", elsterDecimal(s13bSteuer)]]],
          ],
        ],
      ],
    ]
  );
}

/** Ergänzende Angaben zu den Umsätzen: Leistungsort EU-Ausland (Kz 21) oder Drittland (Kz 45) */
function ust2aErgAng(f: UstErklaerungFigures): XmlNode | false {
  return (
    (kz(f.kz21) !== 0 || kz(f.kz45) !== 0) && [
      "Erg_Ang_Ums",
      [
        [
          "Tabelle",
          [
            ["E3105702", f.kz21 ? wholeEuros(f.kz21) : undefined],
            ["E3105801", f.kz45 ? wholeEuros(f.kz45) : undefined],
          ],
        ],
      ],
    ]
  );
}

/** Abziehbare Vorsteuer: aus Rechnungen (Kz 66), Erwerben (61), Einfuhr (62) und §-13b-Leistungen (67) mit Summe */
function ust2aVorsteuer(f: UstErklaerungFigures, vorsteuer: Cents): XmlNode | false {
  return (
    vorsteuer !== 0 && [
      "Abz_VoSt",
      [
        [
          "Tabelle",
          [
            f.vorsteuer !== 0 && ["E3006201", elsterDecimal(f.vorsteuer)],
            kz(f.kz61) !== 0 && ["E3006301", elsterDecimal(f.kz61!)],
            kz(f.kz62) !== 0 && ["E3006401", elsterDecimal(f.kz62!)],
            kz(f.kz67) !== 0 && ["E3006502", elsterDecimal(f.kz67!)],
            ["Abz_VoSt_Sum", [["E3006901", elsterDecimal(vorsteuer)]]],
          ],
        ],
      ],
    ]
  );
}

/** Berechnung der Umsatzsteuer: Übertrag der Summen, verbleibende Steuer, Vorauszahlungssoll und Abschluss */
function ust2aBerechnung(
  f: UstErklaerungFigures,
  teile: { umsatzsteuer: Cents; igErwerbSteuer: Cents; s13bSteuer: Cents; vorsteuer: Cents; steuer: Cents; abschluss: Cents },
): XmlNode {
  const ustGesamt = teile.umsatzsteuer + teile.igErwerbSteuer + teile.s13bSteuer;
  return [
    "Berech_USt",
    [
      [
        "Tabelle",
        [
          ["E3009201", amount(teile.umsatzsteuer)],
          ["E3009401", amount(teile.igErwerbSteuer)],
          ["E3009502", amount(teile.s13bSteuer)],
          ["E3009801", amount(ustGesamt)],
          ["E3009901", amount(teile.vorsteuer)],
          // USt_30907: E3010201 nicht ohne eine der Summen E3009801/E3009901
          (ustGesamt !== 0 || teile.vorsteuer !== 0) && ["E3010201", elsterDecimal(teile.steuer)],
          // Umsatzsteuer bzw. Überschuss (mit Minus); USt_30914/30909: genau dann, wenn E3010201 dasteht, auch mit 0,00
          (ustGesamt !== 0 || teile.vorsteuer !== 0) && ["E3010601", elsterDecimal(teile.steuer)],
          [
            "Verbl_USt",
            [
              ["E3011101", elsterDecimal(teile.steuer)],
              ["E3011301", elsterDecimal(f.vorauszahlungen)],
            ],
          ],
          ["Zahl_Erstatt", [["E3011401", elsterDecimal(teile.abschluss)]]],
        ],
      ],
    ],
  ];
}

export function buildUstErklaerungXml(input: UstErklaerungXmlInput): string {
  const envelopeInput: Envelope = { ...input, datenArt: "USt" };
  checkEnvelope(envelopeInput);
  const f = input.figures;
  const umsatzsteuer = f.tax19 + f.tax7;
  const igErwerbSteuer = kz(f.tax89) + kz(f.tax93);
  const s13bSteuer = kz(f.kz47) + kz(f.kz85);
  const vorsteuer = f.vorsteuer + kz(f.kz61) + kz(f.kz62) + kz(f.kz67);
  if (ustErklaerungLeer(f)) {
    throw new ElsterEingabeError("Ohne Umsätze und Vorsteuer gibt es nichts zu erklären; eine Nullerklärung geht über das ELSTER-Portal.");
  }
  const { steuer, abschluss } = ustErklaerungResult(f);
  const a = input.absender;
  // Summen nur mit mindestens einer Zeile darunter, sonst lehnt ERiC sie ab (Regeln 30900/30901, 30452)
  const ust2a: XmlNode = [
    "USt2A",
    [
      [
        "Allg",
        [
          [
            "Unternehmen",
            [
              ["E3000901", a.name.slice(0, 45)],
              [
                "Adr",
                [
                  ["E3001101", a.strasse],
                  ["E3001206", a.plz],
                  ["E3001207", a.ort],
                ],
              ],
            ],
          ],
          ["Best_Art", [["E3002203", input.versteuerung === "soll" ? "1" : "2"]]],
        ],
      ],
      umsatzsteuer !== 0 && [
        "Umsaetze",
        [
          [
            "Tabelle",
            [
              f.base19 !== 0 && [
                "Ums_allg",
                [
                  ["E3003303", wholeEuros(f.base19)],
                  ["E3003304", elsterDecimal(f.tax19)],
                ],
              ],
              f.base7 !== 0 && [
                "Ums_erm",
                [
                  ["E3004401", wholeEuros(f.base7)],
                  ["E3004402", elsterDecimal(f.tax7)],
                ],
              ],
              ["Ums_Sum", [["E3006001", elsterDecimal(umsatzsteuer)]]],
            ],
          ],
        ],
      ],
      ust2aStfrei(f, input.year),
      ust2aIgErw(f, igErwerbSteuer),
      ust2a13b(f, s13bSteuer),
      ust2aErgAng(f),
      ust2aVorsteuer(f, vorsteuer),
      ust2aBerechnung(f, { umsatzsteuer, igErwerbSteuer, s13bSteuer, vorsteuer, steuer, abschluss }),
    ],
  ];
  const e50 = [
    `<E50 xmlns="http://finkonsens.de/elster/elstererklaerung/ust/e50/v${input.year}" version="${input.year}">`,
    ...render(ust2a, "  "),
    ...render(vorsatz("50", envelopeInput), "  "),
    `</E50>`,
  ];
  return envelope(envelopeInput, e50);
}

// ------------------------------------------------------------------ Anlage EÜR

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

/**
 * Meldungen zu Beträgen, die die Anlage EÜR nicht aufnimmt: negative Werte in Zeile 58 (E6005101) und Zeile 18
 * (E6000701). Fundstelle: Jahresdokumentation E77 2025 des ERiC-Dokumentationspakets 44.3.6.0/45.1.5.0, Felder
 * E6005101 und E6000701: „GeldBetragMitCent ohne Vorzeichen, mit 12 Vorkommastellen“; die Schemata E77-2025.xsd und
 * E77-2026.xsd führen beide als „DezimalzahlNichtNegOhneFuehrNull…“ (Muster \d{1,12}(,\d{2,2})), während E6004301 dort
 * als „DezimalzahlOhneFuehrNull…“ mit optionalem Minus steht. ERiC 45.1.5.0 antwortet auf -190,00: „Unzulässiges
 * Vorzeichen. Geldbeträge müssen ohne Vorzeichen eingetragen werden.“ Wie der Betrag stattdessen einzutragen ist,
 * entscheidet euerUstUmgliedern (Vorgabe aus #708, Issue #933); diese Meldung bleibt der Rückfall, falls danach doch
 * noch ein negativer Betrag übrig ist.
 * Zeilennummern nach der Anleitung zur Anlage EÜR 2024 und 2025 (Zeile 18 und 58; 2023 waren es Zeile 17 und 56). Ein
 * negativer Betrag entsteht erst im Jahr nach einer aus Haben übermittelten EÜR (#706), frühestens 2024.
 */
export function euerVorzeichenMeldungen(f: EuerFigures): string[] {
  const felder = [
    { wert: f.gezahlteUst, zeile: 58, ...EUER_FIELDS.gezahlteUst },
    { wert: f.erstatteteUst, zeile: 18, ...EUER_FIELDS.erstatteteUst },
  ];
  return felder
    .filter((feld) => (feld.wert ?? 0) < 0)
    .map(
      (feld) =>
        `In Zeile ${feld.zeile} (Kz ${feld.kz}, „${feld.label}“) steht ein negativer Betrag von ${formatEuro(feld.wert!)}. Die Anlage EÜR nimmt dort nur Beträge ohne Vorzeichen an; ELSTER lehnt negative Werte mit „Unzulässiges Vorzeichen“ ab. Der Betrag gehört in die andere der beiden Zeilen; diese Meldung erscheint nur, wenn das Umgliedern nicht greift.`,
    );
}

export interface EuerUstGliederung {
  /** Beträge für die Anlage EÜR: Zeile 18 und Zeile 58 ohne Vorzeichen */
  figures: EuerFigures;
  /** Was umgegliedert wurde, je Zeile eine Meldung für die Vorprüfung */
  umgliederungen: string[];
}

/**
 * Gliedert einen negativen Saldo zwischen Zeile 58 (E6005101, an das Finanzamt gezahlte Umsatzsteuer) und Zeile 18
 * (E6000701, vom Finanzamt erstattete Umsatzsteuer) um, statt ihn mit Vorzeichen zu übermitteln (#933, Vorgabe aus
 * #708): Ein negativer Betrag in Zeile 58 heißt, dass im Jahr mehr Umsatzsteuer erstattet als gezahlt wurde. Die
 * Erstattung ist eine Betriebseinnahme und gehört in Zeile 18; die Zahlung ist eine Betriebsausgabe in Zeile 58.
 * Beide Zeilen weisen den Betrag getrennt und ohne Vorzeichen aus, umgekehrt genauso für einen negativen Betrag in
 * Zeile 18. Sind beide Zeilen negativ, zählt der Saldo des Jahres: überwiegt die Erstattung, steht er in Zeile 18,
 * überwiegt die Zahlung in Zeile 58; die Meldung nennt die Beträge, die dort tatsächlich standen. Der Gewinn der Anlage EÜR ändert sich dadurch nicht, weil derselbe Betrag auf der anderen Seite der
 * Ermittlung steht; gebuchte Daten bleiben unverändert.
 */
export function euerUstUmgliedern(f: EuerFigures): EuerUstGliederung {
  const gezahlteUst = f.gezahlteUst ?? 0;
  const erstatteteUst = f.erstatteteUst ?? 0;
  if (gezahlteUst >= 0 && erstatteteUst >= 0) return { figures: f, umgliederungen: [] };
  const kzGezahlt = EUER_FIELDS.gezahlteUst.kz;
  const kzErstattet = EUER_FIELDS.erstatteteUst.kz;
  const schluss = "beide Zeilen ohne Vorzeichen. Der Gewinn bleibt gleich, gebuchte Daten ändern sich nicht.";
  if (gezahlteUst < 0 && erstatteteUst < 0) {
    // Beide Zeilen seitenverkehrt: eine Meldung nennt die Beträge, die dort standen, und das Ergebnis des Jahres
    const saldo = gezahlteUst - erstatteteUst; // positiv: unterm Strich gezahlt, negativ: erstattet
    const stand = `In Zeile 58 (Kz ${kzGezahlt}, „${EUER_FIELDS.gezahlteUst.label}“) standen ${formatEuro(-gezahlteUst)} und in Zeile 18 (Kz ${kzErstattet}, „${EUER_FIELDS.erstatteteUst.label}“) standen ${formatEuro(-erstatteteUst)}, beide mit Vorzeichen:`;
    const ergebnis =
      saldo > 0
        ? ` unterm Strich wurden ${formatEuro(saldo)} Umsatzsteuer gezahlt. Der Betrag steht jetzt als Betriebsausgabe in Zeile 58, Zeile 18 bleibt leer,`
        : saldo < 0
          ? ` unterm Strich wurde ${formatEuro(-saldo)} Umsatzsteuer erstattet. Der Betrag steht jetzt als Betriebseinnahme in Zeile 18, Zeile 58 bleibt leer,`
          : " die Beträge heben sich auf, beide Zeilen bleiben leer,";
    return {
      figures: { ...f, gezahlteUst: Math.max(saldo, 0), erstatteteUst: Math.max(-saldo, 0) },
      umgliederungen: [stand + ergebnis + " " + schluss],
    };
  }
  if (gezahlteUst < 0) {
    return {
      figures: { ...f, gezahlteUst: 0, erstatteteUst: erstatteteUst + -gezahlteUst },
      umgliederungen: [
        `In Zeile 58 (Kz ${kzGezahlt}, „${EUER_FIELDS.gezahlteUst.label}“) standen ${formatEuro(-gezahlteUst)}: im Jahr wurde mehr Umsatzsteuer erstattet als gezahlt. Der Betrag steht in der Anlage EÜR jetzt als Betriebseinnahme in Zeile 18 (Kz ${kzErstattet}, „${EUER_FIELDS.erstatteteUst.label}“), ${schluss}`,
      ],
    };
  }
  return {
    figures: { ...f, gezahlteUst: gezahlteUst + -erstatteteUst, erstatteteUst: 0 },
    umgliederungen: [
      `In Zeile 18 (Kz ${kzErstattet}, „${EUER_FIELDS.erstatteteUst.label}“) standen ${formatEuro(-erstatteteUst)}: im Jahr wurde mehr Umsatzsteuer gezahlt als erstattet. Der Betrag steht in der Anlage EÜR jetzt als Betriebsausgabe in Zeile 58 (Kz ${kzGezahlt}, „${EUER_FIELDS.gezahlteUst.label}“), ${schluss}`,
    ],
  };
}

export function euerTotals(f: EuerFigures): { einnahmen: Cents; ausgaben: Cents; gewinn: Cents } {
  const einnahmen = EUER_EINNAHMEN.reduce((s, k) => s + (f[k] ?? 0), 0);
  const ausgaben = EUER_AUSGABEN.reduce((s, k) => s + (f[k] ?? 0), 0);
  return { einnahmen, ausgaben, gewinn: einnahmen - ausgaben };
}

/** Gruppen der Anlage AVEÜR für bewegliche Wirtschaftsgüter */
export type AveuerGruppe = "kfz" | "buero" | "andere";

export interface AveuerAnlage {
  gruppe: AveuerGruppe | "sammelposten";
  bezeichnung: string;
  /** ISO-Datum */
  anschaffung: string;
  anschaffungskosten: Cents;
  /** Buchwert zu Beginn des Jahres; bei Anschaffung im Jahr die Anschaffungskosten */
  buchwertBeginn: Cents;
  afa: Cents;
  /** Restbuchwert beim Ausscheiden */
  abgang: Cents;
  buchwertEnde: Cents;
  /** Nur Kfz: Elektro- oder extern aufladbares Hybridfahrzeug (Pflichtangabe in der AVEÜR) */
  elektro?: boolean;
}

/** Feldkennungen je Gruppe: Einzelangaben und Summe (AVEÜR 2025) */
const AVEUER_GRUPPEN: Record<
  AveuerGruppe,
  {
    kontext: string;
    einz: { bez: string; datum: string; ak: string; bwBeginn: string; afa: string; abgang: string; bwEnde: string };
    sum: { ak: string; bwBeginn: string; afa: string; abgang: string; bwEnde: string };
  }
> = {
  kfz: {
    kontext: "KFZ",
    einz: { bez: "E6007311", datum: "E6007326", ak: "E6007312", bwBeginn: "E6007314", afa: "E6007320", abgang: "E6007322", bwEnde: "E6007324" },
    sum: { ak: "E6007313", bwBeginn: "E6007315", afa: "E6007321", abgang: "E6007323", bwEnde: "E6007325" },
  },
  buero: {
    kontext: "Buero",
    einz: { bez: "E6007331", datum: "E6007346", ak: "E6007332", bwBeginn: "E6007334", afa: "E6007340", abgang: "E6007342", bwEnde: "E6007344" },
    sum: { ak: "E6007333", bwBeginn: "E6007335", afa: "E6007341", abgang: "E6007343", bwEnde: "E6007345" },
  },
  andere: {
    kontext: "Andere",
    einz: { bez: "E6007351", datum: "E6007366", ak: "E6007352", bwBeginn: "E6007354", afa: "E6007360", abgang: "E6007362", bwEnde: "E6007364" },
    sum: { ak: "E6007353", bwBeginn: "E6007355", afa: "E6007361", abgang: "E6007363", bwEnde: "E6007365" },
  },
};

/** Sammelposten des Jahres und der vier Vorjahre: Kontext und Felder (AK, Buchwert Beginn, Auflösung, Buchwert Ende) */
const SAMMELPOSTEN_VORJAHRE = [
  { kontext: "Sammelposten_VZm1", ak: "E6017391", bwBeginn: "E6017392", afa: "E6017393", bwEnde: "E6017394" },
  { kontext: "Sammelposten_VZm2", ak: "E6017395", bwBeginn: "E6017396", afa: "E6017397", bwEnde: "E6017398" },
  { kontext: "Sammelposten_VZm3", ak: "E6017400", bwBeginn: "E6017401", afa: "E6017402", bwEnde: "E6017403" },
  { kontext: "Sammelposten_VZm4", ak: "E6017404", bwBeginn: "E6017405", afa: "E6017406", bwEnde: undefined },
] as const;

const sum = (list: AveuerAnlage[], key: "anschaffungskosten" | "buchwertBeginn" | "afa" | "abgang" | "buchwertEnde") => list.reduce((s, a) => s + a[key], 0);

function aveuer(year: number, anlagen: AveuerAnlage[]): XmlNode | null {
  const beweglich = (["kfz", "buero", "andere"] as const).map((gruppe) => {
    const list = anlagen.filter((a) => a.gruppe === gruppe);
    if (list.length === 0) return null;
    const { kontext, einz, sum: s } = AVEUER_GRUPPEN[gruppe];
    return [
      kontext,
      [
        ...list.map(
          (a): XmlNode => [
            "Einz",
            [
              [einz.bez, a.bezeichnung.slice(0, 100)],
              [einz.datum, germanDate(a.anschaffung)],
              [einz.ak, elsterDecimal(a.anschaffungskosten)],
              [einz.bwBeginn, elsterDecimal(a.buchwertBeginn)],
              [einz.afa, amount(a.afa)],
              [einz.abgang, amount(a.abgang)],
              [einz.bwEnde, elsterDecimal(a.buchwertEnde)],
              // Antrieb des Kfz verlangt das Formular ab 2025
              gruppe === "kfz" && year >= 2025 ? ["E6007327", a.elektro ? "1" : "2"] : null,
            ],
          ],
        ),
        [
          "Sum",
          [
            [s.ak, elsterDecimal(sum(list, "anschaffungskosten"))],
            [s.bwBeginn, amount(sum(list, "buchwertBeginn"))],
            [s.afa, amount(sum(list, "afa"))],
            [s.abgang, amount(sum(list, "abgang"))],
            [s.bwEnde, elsterDecimal(sum(list, "buchwertEnde"))],
            gruppe === "kfz" && year >= 2025 ? ["E6007328", list.some((a) => a.elektro) ? "1" : "2"] : null,
          ],
        ],
      ],
    ] as XmlNode;
  });
  const afaBeweglich = sum(
    anlagen.filter((a) => a.gruppe !== "sammelposten"),
    "afa",
  );

  const sammel = anlagen.filter((a) => a.gruppe === "sammelposten");
  const sammelJahr = sammel.filter((a) => Number(a.anschaffung.slice(0, 4)) === year);
  const sammelNodes: XmlNode[] = [];
  if (sammelJahr.length > 0) {
    sammelNodes.push([
      "Sammelposten_VZ",
      [
        ...sammelJahr.map(
          (a): XmlNode => [
            "Einz",
            [
              ["E6007381", a.bezeichnung.slice(0, 100)],
              ["E6007384", elsterDecimal(a.anschaffungskosten)],
              ["E6007385", amount(a.afa)],
              ["E6007386", elsterDecimal(a.buchwertEnde)],
            ],
          ],
        ),
        [
          "Sum",
          [
            ["E6007393", elsterDecimal(sum(sammelJahr, "anschaffungskosten"))],
            ["E6007394", amount(sum(sammelJahr, "afa"))],
            ["E6007395", elsterDecimal(sum(sammelJahr, "buchwertEnde"))],
          ],
        ],
      ],
    ]);
  }
  SAMMELPOSTEN_VORJAHRE.forEach((fields, i) => {
    const list = sammel.filter((a) => Number(a.anschaffung.slice(0, 4)) === year - i - 1);
    if (list.length === 0) return;
    sammelNodes.push([
      fields.kontext,
      [
        [fields.ak, elsterDecimal(sum(list, "anschaffungskosten"))],
        [fields.bwBeginn, elsterDecimal(sum(list, "buchwertBeginn"))],
        [fields.afa, amount(sum(list, "afa"))],
        fields.bwEnde ? [fields.bwEnde, elsterDecimal(sum(list, "buchwertEnde"))] : null,
      ],
    ]);
  });
  const sammelAfa = sum(sammel, "afa");

  if (beweglich.every((n) => n === null) && sammelNodes.length === 0) return null;
  return [
    "AVEUER",
    [
      ["Bewegliche_WG", [...beweglich, ["GesamtSum", [["E6007372", amount(afaBeweglich)]]]]],
      ...sammelNodes,
      sammelNodes.length > 0 ? ["GesamtSum", [["E6017399", amount(sammelAfa)]]] : null,
    ],
  ];
}

export interface EuerAllgemein {
  /** Art des Betriebs, z. B. „Softwareentwicklung“ */
  artDesBetriebs: string;
  einkunftsart: "gewerbe" | "selbstaendig";
}

export interface EuerXmlInput extends Omit<Envelope, "datenArt"> {
  allgemein: EuerAllgemein;
  figures: EuerFigures;
  anlagen: AveuerAnlage[];
}

/** Rechtsform-Schlüssel für Einzelunternehmer: Einzelgewerbetreibende bzw. Angehörige freier Berufe */
const RECHTSFORM = { gewerbe: "120", selbstaendig: "140" } as const;
/** Einkunftsart: 2 = Gewerbebetrieb, 3 = selbständige Arbeit */
const EINKUNFTSART = { gewerbe: "2", selbstaendig: "3" } as const;

const sumNode = (kontext: string, kz: string, cents: Cents | undefined): XmlNode | null => (cents ? [kontext, [["Sum", [[kz, elsterDecimal(cents)]]]]] : null);

export function buildEuerXml(input: EuerXmlInput): string {
  const envelopeInput: Envelope = { ...input, datenArt: "EUER" };
  checkEnvelope(envelopeInput);
  // Ein negativer Saldo aus Zeile 58 oder 18 wird umgegliedert, nicht mit Vorzeichen gesendet (#933, Vorgabe aus #708)
  const { figures: f } = euerUstUmgliedern(input.figures);
  // Rückfall: bliebe danach ein negativer Betrag übrig, nimmt ihn die Anlage EÜR nicht an
  const vorzeichen = euerVorzeichenMeldungen(f);
  if (vorzeichen.length > 0) throw new ElsterEingabeError(vorzeichen.join(" "));
  const { einnahmen, ausgaben, gewinn } = euerTotals(f);
  const kz = (key: EuerFigureKey) => EUER_FIELDS[key].kz;

  const euer: XmlNode = [
    "EUER",
    [
      [
        "Allg",
        [
          ["E6000016", input.absender.name],
          ["E6000017", input.allgemein.artDesBetriebs],
          ["E6000602", RECHTSFORM[input.allgemein.einkunftsart]],
          ["E6000603", EINKUNFTSART[input.allgemein.einkunftsart]],
          // Betriebsinhaber: die steuerpflichtige Person
          ["E6000604", "1"],
          // Keine Veräußerung oder Entnahme von Grundstücken
          ["E6000019", "2"],
        ],
      ],
      [
        "BEin",
        [
          sumNode("Kleinunternehmer", kz("kleinunternehmer"), f.kleinunternehmer),
          sumNode("USt_StPflicht", kz("steuerpflichtig"), f.steuerpflichtig),
          sumNode("USt_StFrei", kz("steuerfrei"), f.steuerfrei),
          sumNode("USt_Vereinnahmt_Unentgeltl", kz("vereinnahmteUst"), f.vereinnahmteUst),
          sumNode("USt_Erstattet_Verrechnet", kz("erstatteteUst"), f.erstatteteUst),
          sumNode("Anlagevermoegen", kz("anlagenabgang"), f.anlagenabgang),
          sumNode("Nutzung_Priv_Kfz", kz("privateKfz"), f.privateKfz),
          // Im Schema direkt nach der Kfz-Nutzung, vor Weitere_Angabe (2023) bzw. Ruecklagen_Ausgleichsposten (ab 2024)
          sumNode("Entnahme_Sonst", kz("sachentnahmen"), f.sachentnahmen),
          // Summe der Einnahmen: 2023 unter „Weitere_Angabe“, ab 2024 unter „GesamtSum“
          [input.year >= 2024 ? "GesamtSum" : "Weitere_Angabe", [["E6001201", elsterDecimal(einnahmen)]]],
        ],
      ],
      [
        "BAus",
        [
          sumNode("Ware_Rohstoff_Hilfsstoff", kz("waren"), f.waren),
          sumNode("Fremdleistung", kz("fremdleistungen"), f.fremdleistungen),
          sumNode("Personal", kz("personal"), f.personal),
          [
            "AfA",
            [
              [kz("afaBeweglich"), amount(f.afaBeweglich)],
              sumNode("Wirtschaftsgut_geringwertig", kz("gwg"), f.gwg),
              [
                "Weitere_Angabe",
                [
                  [kz("sammelposten"), amount(f.sammelposten)],
                  [kz("restbuchwert"), amount(f.restbuchwert)],
                ],
              ],
            ],
          ],
          // Zeile 39; im Schema zwischen AfA und den sonstigen unbeschränkt abziehbaren Betriebsausgaben
          ["Raumkosten_u_sonst", [sumNode("Miete_Pacht", kz("miete"), f.miete)]],
          [
            "Sonst_unbeschraenkt",
            [
              sumNode("Kommunikation", kz("telekommunikation"), f.telekommunikation),
              sumNode("Auswertstaetigkeit", kz("reisekosten"), f.reisekosten),
              sumNode("Fortbildung", kz("fortbildung"), f.fortbildung),
              sumNode("Rechtsberatung_StB_Buchf", kz("beratung"), f.beratung),
              // Zeile 48; im Schema nach Miete/Leasing beweglicher Wirtschaftsgüter, vor den Beiträgen
              sumNode("Erhaltungsaufwand", kz("erhaltung"), f.erhaltung),
              sumNode("Beitrag_Gebuehr_Abgabe_Versicherung", kz("beitraegeVersicherungen"), f.beitraegeVersicherungen),
              sumNode("EDV", kz("edv"), f.edv),
              sumNode("Arbeitsmittel", kz("arbeitsmittel"), f.arbeitsmittel),
              sumNode("Werbung", kz("werbung"), f.werbung),
              sumNode("Schuldzins_AnlageVerm", kz("schuldzinsenAnlage"), f.schuldzinsenAnlage),
              sumNode("Schuldzins_Uebrige", kz("schuldzinsen"), f.schuldzinsen),
              sumNode("Vorsteuer", kz("vorsteuer"), f.vorsteuer),
              sumNode("USt", kz("gezahlteUst"), f.gezahlteUst),
              sumNode("Sonst_unbeschr_abziehbar", kz("uebrige"), f.uebrige),
            ],
          ],
          [
            "Beschr_abziehbar",
            [
              // Nicht abziehbare Beträge stehen nur nachrichtlich in der Anlage: die Bewirtung muss positiv sein, die
              // Gewerbesteuer ist nach Erstattungen auch negativ möglich
              ((f.bewirtungNichtAbziehbar ?? 0) > 0 || (f.gewerbesteuerNichtAbziehbar ?? 0) !== 0) && [
                "Nicht_abziehbar",
                [
                  (f.bewirtungNichtAbziehbar ?? 0) > 0 ? sumNode("Bewirtung", EUER_FIELDS.bewirtungNichtAbziehbar.kz, f.bewirtungNichtAbziehbar) : null,
                  sumNode("Sonst", EUER_FIELDS.gewerbesteuerNichtAbziehbar.kz, f.gewerbesteuerNichtAbziehbar),
                ],
              ],
              [
                "Abziehbar",
                [
                  sumNode("Geschenke", kz("geschenke"), f.geschenke),
                  sumNode("Bewirtung", kz("bewirtung"), f.bewirtung),
                  sumNode("Verpflegung", kz("verpflegung"), f.verpflegung),
                  // Ab 2024 eigene Tagespauschale ohne Sum-Ebene, 2023 noch unter „Tätigkeit in der häuslichen Wohnung“
                  input.year >= 2024
                    ? f.tagespauschale
                      ? ["Tagespauschale_1", [[kz("tagespauschale"), elsterDecimal(f.tagespauschale)]]]
                      : null
                    : sumNode("Arbeitszimmer", "E6003101", f.tagespauschale),
                ],
              ],
            ],
          ],
          [
            "KFZ_u_Fahrtkosten",
            [
              sumNode("Leasing", kz("kfzLeasing"), f.kfzLeasing),
              sumNode("Steuer_Versicherung_Maut", kz("kfzSteuerVersicherung"), f.kfzSteuerVersicherung),
              sumNode("Sonst", kz("kfzSonstige"), f.kfzSonstige),
              sumNode("Fahrtkosten_Nutzungseinlage", kz("fahrtNutzungseinlage"), f.fahrtNutzungseinlage),
              sumNode("Entfernungspausch_Familienheimfahrt", kz("entfernungspauschale"), f.entfernungspauschale),
            ],
          ],
          ["Summe_BAus", [["E6005301", elsterDecimal(ausgaben)]]],
        ],
      ],
      [
        "Ermittlung_Gewinn",
        [
          [
            "Uebertrag",
            [
              ["E6005501", elsterDecimal(einnahmen)],
              ["E6005601", elsterDecimal(ausgaben)],
            ],
          ],
          ["Korrektur_GuV", [["E6006801", elsterDecimal(gewinn)]]],
          [
            "Stpfl_GuV",
            [
              ["E6007002", elsterDecimal(gewinn)],
              ["E6007202", elsterDecimal(gewinn)],
            ],
          ],
        ],
      ],
      [
        "Zus_Angabe_EinzelUntern",
        [
          [
            "Entnahme_Einlage",
            [
              ["Entnahme", [["Sum", [["E6006601", elsterDecimal(f.entnahmen ?? 0)]]]]],
              ["Einlage", [["Sum", [["E6006701", elsterDecimal(f.einlagen ?? 0)]]]]],
            ],
          ],
        ],
      ],
    ],
  ];

  const e77 = [
    `<E77 xmlns="http://finkonsens.de/elster/elstererklaerung/euer/e77/v${input.year}" version="${input.year}">`,
    ...render(euer, "  "),
    ...render(aveuer(input.year, input.anlagen), "  "),
    ...render(vorsatz("77", envelopeInput), "  "),
    `</E77>`,
  ];
  return envelope(envelopeInput, e77);
}
