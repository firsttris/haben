import type { Cents } from "@haben/core";
import { amount, checkEnvelope, envelope, render, vorsatz, type Envelope, type XmlNode } from "./erklaerung.ts";
import { elsterDecimal, ElsterEingabeError, wholeEuros } from "./xml.ts";

/**
 * Umsatzsteuererklärung (E50, Datenart USt) im Verfahren ElsterErklaerung; das gemeinsame
 * Gerüst (Vorsatz, Envelope, XmlNode, render, amount) liegt in erklaerung.ts.
 *
 * Feldkennungen und Reihenfolge stammen aus Implementierungen, die damit erfolgreich an ELSTER
 * übermitteln (EasyCash&Tax ECTElster, viking, finamt); die amtliche Quelle ist die
 * Jahresdokumentation im ERiC-Paket. Das Finanzamt ändert die Vordrucke jährlich; vor dem
 * Echtversand prüft ERiC jedes XML gegen das Schema des Jahres (Prüfen bzw. Testübermittlung).
 */
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
  /** Steuerfreie Umsätze ohne Vorsteuerabzug, Zeile 46: Vermietung nach § 4 Nr. 12 UStG (E3104401) */
  kz48Zeile46?: Cents;
  /** Steuerfreie Umsätze ohne Vorsteuerabzug, Zeile 47: übrige nicht zum Gesamtumsatz gehörende (E3104502) */
  kz48Zeile47?: Cents;
  /** Die Nummern in § 4 UStG der Zeile 47 als Text (E3104501), etwa „14, 21“ */
  kz48Zeile47Nummern?: string;
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
    f.kz48Zeile46,
    f.kz48Zeile47,
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

/**
 * Steuerfreie Umsätze: mit Vorsteuerabzug die Kz 41 und 43 (Summenzeile entfällt ab 2025, USt_30415 bis 2024),
 * ohne Vorsteuerabzug die Zeilen 46 und 47 (Kz 48). Ab 2025 fällt deren Summenzeile E3104601 weg; die Zeile 49
 * (E3104901/02, zum Gesamtumsatz gehörende) übermittelt Haben nicht.
 */
function ust2aStfrei(f: UstErklaerungFigures, year: number): XmlNode | false {
  const mit = kz(f.kz41) !== 0 || kz(f.kz43) !== 0;
  const ohne = kz(f.kz48Zeile46) !== 0 || kz(f.kz48Zeile47) !== 0;
  return (
    (mit || ohne) && [
      "Ums_stfrei",
      [
        [
          "Tabelle",
          [
            mit && [
              "Mit_VoSt_Abz",
              [
                kz(f.kz41) !== 0 && ["Ig_Lfg", [["E3103301", wholeEuros(f.kz41!)]]],
                kz(f.kz43) !== 0 && ["Ums_stfrei_weit", [["E3103801", wholeEuros(f.kz43!)], year <= 2024 && ["E3104201", wholeEuros(f.kz43!)]]],
              ],
            ],
            ohne && [
              "Ohne_VoSt_Abz",
              [
                [
                  "Nicht_Ges_Ums",
                  [
                    kz(f.kz48Zeile46) !== 0 && ["E3104401", wholeEuros(f.kz48Zeile46!)],
                    kz(f.kz48Zeile47) !== 0 && ["E3104501", f.kz48Zeile47Nummern ?? ""],
                    kz(f.kz48Zeile47) !== 0 && ["E3104502", wholeEuros(f.kz48Zeile47!)],
                    // Bis 2024 die Summe der Zeilen 46 und 47 aus den jeweils abgeschnittenen Werten
                    year <= 2024 && ["E3104601", `${Number(wholeEuros(f.kz48Zeile46 ?? 0)) + Number(wholeEuros(f.kz48Zeile47 ?? 0))}`],
                  ],
                ],
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
