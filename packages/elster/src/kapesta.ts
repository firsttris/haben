import { finanzamtsnummer, type Cents } from "@haben/core";
import { splitStrasse } from "./nachricht.ts";
import { render, type XmlNode } from "./erklaerung.ts";
import { checkSteuernummer13, elsterDecimal, ElsterEingabeError, elsterXml, wholeEuros } from "./xml.ts";

/**
 * Kapitalertragsteuer-Anmeldung (Verfahren ElsterKapESt, Datenart KapEStA) einer GmbH oder UG für eine
 * Gewinnausschüttung an ihre Gesellschafter: Kapitalerträge mit 25 % Steuerabzug (§ 43 Abs. 1 Satz 1 Nr. 1 EStG), der
 * Gewinnverteilungsbeschluss, Soli und Kirchensteuer je Religionsschlüssel (Kirchensteuerabzugsmerkmal des
 * Bundeszentralamts für Steuern). Feldkennungen und Reihenfolge aus der Jahresdokumentation KapEStA_2026 und dem Schema
 * KapEStA-2026 im ERiC-Paket 43.4.6.0; Testmerker 160000001 (ERiC-Entwicklerhandbuch, Tabelle der Testmerker). Das Schema
 * KapEStA-2027 (ERiC 45.1.5.0) unterscheidet sich von 2026 nur in Namensraum und Version.
 */

export const KAPESTA_JAHRE = [2025, 2026, 2027] as const;
/** "2025, 2026 und 2027" für Meldungen */
export const KAPESTA_JAHRE_TEXT = new Intl.ListFormat("de", { type: "conjunction" }).format(KAPESTA_JAHRE.map(String));

/** Für KapEStA ist der allgemeine Testmerker 700000004 nicht zulässig */
const TESTMERKER_KAPEST = "160000001";

export interface KapEStAInput {
  steuernummer13: string;
  /** Kürzel des Bundeslands, z. B. "BY" */
  bundesland: string;
  schuldner: { name: string; strasse: string; plz: string; ort: string; telefon?: string; email?: string };
  /** Kapitalerträge (ohne Leistungen aus dem Einlagekonto) */
  ertrag: Cents;
  kapest: Cents;
  soli: Cents;
  /** Kirchensteuer je Religionsschlüssel (sechsstellig, aus dem Kirchensteuerabzugsmerkmal) */
  kirchensteuer: readonly { religionsschluessel: string; betrag: Cents }[];
  /** Gewinnverteilungsbeschluss: Datum, Betrag und, falls bestimmt, Tag der Auszahlung */
  beschluss: { datum: string; betrag: Cents; auszahlungstag?: string };
  herstellerId: string;
  produktVersion: string;
  test: boolean;
}

const datum = (iso: string) => iso.replaceAll("-", "");

/** Der Tag nach einem Datum, JJJJ-MM-TT */
export function tagDanach(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** Religionsschlüssel der Kirchensteuer in der Reihenfolge des Schemas (KapEStA-2025 bis -2027 gleich) */
const RELIGIONSSCHLUESSEL =
  "010100 026300 010200 026400 010300 026500 010400 026600 010500 026700 010600 026800 010800 026900 010900 027000 011000 027100 011100 027200 011200 027300 011300 027400 011400 027500 011500 027600 011600 027700 011700 027800 011900 033200 012000 044000 012300 044100 012400 044200 025100 044300 025200 044400 025300 044500 025400 044600 025500 044700 025600 044800 025700 044900 025800 058200 025900 058300 026000 058400 026100 058500 026200 058600".split(
    " ",
  );

/** Zufluss: am im Beschluss bestimmten Auszahlungstag, sonst am Tag nach der Beschlussfassung (§ 44 Abs. 2 Satz 2 EStG) */
export function zuflussTag(beschluss: KapEStAInput["beschluss"]): string {
  return beschluss.auszahlungstag ?? tagDanach(beschluss.datum);
}

export function buildKapEStAXml(input: KapEStAInput): string {
  checkSteuernummer13(input.steuernummer13);
  const zufluss = zuflussTag(input.beschluss);
  const year = Number(zufluss.slice(0, 4));
  if (!(KAPESTA_JAHRE as readonly number[]).includes(year)) {
    throw new ElsterEingabeError(`Die Kapitalertragsteuer-Anmeldung sendet Haben für ${KAPESTA_JAHRE_TEXT}, nicht für ${year}.`);
  }
  for (const k of input.kirchensteuer) {
    if (!RELIGIONSSCHLUESSEL.includes(k.religionsschluessel)) throw new ElsterEingabeError(`Religionsschlüssel ${k.religionsschluessel} gibt es nicht.`);
  }
  const s = input.schuldner;
  const adresse = splitStrasse(s.strasse);
  // Je Schlüssel eine Summe, in der Reihenfolge des Schemas
  const kirchensteuer = RELIGIONSSCHLUESSEL.map((schluessel) => ({
    religionsschluessel: schluessel,
    betrag: input.kirchensteuer.filter((k) => k.religionsschluessel === schluessel).reduce((sum, k) => sum + k.betrag, 0),
  })).filter((k) => k.betrag !== 0);
  const kSumme = kirchensteuer.reduce((sum, k) => sum + k.betrag, 0);
  const b = input.beschluss;

  const kapesta: XmlNode = [
    "KapEStA",
    [
      ["KapEAnm", "X"],
      ["BuStNr", input.steuernummer13],
      // 0 = erstmalige Anmeldung
      ["BArt", "0"],
      [
        "AllgAngaben",
        [
          ["AnmZtr", datum(zufluss)],
          [
            "Schuldner",
            [
              ["Name", s.name],
              ["Telefon", s.telefon?.replace(/[^0-9/+-]/g, "") || undefined],
              ["Email", s.email || undefined],
              [
                "StrAdrInl",
                [
                  ["Str", adresse?.strasse ?? s.strasse],
                  ["Hausnummer", adresse?.hausnummer],
                  ["HNrZusatz", adresse?.zusatz],
                  ["PLZ", s.plz],
                  ["Ort", s.ort],
                ],
              ],
            ],
          ],
        ],
      ],
      [
        "KapEZ",
        [
          [
            "KapErtrSch25",
            [
              ["KapErtr", [["KapESch25", wholeEuros(input.ertrag)]]],
              [
                "KapESt",
                [
                  ["KapESch25St", elsterDecimal(input.kapest).replace(",", ".")],
                  ["KapESch25StSum", elsterDecimal(input.kapest).replace(",", ".")],
                ],
              ],
              [
                "Soli",
                [
                  ["KapESch25Sz", elsterDecimal(input.soli).replace(",", ".")],
                  ["KapESch25SzSum", elsterDecimal(input.soli).replace(",", ".")],
                ],
              ],
              [
                "GewVertBeschl",
                [
                  ["GewVertBeschlDat", datum(b.datum)],
                  ["GewVertBeschlBet", wholeEuros(b.betrag)],
                  ["GewVertBeschlTag", b.auszahlungstag ? datum(b.auszahlungstag) : undefined],
                  ["TagNachBeschl", b.auszahlungstag ? undefined : datum(tagDanach(b.datum))],
                ],
              ],
            ],
          ],
        ],
      ],
      // Gesamtsummen der Zeilen 25, 26 und 33; die Kapitalertragsteuer hier in vollen Euro
      [
        "KapErtrSch15",
        [
          [
            "P43Abs1Satz1Nr_7b_7c",
            [
              ["KapESt", [["KapESchStSum", wholeEuros(input.kapest)]]],
              ["Soli", [["KapESchSzSum", elsterDecimal(input.soli).replace(",", ".")]]],
            ],
          ],
        ],
      ],
      kirchensteuer.length > 0
        ? [
            "Kirchensteuerdaten",
            [
              ...kirchensteuer.map((k): XmlNode => [`K${k.religionsschluessel}`, elsterDecimal(k.betrag).replace(",", ".")]),
              ["KSum", elsterDecimal(kSumme).replace(",", ".")],
            ],
          ]
        : null,
    ],
  ];

  const nutzdaten = [
    `<KapEStA xmlns="http://finkonsens.de/elster/elsterkapest/kapesta/v${year}" version="${year}">`,
    ...render(kapesta, "  ").slice(1, -1),
    "</KapEStA>",
  ];
  return elsterXml(
    {
      verfahren: "ElsterKapESt",
      datenArt: "KapEStA",
      testmerker: input.test ? TESTMERKER_KAPEST : undefined,
      ziel: input.bundesland,
      herstellerId: input.herstellerId,
      datenlieferant: s.name,
    },
    [{ ticket: "1", empfaenger: { id: "F", wert: finanzamtsnummer(input.steuernummer13) }, produktVersion: input.produktVersion, nutzdaten }],
  );
}
