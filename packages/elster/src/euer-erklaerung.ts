import { formatEuro, type Cents } from "@haben/core";
import { aveuer, type AveuerAnlage } from "./aveuer.ts";
import { amount, checkEnvelope, envelope, render, vorsatz, type Envelope, type XmlNode } from "./erklaerung.ts";
import { EUER_AUSGABEN, EUER_EINNAHMEN, EUER_FIELDS, type EuerFigureKey, type EuerFigures } from "./euer-felder.ts";
import { euerUstUmgliedern, euerUstZeilen } from "./euer-umgliedern.ts";
import { elsterDecimal, ElsterEingabeError } from "./xml.ts";

export type { AveuerAnlage, AveuerGruppe } from "./aveuer.ts";

/* Anlage EÜR mit Anlage AVEÜR (E77, Datenart EUER) */

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

const kz = (key: EuerFigureKey) => EUER_FIELDS[key].kz;

/** Allgemeine Angaben zum Betrieb */
function allgemein(input: EuerXmlInput): XmlNode {
  return [
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
  ];
}

/** Betriebseinnahmen mit ihrer Summe */
function betriebseinnahmen(f: EuerFigures, year: number, einnahmen: Cents): XmlNode {
  return [
    "BEin",
    [
      sumNode("Kleinunternehmer", kz("kleinunternehmer"), f.kleinunternehmer),
      sumNode("Umsatz_nicht_steuerbar", EUER_FIELDS.kleinunternehmerAbzuege.kz, f.kleinunternehmerAbzuege),
      sumNode("USt_StPflicht", kz("steuerpflichtig"), f.steuerpflichtig),
      sumNode("USt_StFrei", kz("steuerfrei"), f.steuerfrei),
      sumNode("USt_Vereinnahmt_Unentgeltl", kz("vereinnahmteUst"), f.vereinnahmteUst),
      sumNode("USt_Erstattet_Verrechnet", kz("erstatteteUst"), f.erstatteteUst),
      sumNode("Anlagevermoegen", kz("anlagenabgang"), f.anlagenabgang),
      sumNode("Nutzung_Priv_Kfz", kz("privateKfz"), f.privateKfz),
      // Im Schema direkt nach der Kfz-Nutzung, vor Weitere_Angabe (2023) bzw. Ruecklagen_Ausgleichsposten (ab 2024)
      sumNode("Entnahme_Sonst", kz("sachentnahmen"), f.sachentnahmen),
      // Summe der Einnahmen: 2023 unter „Weitere_Angabe“, ab 2024 unter „GesamtSum“
      [year >= 2024 ? "GesamtSum" : "Weitere_Angabe", [["E6001201", elsterDecimal(einnahmen)]]],
    ],
  ];
}

function bausAfa(f: EuerFigures): XmlNode {
  return [
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
  ];
}

function sonstigeUnbeschraenkt(f: EuerFigures): XmlNode {
  return [
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
  ];
}

function beschraenktAbziehbar(f: EuerFigures, year: number): XmlNode {
  return [
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
          year >= 2024
            ? f.tagespauschale
              ? ["Tagespauschale_1", [[kz("tagespauschale"), elsterDecimal(f.tagespauschale)]]]
              : null
            : sumNode("Arbeitszimmer", "E6003101", f.tagespauschale),
        ],
      ],
    ],
  ];
}

function kfzUndFahrtkosten(f: EuerFigures): XmlNode {
  return [
    "KFZ_u_Fahrtkosten",
    [
      sumNode("Leasing", kz("kfzLeasing"), f.kfzLeasing),
      sumNode("Steuer_Versicherung_Maut", kz("kfzSteuerVersicherung"), f.kfzSteuerVersicherung),
      sumNode("Sonst", kz("kfzSonstige"), f.kfzSonstige),
      sumNode("Fahrtkosten_Nutzungseinlage", kz("fahrtNutzungseinlage"), f.fahrtNutzungseinlage),
      sumNode("Entfernungspausch_Familienheimfahrt", kz("entfernungspauschale"), f.entfernungspauschale),
    ],
  ];
}

/** Betriebsausgaben mit ihrer Summe */
function betriebsausgaben(f: EuerFigures, year: number, ausgaben: Cents): XmlNode {
  return [
    "BAus",
    [
      sumNode("Ware_Rohstoff_Hilfsstoff", kz("waren"), f.waren),
      sumNode("Fremdleistung", kz("fremdleistungen"), f.fremdleistungen),
      sumNode("Personal", kz("personal"), f.personal),
      bausAfa(f),
      // Zeile 39; im Schema zwischen AfA und den sonstigen unbeschränkt abziehbaren Betriebsausgaben
      ["Raumkosten_u_sonst", [sumNode("Miete_Pacht", kz("miete"), f.miete)]],
      sonstigeUnbeschraenkt(f),
      beschraenktAbziehbar(f, year),
      kfzUndFahrtkosten(f),
      ["Summe_BAus", [["E6005301", elsterDecimal(ausgaben)]]],
    ],
  ];
}

/** Ermittlung des Gewinns */
function gewinnermittlung(einnahmen: Cents, ausgaben: Cents, gewinn: Cents): XmlNode {
  return [
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
  ];
}

/** Entnahmen und Einlagen des Einzelunternehmers */
function entnahmenEinlagen(f: EuerFigures): XmlNode {
  return [
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
  ];
}

export function buildEuerXml(input: EuerXmlInput): string {
  const envelopeInput: Envelope = { ...input, datenArt: "EUER" };
  checkEnvelope(envelopeInput);
  // Ein negativer Saldo aus Zeile 58 oder 18 wird umgegliedert, nicht mit Vorzeichen gesendet (#933, Vorgabe aus #708)
  const { figures: f } = euerUstUmgliedern(input.figures, input.year);
  // Rückfall: bliebe danach ein negativer Betrag übrig, nimmt ihn die Anlage EÜR nicht an
  const vorzeichen = euerVorzeichenMeldungen(f, input.year);
  if (vorzeichen.length > 0) throw new ElsterEingabeError(vorzeichen.join(" "));
  const { einnahmen, ausgaben, gewinn } = euerTotals(f);

  const euer: XmlNode = [
    "EUER",
    [
      allgemein(input),
      betriebseinnahmen(f, input.year, einnahmen),
      betriebsausgaben(f, input.year, ausgaben),
      gewinnermittlung(einnahmen, ausgaben, gewinn),
      entnahmenEinlagen(f),
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
