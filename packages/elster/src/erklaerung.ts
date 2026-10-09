import { finanzamtsnummer, type Cents } from "@haben/core";
import { germanDate } from "./bankverbindung.ts";
import { checkSteuernummer13, elsterDecimal, elsterXml, escapeXml, PRODUKT_NAME, TESTMERKER, wholeEuros } from "./xml.ts";

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
  datenArt: "USt" | "EUER" | "ESt";
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
    throw new RangeError(`Jahreserklärungen gehen ab ${ERSTES_ERKLAERUNGSJAHR}, nicht für ${input.year}.`);
  }
  if (!/^[A-Z]{2}$/.test(input.bundesland)) throw new Error(`Bundesland fehlt: ${input.bundesland}`);
}

/** Identifikationsnummern stehen bei der Einkommensteuer im Vorsatz, nicht in den Personendaten */
export function vorsatz(unterfallart: "10" | "50" | "77", input: Envelope, idnr?: { a: string; b?: string }): XmlNode {
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
  /** Abziehbare Vorsteuer aus Rechnungen */
  vorsteuer: Cents;
  /** Vorauszahlungssoll: Summe der Voranmeldungen des Jahres */
  vorauszahlungen: Cents;
}

export interface UstErklaerungResult {
  /** Umsatzsteuer abzüglich Vorsteuer; negativ = Überschuss */
  steuer: Cents;
  /** Abschlusszahlung (positiv) bzw. Erstattung (negativ) */
  abschluss: Cents;
}

export function ustErklaerungResult(f: UstErklaerungFigures): UstErklaerungResult {
  const steuer = f.tax19 + f.tax7 - f.vorsteuer;
  return { steuer, abschluss: steuer - f.vorauszahlungen };
}

export interface UstErklaerungXmlInput extends Omit<Envelope, "datenArt"> {
  versteuerung: "soll" | "ist";
  figures: UstErklaerungFigures;
}

export function buildUstErklaerungXml(input: UstErklaerungXmlInput): string {
  const envelopeInput: Envelope = { ...input, datenArt: "USt" };
  checkEnvelope(envelopeInput);
  const f = input.figures;
  const umsatzsteuer = f.tax19 + f.tax7;
  if (umsatzsteuer === 0 && f.vorsteuer === 0) {
    throw new Error("Ohne Umsätze und Vorsteuer gibt es nichts zu erklären; eine Nullerklärung geht über das ELSTER-Portal.");
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
      f.vorsteuer !== 0 && [
        "Abz_VoSt",
        [
          [
            "Tabelle",
            [
              ["E3006201", elsterDecimal(f.vorsteuer)],
              ["Abz_VoSt_Sum", [["E3006901", elsterDecimal(f.vorsteuer)]]],
            ],
          ],
        ],
      ],
      [
        "Berech_USt",
        [
          [
            "Tabelle",
            [
              ["E3009201", amount(umsatzsteuer)],
              ["E3009801", amount(umsatzsteuer)],
              ["E3009901", amount(f.vorsteuer)],
              ["E3010201", elsterDecimal(steuer)],
              // Umsatzsteuer bzw. Überschuss (mit Minus)
              ["E3010601", amount(steuer)],
              [
                "Verbl_USt",
                [
                  ["E3011101", elsterDecimal(steuer)],
                  ["E3011301", elsterDecimal(f.vorauszahlungen)],
                ],
              ],
              ["Zahl_Erstatt", [["E3011401", elsterDecimal(abschluss)]]],
            ],
          ],
        ],
      ],
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
  // Betriebsausgaben
  fremdleistungen?: Cents;
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
  vorsteuer?: Cents;
  gezahlteUst?: Cents;
  uebrige?: Cents;
  /** Beschränkt abziehbar: Verpflegungsmehraufwand und Homeoffice-Tagespauschale */
  verpflegung?: Cents;
  tagespauschale?: Cents;
  kfzLeasing?: Cents;
  kfzSteuerVersicherung?: Cents;
  kfzSonstige?: Cents;
  /** Fahrten mit dem Privatfahrzeug (Kilometersatz), als Nutzungseinlage */
  fahrtNutzungseinlage?: Cents;
  // Entnahmen und Einlagen (Einzelunternehmen)
  entnahmen?: Cents;
  einlagen?: Cents;
}

export const EUER_EINNAHMEN = ["kleinunternehmer", "steuerpflichtig", "steuerfrei", "vereinnahmteUst", "erstatteteUst", "anlagenabgang", "privateKfz"] as const;
export const EUER_AUSGABEN = [
  "fremdleistungen",
  "afaBeweglich",
  "gwg",
  "sammelposten",
  "restbuchwert",
  "telekommunikation",
  "reisekosten",
  "fortbildung",
  "beratung",
  "beitraegeVersicherungen",
  "edv",
  "arbeitsmittel",
  "werbung",
  "vorsteuer",
  "gezahlteUst",
  "uebrige",
  "verpflegung",
  "tagespauschale",
  "kfzLeasing",
  "kfzSteuerVersicherung",
  "kfzSonstige",
  "fahrtNutzungseinlage",
] as const;

export type EuerFigureKey = (typeof EUER_EINNAHMEN)[number] | (typeof EUER_AUSGABEN)[number];

/** Zeile der Anlage EÜR 2025 und amtlicher Text, für die Vorschau */
export const EUER_FIELDS: Record<EuerFigureKey | "entnahmen" | "einlagen", { kz: string; label: string }> = {
  kleinunternehmer: { kz: "E6000101", label: "Betriebseinnahmen als umsatzsteuerlicher Kleinunternehmer" },
  steuerpflichtig: { kz: "E6000401", label: "Umsatzsteuerpflichtige Betriebseinnahmen" },
  steuerfrei: {
    kz: "E6000501",
    label: "Umsatzsteuerfreie, nicht umsatzsteuerbare Betriebseinnahmen sowie Betriebseinnahmen, für die der Leistungsempfänger die Umsatzsteuer schuldet",
  },
  vereinnahmteUst: { kz: "E6000601", label: "Vereinnahmte Umsatzsteuer sowie Umsatzsteuer auf unentgeltliche Wertabgaben" },
  erstatteteUst: { kz: "E6000701", label: "Vom Finanzamt erstattete und ggf. verrechnete Umsatzsteuer" },
  anlagenabgang: { kz: "E6000801", label: "Veräußerung oder Entnahme von Anlagevermögen" },
  privateKfz: { kz: "E6000901", label: "Private Kfz-Nutzung" },
  fremdleistungen: { kz: "E6001701", label: "Bezogene Fremdleistungen" },
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
  vorsteuer: { kz: "E6005001", label: "Gezahlte Vorsteuerbeträge" },
  gezahlteUst: { kz: "E6005101", label: "An das Finanzamt gezahlte und ggf. verrechnete Umsatzsteuer" },
  uebrige: { kz: "E6004901", label: "Übrige unbeschränkt abziehbare Betriebsausgaben" },
  kfzLeasing: { kz: "E6005801", label: "Leasingkosten für Kraftfahrzeuge" },
  kfzSteuerVersicherung: { kz: "E6005903", label: "Steuern, Versicherungen und Maut für Kraftfahrzeuge" },
  kfzSonstige: { kz: "E6006003", label: "Sonstige tatsächliche Fahrtkosten ohne AfA und Zinsen" },
  // Kennungen und Reihenfolge wie im EÜR-Formular 2025 von EasyCash&Tax, das ECTElster in dieser Reihenfolge übermittelt
  verpflegung: { kz: "E6005002", label: "Verpflegungsmehraufwendungen" },
  tagespauschale: { kz: "E6006405", label: "Tagespauschale für die Tätigkeit in der häuslichen Wohnung" },
  fahrtNutzungseinlage: { kz: "E6006103", label: "Fahrtkosten für nicht zum Betriebsvermögen gehörende Fahrzeuge (Nutzungseinlage)" },
  entnahmen: { kz: "E6006601", label: "Entnahmen einschließlich Sach-, Leistungs- und Nutzungsentnahmen" },
  einlagen: { kz: "E6006701", label: "Einlagen einschließlich Sach-, Leistungs- und Nutzungseinlagen" },
};

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

const sum = (list: AveuerAnlage[], key: "anschaffungskosten" | "buchwertBeginn" | "afa" | "abgang" | "buchwertEnde") =>
  list.reduce((s, a) => s + a[key], 0);

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
              gruppe === "kfz" ? ["E6007327", a.elektro ? "1" : "2"] : null,
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
            gruppe === "kfz" ? ["E6007328", list.some((a) => a.elektro) ? "1" : "2"] : null,
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

const sumNode = (kontext: string, kz: string, cents: Cents | undefined): XmlNode | null =>
  cents ? [kontext, [["Sum", [[kz, elsterDecimal(cents)]]]]] : null;

export function buildEuerXml(input: EuerXmlInput): string {
  const envelopeInput: Envelope = { ...input, datenArt: "EUER" };
  checkEnvelope(envelopeInput);
  const f = input.figures;
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
          ["GesamtSum", [["E6001201", elsterDecimal(einnahmen)]]],
        ],
      ],
      [
        "BAus",
        [
          sumNode("Fremdleistung", kz("fremdleistungen"), f.fremdleistungen),
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
          [
            "Sonst_unbeschraenkt",
            [
              sumNode("Kommunikation", kz("telekommunikation"), f.telekommunikation),
              sumNode("Auswertstaetigkeit", kz("reisekosten"), f.reisekosten),
              sumNode("Fortbildung", kz("fortbildung"), f.fortbildung),
              sumNode("Rechtsberatung_StB_Buchf", kz("beratung"), f.beratung),
              sumNode("Beitrag_Gebuehr_Abgabe_Versicherung", kz("beitraegeVersicherungen"), f.beitraegeVersicherungen),
              sumNode("EDV", kz("edv"), f.edv),
              sumNode("Arbeitsmittel", kz("arbeitsmittel"), f.arbeitsmittel),
              sumNode("Werbung", kz("werbung"), f.werbung),
              sumNode("Vorsteuer", kz("vorsteuer"), f.vorsteuer),
              sumNode("USt", kz("gezahlteUst"), f.gezahlteUst),
              sumNode("Sonst_unbeschr_abziehbar", kz("uebrige"), f.uebrige),
            ],
          ],
          [
            "Beschr_abziehbar",
            [
              [
                "Abziehbar",
                [
                  sumNode("Verpflegung", kz("verpflegung"), f.verpflegung),
                  // Die Tagespauschale steht ohne Sum-Ebene
                  f.tagespauschale ? ["Tagespauschale_1", [[kz("tagespauschale"), elsterDecimal(f.tagespauschale)]]] : null,
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
