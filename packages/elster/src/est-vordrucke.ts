import { roundHalfAwayFromZero } from "@haben/core";
import { germanDate, isValidIdnr } from "./bankverbindung.ts";
import type { XmlNode } from "./erklaerung.ts";
import type { EstAngaben, EstErsatzleistung, EstKind, EstPerson, EstXmlInput } from "./est.ts";
import { einzelUndSumme, euro, isIsoDate, kindZeitraum, mitCent } from "./est-werte.ts";
import type { splitStrasse } from "./nachricht.ts";
import { ElsterEingabeError } from "./xml.ts";

/* Hauptvordruck ESt 1 A und die Anlagen Sonderausgaben, außergewöhnliche Belastungen, haushaltsnahe Aufwendungen, Kind,
 * G bzw. S, KAP und die Einkommensersatzleistungen der Einkommensteuererklärung (est.ts) */

export type Adresse = NonNullable<ReturnType<typeof splitStrasse>>;

/** Hauptvordruck ESt 1 A mit den Personen, der Anschrift und der Bankverbindung */
export function hauptvordruck(input: EstXmlInput, adresse: Adresse): XmlNode {
  const a = input.personA;
  const b = input.personB;
  const zusammen = Boolean(b);
  const est1a: XmlNode = [
    "ESt1A",
    [
      ["Art_Erkl", [["E0100001", "X"]]],
      [
        "Allg",
        [
          ["E0100008", input.telefon?.trim() || undefined],
          [
            "A",
            [
              ["E0100401", germanDate(a.geburtsdatum)],
              ["E0100201", a.name.trim()],
              ["E0100301", a.vorname.trim()],
              ["E0100402", a.religion || "11"],
              ["E0100403", a.beruf.trim() || undefined],
              ["E0101104", adresse.strasse],
              ["E0101206", adresse.hausnummer],
              ["E0101207", adresse.zusatz?.replace(/^[-/]/, "")],
              ["E0100601", input.anschrift.plz],
              ["E0100602", input.anschrift.ort],
              ["E0100701", zusammen ? germanDate(input.verheiratetSeit!) : undefined],
            ],
          ],
          zusammen ? ["Vlg_Art", [["E0101201", "X"]]] : null,
          b
            ? [
                "B",
                [
                  ["E0101001", germanDate(b.geburtsdatum)],
                  ["E0100901", b.name.trim()],
                  ["E0100801", b.vorname.trim()],
                  ["E0101002", b.religion || "11"],
                  ["E0101003", b.beruf.trim() || undefined],
                ],
              ]
            : null,
          input.iban
            ? [
                "BV",
                [
                  ["E0102102", input.iban.replace(/\s+/g, "").toUpperCase()],
                  ["Kto_Inh", [["E0101601", "X"]]],
                ],
              ]
            : null,
        ],
      ],
    ],
  ];
  return est1a;
}

/** Sonderausgaben, außergewöhnliche Belastungen und haushaltsnahe Aufwendungen (§ 35a EStG) */
export function sonderausgaben(x: EstAngaben): XmlNode[] {
  const sa: XmlNode = [
    "SA",
    [
      [
        "KiSt",
        [
          ["Gezahlt", [["Sum", [["E0107601", euro(x.sonderausgaben.kirchensteuerGezahlt)]]]]],
          ["Erstattet", [["E0107602", euro(x.sonderausgaben.kirchensteuerErstattet)]]],
        ],
      ],
      ["Zuw", [["Sp_MB", [["Foerd_st_beg_Zw_Inl", [["Sum_Best", [["E0108105", euro(x.sonderausgaben.spenden)]]]]]]]]],
    ],
  ];

  const agb: XmlNode = ["AgB", [["And_Aufw", [["Krankh", [["Sum", [["E0161304", euro(x.krankheitskosten)]]]]]]]]];

  const ha35a: XmlNode = [
    "HA_35a",
    [
      [
        "St_Erm",
        [
          einzelUndSumme("Minijobs", ["E0104206", "Minijob im Haushalt"], "E0104108", "E0104109", x.haushaltsnah.minijobs),
          einzelUndSumme("Hhn_BV_DL", ["E0107206", "Haushaltsnahe Dienstleistungen"], "E0107207", "E0107208", x.haushaltsnah.dienstleistungen),
          einzelUndSumme("Handw_L", ["E0111217", "Handwerkerleistungen"], "E0111214", "E0111215", x.haushaltsnah.handwerker),
        ],
      ],
    ],
  ];
  return [sa, agb, ha35a];
}

/** Anlage Kind für ein Kind */
export function anlageKind(kind: EstKind, year: number, a: EstPerson): XmlNode {
  if (!kind.vorname.trim() || !isIsoDate(kind.geburtsdatum)) throw new ElsterEingabeError("Kind: Vorname und Geburtsdatum fehlen.");
  if (kind.idnr && !isValidIdnr(kind.idnr)) throw new ElsterEingabeError(`Kind ${kind.vorname}: Die Identifikationsnummer ist ungültig.`);
  // ELSTER verlangt Vorname, Geburtsdatum und Familienkasse gemeinsam
  if (!kind.familienkasse?.trim()) throw new ElsterEingabeError(`Kind ${kind.vorname}: Die zuständige Familienkasse fehlt.`);
  const zeitraum = kindZeitraum(year, kind.geburtsdatum);
  const betreuung = euro(kind.kinderbetreuung);
  return [
    "Kind",
    [
      [
        "Ang_Kind",
        [
          [
            "Allg",
            [
              ["E0500406", kind.idnr || undefined],
              ["E0500107", kind.vorname.trim()],
              ["E0500108", kind.name?.trim() && kind.name.trim() !== a.name.trim() ? kind.name.trim() : undefined],
              ["E0500701", germanDate(kind.geburtsdatum)],
              ["E0500706", kind.familienkasse?.trim() || undefined],
            ],
          ],
          ["WS", [["Inl", [["E0500703", zeitraum]]]]],
        ],
      ],
      [
        "K_Verh",
        [
          // 1 = leibliches Kind / Adoptivkind
          [
            "K_Verh_A",
            [
              ["E0500807", "1"],
              ["E0500601", zeitraum],
            ],
          ],
          // Kinder gibt es nur bei Zusammenveranlagung (siehe oben), also immer auch zu Person B
          [
            "K_Verh_B",
            [
              ["E0500808", "1"],
              ["E0500805", zeitraum],
            ],
          ],
        ],
      ],
      betreuung
        ? [
            "KBK",
            [
              [
                "Art",
                [
                  [
                    "Einz",
                    [
                      ["E0506101", "Kinderbetreuung"],
                      ["E0506103", zeitraum],
                      ["E0506104", betreuung],
                    ],
                  ],
                  ["Sum", [["E0506105", betreuung]]],
                ],
              ],
              [
                "Ang_HH",
                [
                  [
                    "Gem_HH_Elt",
                    [
                      ["E0504807", zeitraum],
                      ["E0504808", zeitraum],
                    ],
                  ],
                ],
              ],
            ],
          ]
        : null,
    ],
  ];
}

/** Anlage G bzw. S mit dem Gewinn aus der EÜR */
export function gewinnAnlagen(input: EstXmlInput): (XmlNode | null)[] {
  const gewinn = input.gewinn;
  const gewinnEuro = gewinn ? String(roundHalfAwayFromZero(gewinn.betrag / 100)) : undefined;
  const anlageG: XmlNode | null =
    gewinn?.einkunftsart === "gewerbe"
      ? [
          "G",
          [
            ["Person", "PersonA"],
            [
              "Gew",
              [
                [
                  "Einz_U",
                  [
                    [
                      "Betr_1_2",
                      [
                        ["E0800301", gewinn.taetigkeit.trim() || "Gewerbebetrieb"],
                        ["E0800302", gewinnEuro],
                      ],
                    ],
                  ],
                ],
              ],
            ],
          ],
        ]
      : null;
  const anlageS: XmlNode | null =
    gewinn?.einkunftsart === "selbstaendig"
      ? [
          "S",
          [
            ["Person", "PersonA"],
            [
              "Gewinn",
              [
                [
                  "Freiber_T",
                  [
                    ["E0803101", gewinn.taetigkeit.trim() || "Freiberufliche Tätigkeit"],
                    ["E0803202", gewinnEuro],
                  ],
                ],
              ],
            ],
          ],
        ]
      : null;
  return [anlageG, anlageS];
}

/** Anlage KAP für Person A und, bei Zusammenveranlagung mit Günstigerprüfung, für Person B */
export function kapAnlagen(x: EstAngaben, zusammen: boolean): (XmlNode | null)[] {
  const k = x.kap;
  const kapHatWerte =
    k &&
    [k.ertraegeMitSteuerabzug, k.ertraegeOhneSteuerabzugInland, k.ertraegeAusland, k.kapitalertragsteuer, k.soli, k.kirchensteuer].some((v) => (v ?? 0) > 0);
  const kap: XmlNode | null =
    k && (kapHatWerte || k.guenstigerpruefung)
      ? [
          "KAP",
          [
            ["Person", "PersonA"],
            [
              "Ant",
              [
                ["E1900401", k.guenstigerpruefung ? "1" : undefined],
                // Erträge mit Steuerabzug brauchen einen Grund; ohne Günstigerprüfung die Überprüfung des Einbehalts
                ["E1900501", !k.guenstigerpruefung && k.ertraegeMitSteuerabzug ? "1" : undefined],
              ],
            ],
            ["KapErt_inl_StAbz", [["Betr_lt_StBesch", [["E1900701", euro(k.ertraegeMitSteuerabzug)]]]]],
            // Nur zusammen mit Erträgen mit Steuerabzug (ERiC-Regel 192021)
            [
              "Sp_PB",
              [
                ["E1901401", k.ertraegeMitSteuerabzug ? euro(k.sparerPauschbetrag) : undefined],
                // Pflicht beim Antrag auf Überprüfung: Haben erklärt alle Erträge in der Anlage KAP, also 0
                ["E1901402", !k.guenstigerpruefung && k.ertraegeMitSteuerabzug ? "0" : undefined],
              ],
            ],
            [
              "KapErt_kein_inl_StAbz",
              [
                ["E1901501", euro(k.ertraegeOhneSteuerabzugInland)],
                ["E1901702", euro(k.ertraegeAusland)],
              ],
            ],
            [
              "St_Abz_Betr_Inl_u_Inv_Ert",
              [
                ["E1904701", mitCent(k.kapitalertragsteuer)],
                ["E1904901", mitCent(k.soli)],
                ["E1904801", mitCent(k.kirchensteuer)],
              ],
            ],
          ],
        ]
      : null;
  // Die Günstigerprüfung gilt bei Zusammenveranlagung nur, wenn beide sie beantragen
  const kapB: XmlNode | null =
    zusammen && k?.guenstigerpruefung
      ? [
          "KAP",
          [
            ["Person", "PersonB"],
            ["Ant", [["E1900401", "1"]]],
          ],
        ]
      : null;
  return [kap, kapB];
}

/** § 32b: steuerfreie Einkommensersatzleistungen je Person, im Hauptvordruck direkt hinter Allg */
export function einkommensersatz(x: EstAngaben, zusammen: boolean): (XmlNode | null)[] {
  return (
    [
      ["PersonA", x.ersatzleistungen?.a],
      ["PersonB", zusammen ? x.ersatzleistungen?.b : undefined],
    ] as [string, EstErsatzleistung[] | undefined][]
  ).map(([person, liste]): XmlNode | null => {
    const zeilen = (liste ?? []).filter((l) => l.betrag > 0 && l.art.trim());
    if (zeilen.length === 0) return null;
    // ERiC-Regel 725: Die Summe muss die Summe der gerundeten Einzelbeträge sein, nicht die gerundete Summe in Cent
    const betraege = zeilen.map((l) => Number(euro(l.betrag) ?? 0));
    const summe = betraege.reduce((acc, b) => acc + b, 0);
    return [
      "Eink_Ers",
      [
        ["Person", person],
        [
          "Inl",
          [
            ...zeilen.map(
              (l, i): XmlNode => [
                "Einz",
                [
                  ["E0104110", l.art.trim()],
                  ["E0104113", String(betraege[i])],
                ],
              ],
            ),
            ["Sum", [["E0104801", String(summe)]]],
          ],
        ],
      ],
    ];
  });
}
