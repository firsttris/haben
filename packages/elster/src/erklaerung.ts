import { finanzamtsnummer, formatEuro, type Cents } from "@haben/core";
import { germanDate } from "./bankverbindung.ts";
import { checkSteuernummer13, elsterDecimal, ElsterEingabeError, elsterXml, escapeXml, PRODUKT_NAME, TESTMERKER } from "./xml.ts";
import { EUER_AUSGABEN, EUER_EINNAHMEN, EUER_FIELDS, type EuerFigureKey, type EuerFigures } from "./euer-felder.ts";
import { euerUstUmgliedern, euerUstZeilen } from "./euer-umgliedern.ts";

/**
 * Jahreserklärungen im Verfahren ElsterErklaerung: hier das gemeinsame Gerüst (Vorsatz, Envelope,
 * XmlNode, render, amount) und die Anlage EÜR mit Anlage AVEÜR (E77, Datenart EUER); die
 * Umsatzsteuererklärung (E50) liegt in ust-erklaerung.ts.
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
export const amount = (cents: Cents | undefined): string | undefined => (cents ? elsterDecimal(cents) : undefined);

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

// ------------------------------------------------------------------ Anlage EÜR

/**
 * Meldungen zu Beträgen, die die Anlage EÜR nicht aufnimmt: negative Werte in Zeile 58 (E6005101) und Zeile 18
 * (E6000701). Fundstelle: Jahresdokumentation E77 2025 des ERiC-Dokumentationspakets 44.3.6.0/45.1.5.0, Felder
 * E6005101 und E6000701: „GeldBetragMitCent ohne Vorzeichen, mit 12 Vorkommastellen“; die Schemata E77-2025.xsd und
 * E77-2026.xsd führen beide als „DezimalzahlNichtNegOhneFuehrNull…“ (Muster \d{1,12}(,\d{2,2})), während E6004301 dort
 * als „DezimalzahlOhneFuehrNull…“ mit optionalem Minus steht. ERiC 45.1.5.0 antwortet auf -190,00: „Unzulässiges
 * Vorzeichen. Geldbeträge müssen ohne Vorzeichen eingetragen werden.“ Wie der Betrag stattdessen einzutragen ist,
 * entscheidet euerUstUmgliedern (Vorgabe aus #708, Issue #933); diese Meldung bleibt der Rückfall, falls danach doch
 * noch ein negativer Betrag übrig ist.
 * Zeilennummern des Jahres nach euerUstZeilen (2024 und 2025 Zeile 18 und 58, 2026 Zeile 18 und 59). Ein
 * negativer Betrag entsteht erst im Jahr nach einer aus Haben übermittelten EÜR (#706), frühestens 2024.
 */
export function euerVorzeichenMeldungen(f: EuerFigures, year: number): string[] {
  const zeile = euerUstZeilen(year);
  const felder = [
    { wert: f.gezahlteUst, zeile: zeile.gezahlt, ...EUER_FIELDS.gezahlteUst },
    { wert: f.erstatteteUst, zeile: zeile.erstattet, ...EUER_FIELDS.erstatteteUst },
  ];
  return felder
    .filter((feld) => (feld.wert ?? 0) < 0)
    .map(
      (feld) =>
        `In Zeile ${feld.zeile} (Kz ${feld.kz}, „${feld.label}“) steht ein negativer Betrag von ${formatEuro(feld.wert!)}. Die Anlage EÜR nimmt dort nur Beträge ohne Vorzeichen an; ELSTER lehnt negative Werte mit „Unzulässiges Vorzeichen“ ab. Der Betrag gehört in die andere der beiden Zeilen; diese Meldung erscheint nur, wenn das Umgliedern nicht greift.`,
    );
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
  const { figures: f } = euerUstUmgliedern(input.figures, input.year);
  // Rückfall: bliebe danach ein negativer Betrag übrig, nimmt ihn die Anlage EÜR nicht an
  const vorzeichen = euerVorzeichenMeldungen(f, input.year);
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
