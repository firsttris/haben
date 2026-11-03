import type { Cents } from "@haben/core";
import { checkEnvelope, envelope, render, vorsatz, type Envelope, type XmlNode } from "./erklaerung.ts";
import { ElsterEingabeError, wholeEuros } from "./xml.ts";

/**
 * Gewerbesteuererklärung (E20, Unterfallart 20) einer GmbH oder UG mit Hauptvordruck GewSt 1 A: ein Unternehmen mit
 * einer einzigen Betriebsstätte, ohne Organschaft, ohne Beteiligungen an Personengesellschaften und ohne Kürzungen.
 * Feldkennungen, Kontexte und Reihenfolge aus der Jahresdokumentation 20_2025 und dem Schema E20-2025 im ERiC-Paket
 * 43.4.6.0 (Dokumentation/Plausipruefungen/Erklaerungssteuern/GewSt, Schnittstellenbeschreibungen/…/GewSt_20_2025).
 */

/** Jahre, deren Schema Haben kennt und mit ERiC geprüft hat */
export const GEWST_JAHRE = [2024, 2025] as const;

/** Schlüssel RECHTSFORM_GEWERBESTEUER_V2: 350 GmbH, 370 UG (haftungsbeschränkt) */
const RECHTSFORM = { gmbh: "350", ug: "370" } as const;

export interface GewStXmlInput extends Omit<Envelope, "datenArt"> {
  rechtsform: keyof typeof RECHTSFORM;
  /** Gegenstand des Unternehmens (Zeile 4) */
  gegenstand: string;
  /** Einzige Betriebsstätte (Zeilen 31, 32) */
  betriebsstaette: { plz: string; ort: string };
  /** Gewinn aus Gewerbebetrieb (Zeile 39), negativ bei Verlust */
  gewinn: Cents;
  /** § 8 Nr. 1 GewStG in voller Höhe; den Hinzurechnungsbetrag ermittelt das Finanzamt (Zeilen 50 bis 56) */
  hinzurechnungen: { zinsen: Cents; beweglich: Cents; unbeweglich: Cents; rechte: Cents };
  /** Darin enthaltene Vergütungen nach § 50a Abs. 1 Nr. 3 EStG an beschränkt Steuerpflichtige (Zeile 57); nur mit Rechten */
  rechteBeschraenktStpfl: Cents;
  /** Zum Schluss des Vorjahres festgestellter vortragsfähiger Gewerbeverlust (Zeile 148) */
  verlustvortrag: Cents;
}

/** Ganze Euro, leer bei 0 (das Feld entfällt dann) */
const euro = (cents: Cents): string | undefined => (Math.trunc(cents / 100) === 0 ? undefined : wholeEuros(cents));

export function buildGewStXml(input: GewStXmlInput): string {
  const envelopeInput: Envelope = { ...input, datenArt: "GewSt" };
  checkEnvelope(envelopeInput);
  if (!(GEWST_JAHRE as readonly number[]).includes(input.year)) {
    throw new ElsterEingabeError(`Die Gewerbesteuererklärung sendet Haben für ${GEWST_JAHRE.join(" und ")}, nicht für ${input.year}.`);
  }
  if (!input.gegenstand.trim()) throw new ElsterEingabeError("Der Gegenstand des Unternehmens fehlt.");
  const h = input.hinzurechnungen;
  const gewst: XmlNode = [
    "GewSt1A",
    [
      [
        "Allgemein",
        [
          ["E4000101", input.absender.name],
          ["E4000201", input.gegenstand.trim()],
        ],
      ],
      ["Rechtsform", [["E4000501", RECHTSFORM[input.rechtsform]]]],
      [
        "Ang_Gew_Betr",
        [
          [
            "Betr_St",
            [
              // Betriebsstätten nicht in mehreren Gemeinden, nicht über mehrere erstreckt, nicht verlegt
              ["E4001506", "2"],
              ["E4001507", "2"],
              ["E4001102", "2"],
              ["E4001110", input.betriebsstaette.plz],
              ["E4001111", input.betriebsstaette.ort],
            ],
          ],
        ],
      ],
      // Der Gewinn steht auch bei 0 in der Erklärung
      ["Gewinn", [["E4001703", wholeEuros(input.gewinn)]]],
      [
        "Hinz",
        [
          [
            "P_8_Nr_1_Wj1",
            [
              ["E4003202", euro(h.zinsen)],
              ["E4003502", euro(h.beweglich)],
              ["E4003602", euro(h.unbeweglich)],
              ["E4003703", euro(h.rechte)],
              // ERiC verlangt beide Zeilen zusammen
              ["E4004103", euro(h.rechte) ? wholeEuros(input.rechteBeschraenktStpfl) : undefined],
            ],
          ],
        ],
      ],
      ["VJ1_EZ", [["E4014801", euro(input.verlustvortrag)]]],
    ],
  ];
  const e20 = [
    `<E20 xmlns="http://finkonsens.de/elster/elstererklaerung/gewst/e20/v${input.year}" version="${input.year}">`,
    ...render(gewst, "  "),
    ...render(vorsatz("20", envelopeInput), "  "),
    "</E20>",
  ];
  return envelope(envelopeInput, e20);
}
