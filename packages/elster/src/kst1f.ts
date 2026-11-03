import type { Cents } from "@haben/core";
import { germanDate } from "./bankverbindung.ts";
import type { XmlNode } from "./erklaerung.ts";

/**
 * Anlage KSt 1 F zur Körperschaftsteuererklärung: gesonderte Feststellung des steuerlichen Einlagekontos (§ 27 KStG)
 * mit den Gewinnausschüttungen des Wirtschaftsjahres (Zeilen 3 bis 13), dem ausschüttbaren Gewinn (Zeilen 17 bis 20)
 * und der Verrechnung der Leistungen mit dem Einlagekonto (Zeilen 46 bis 51). Feldkennungen, Reihenfolge und
 * Plausibilitätsregeln (KSt1F_22_020, KSt1F_22_040 bis _042, Regel_082003, Regel_120001) aus der Jahresdokumentation
 * 30_2025 und dem Schema E30-2025 im ERiC-Paket 43.4.6.0. Gerechnet wird in vollen Euro, aus denselben Beträgen, die im
 * XML stehen.
 */

/** Offene Gewinnausschüttung aufgrund eines ordentlichen Gewinnverteilungsbeschlusses (Art der Leistung 1) */
export interface Kst1fLeistung {
  beschluss: string;
  /** Tag des Abflusses (Zufluss beim Gesellschafter), JJJJ-MM-TT */
  abfluss: string;
  brutto: Cents;
  /** In der Steuerbescheinigung bescheinigte Minderung des Einlagekontos (§ 27 Abs. 3 und 5 KStG) */
  ausEinlagekonto: Cents;
}

export interface Kst1fInput {
  year: number;
  /** Im Jahr gegründet: Beginn der unbeschränkten Steuerpflicht, JJJJ-MM-TT */
  gruendung?: string;
  /** Bestand des steuerlichen Einlagekontos zum Schluss des Vorjahres bzw. bei Gründung */
  einlagekonto: Cents;
  leistungen: readonly Kst1fLeistung[];
  /** Eigenkapital laut Steuerbilanz und Nennkapital zum Schluss des Vorjahres, für den ausschüttbaren Gewinn */
  eigenkapital: Cents;
  nennkapital: Cents;
}

export interface Einlagekontorechnung {
  anfang: number;
  leistungen: number;
  bescheinigt: number;
  /** Zeile 20; null ohne Leistungen */
  ausschuettbarerGewinn: number | null;
  /** Zeile 49: Leistungen abzüglich ausschüttbarem Gewinn */
  summe: number;
  /** Mehr als eine Leistung mit bescheinigter Minderung (Zeile 13): Abzug laut Zeile 51 statt 50 */
  mehrere: boolean;
  abzug: number;
  ende: number;
}

const euro = (cents: Cents) => Math.trunc(cents / 100);

/** Verwendungsrechnung des Einlagekontos (§ 27 Abs. 1 Satz 3 KStG) in vollen Euro */
export function einlagekontoRechnung(input: Kst1fInput): Einlagekontorechnung {
  const anfang = euro(input.einlagekonto);
  const leistungen = input.leistungen.reduce((sum, l) => sum + euro(l.brutto), 0);
  const bescheinigt = input.leistungen.reduce((sum, l) => sum + euro(l.ausEinlagekonto), 0);
  const ausschuettbarerGewinn = input.leistungen.length > 0 ? Math.max(0, euro(input.eigenkapital) - euro(input.nennkapital) - Math.max(0, anfang)) : null;
  const summe = leistungen - (ausschuettbarerGewinn ?? 0);
  const mehrere = input.leistungen.length > 1 && bescheinigt > 0;
  // Höchstens der bescheinigte Betrag, der Bestand (Zeile 46) und der Teil über dem ausschüttbaren Gewinn (Zeile 49)
  const abzug = mehrere ? Math.max(0, Math.min(bescheinigt, anfang)) : Math.max(0, Math.min(anfang, summe, bescheinigt));
  return { anfang, leistungen, bescheinigt, ausschuettbarerGewinn, summe, mehrere, abzug, ende: anfang - abzug };
}

const n = (value: number) => String(value);

export function kst1fNode(input: Kst1fInput): XmlNode {
  const r = einlagekontoRechnung(input);
  const von = germanDate(input.gruendung ?? `${input.year}-01-01`);
  const bis = germanDate(`${input.year}-12-31`);
  const mitLeistungen = input.leistungen.length > 0;
  // Zwischensumme (Zeile 46) nur, wenn ein positiver Bestand mit Leistungen über dem ausschüttbaren Gewinn verrechnet wird
  const zwischensumme = r.anfang > 0 && r.summe > 0;
  return [
    "KSt1F",
    [
      ["WJ", "WJ1"],
      [
        "Allgemein",
        [
          ["E8200905", input.gruendung ? von : undefined],
          ["E8200101", von],
          ["E8200102", bis],
        ],
      ],
      mitLeistungen
        ? [
            "Leistungen",
            [
              ...input.leistungen.map(
                (l): XmlNode => [
                  "Einzel",
                  [
                    ["E8122020", "1"],
                    ["E8122021", germanDate(l.beschluss)],
                    ["E8122022", germanDate(l.abfluss)],
                    ["E8122023", n(euro(l.brutto))],
                    ["E8122024", n(euro(l.ausEinlagekonto))],
                  ],
                ],
              ),
              [
                "Gesamt",
                [
                  ["E8121406", n(r.leistungen)],
                  ["E8200502", n(r.leistungen)],
                  ["E8122003", n(r.bescheinigt)],
                  ["E8122011", r.mehrere ? "1" : undefined],
                ],
              ],
            ],
          ]
        : null,
      mitLeistungen
        ? [
            "Gewinn",
            [
              ["E8201001", n(euro(input.eigenkapital))],
              ["E8201101", n(euro(input.nennkapital))],
              ["E8201201", n(Math.max(0, r.anfang))],
              ["E8201301", n(r.ausschuettbarerGewinn ?? 0)],
            ],
          ]
        : null,
      [
        "ELK",
        [
          [
            "Tabelle",
            [
              [
                "Anfang",
                // Im Gründungsjahr der Bestand beim Eintritt in die Steuerpflicht, sonst der zum Schluss des Vorjahres
                input.gruendung
                  ? [
                      ["E8240102", n(r.anfang)],
                      ["E8240104", "0"],
                    ]
                  : [
                      ["E8240103", n(r.anfang)],
                      ["E8240201", "0"],
                    ],
              ],
              mitLeistungen
                ? [
                    "Verrechnung",
                    [
                      ["E8241717", zwischensumme ? n(r.anfang) : undefined],
                      [
                        "Kein_EeA",
                        [
                          ["E8240302", n(r.leistungen)],
                          ["E8240401", n(r.ausschuettbarerGewinn ?? 0)],
                          ["E8240501", n(r.summe)],
                          // Zeile 50 nur bei Leistungen über dem ausschüttbaren Gewinn, Zeile 51 bei mehreren bescheinigten
                          ["E8242201", !r.mehrere && r.summe > 0 ? n(r.abzug) : undefined],
                          ["E8242202", r.mehrere && r.anfang > 0 ? n(r.abzug) : undefined],
                        ],
                      ],
                    ],
                  ]
                : null,
              [
                "Ende",
                [
                  ["E8245601", n(r.ende)],
                  ["E8245602", "0"],
                ],
              ],
            ],
          ],
        ],
      ],
    ],
  ];
}
