import type { Cents } from "@haben/core";
import { isValidIdnr } from "./bankverbindung.ts";
import { checkEnvelope, envelope, render, vorsatz, type Envelope, type ErklaerungAbsender, type XmlNode } from "./erklaerung.ts";
import { splitStrasse } from "./nachricht.ts";
import { elsterDecimal } from "./xml.ts";

/**
 * Einkommensteuererklärung (E10, Unterfallart 10) mit Hauptvordruck ESt 1 A und den Anlagen
 * Sonderausgaben, außergewöhnliche Belastungen, haushaltsnahe Aufwendungen, Kind, G bzw. S, KAP
 * und Vorsorgeaufwand. Aufbau und Feldkennungen wie bei viking; die Reihenfolge der Elemente folgt
 * der Jahresdokumentation der Finanzverwaltung (XSD-Reihenfolge).
 */

export interface EstPerson {
  idnr: string;
  vorname: string;
  name: string;
  /** JJJJ-MM-TT */
  geburtsdatum: string;
  /** Religionsschlüssel, z. B. "11" (keine), "02" (evangelisch) */
  religion: string;
  beruf: string;
}

/** Beiträge einer Person zur Basisabsicherung, Anlage Vorsorgeaufwand */
export interface EstVorsorgePerson {
  /** Gesetzliche Rentenversicherung (Zeile 4) */
  rentenversicherung?: Cents;
  /** Gesetzliche Krankenversicherung ohne Krankengeldanteil */
  gkv?: Cents;
  /** Soziale Pflegeversicherung */
  gpv?: Cents;
  /** Gesetzlich: über die Basisabsicherung hinaus (Wahlleistungen, Krankengeldanteil) */
  gkvZusatz?: Cents;
  /** Private Krankenversicherung, nur Basisabsicherung */
  pkv?: Cents;
  /** Private Pflege-Pflichtversicherung */
  ppv?: Cents;
  /** Erstattungen der privaten Kranken- und Pflegeversicherung */
  pkvErstattung?: Cents;
}

export interface EstKind {
  idnr?: string;
  vorname: string;
  /** Nur, wenn er vom Namen der Person A abweicht */
  name?: string;
  /** JJJJ-MM-TT */
  geburtsdatum: string;
  familienkasse?: string;
  /** Kinderbetreuungskosten im Jahr */
  kinderbetreuung?: Cents;
}

export interface EstKap {
  guenstigerpruefung?: boolean;
  /** Kapitalerträge mit inländischem Steuerabzug laut Steuerbescheinigung */
  ertraegeMitSteuerabzug?: Cents;
  /** Davon bereits in Anspruch genommener Sparer-Pauschbetrag */
  sparerPauschbetrag?: Cents;
  /** Inländische Kapitalerträge ohne Steuerabzug */
  ertraegeOhneSteuerabzugInland?: Cents;
  /** Ausländische Kapitalerträge ohne Steuerabzug */
  ertraegeAusland?: Cents;
  kapitalertragsteuer?: Cents;
  soli?: Cents;
  kirchensteuer?: Cents;
}

export interface EstAngaben {
  vorsorge: { a: EstVorsorgePerson; b?: EstVorsorgePerson; /** Weitere sonstige Vorsorgeaufwendungen (Haftpflicht, Unfall, Risikoleben) */ sonstige?: Cents };
  sonderausgaben: { kirchensteuerGezahlt?: Cents; kirchensteuerErstattet?: Cents; spenden?: Cents };
  /** Krankheitskosten (außergewöhnliche Belastung) */
  krankheitskosten?: Cents;
  haushaltsnah: { minijobs?: Cents; dienstleistungen?: Cents; /** nur Lohn-, Maschinen- und Fahrtkosten */ handwerker?: Cents };
  kinder: EstKind[];
  kap?: EstKap;
}

export interface EstXmlInput extends Omit<Envelope, "datenArt" | "absender"> {
  personA: EstPerson;
  /** Ehegatte bei Zusammenveranlagung */
  personB?: EstPerson;
  /** JJJJ-MM-TT, Pflicht bei Zusammenveranlagung */
  verheiratetSeit?: string;
  anschrift: { strasse: string; plz: string; ort: string };
  telefon?: string;
  /** Erstattungskonto, Kontoinhaber Person A */
  iban?: string;
  /** Gewinn aus dem Betrieb laut EÜR */
  gewinn?: { einkunftsart: "gewerbe" | "selbstaendig"; taetigkeit: string; betrag: Cents };
  angaben: EstAngaben;
}

/** Ganze Euro, kaufmännisch gerundet; leer bei 0 (das Feld entfällt dann) */
const euro = (cents: Cents | undefined): string | undefined => {
  if (!cents) return undefined;
  const value = Math.round(cents / 100);
  return value === 0 ? undefined : String(value);
};
const mitCent = (cents: Cents | undefined) => (cents ? elsterDecimal(cents) : undefined);
const germanDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Zeitraum TT.MM-TT.MM im Jahr: ab Geburt, wenn das Kind im Jahr geboren ist */
export function kindZeitraum(year: number, geburtsdatum: string): string {
  const von = geburtsdatum.startsWith(`${year}-`) ? `${geburtsdatum.slice(8, 10)}.${geburtsdatum.slice(5, 7)}` : "01.01";
  return `${von}-31.12`;
}

/** Summenblock mit genau einem Einzelposten; ERiC verlangt mindestens einen */
const einzelUndSumme = (name: string, art: [string, string], betrag: string, summe: string, cents: Cents | undefined): XmlNode | null => {
  const value = euro(cents);
  if (!value) return null;
  return [
    name,
    [
      [
        "Einz",
        [
          [art[0], art[1]],
          [betrag, value],
        ],
      ],
      ["Sum", [[summe, value]]],
    ],
  ];
};

function checkPerson(label: string, p: EstPerson) {
  if (!isValidIdnr(p.idnr)) throw new Error(`${label}: Die Identifikationsnummer ist ungültig.`);
  if (!p.vorname.trim() || !p.name.trim()) throw new Error(`${label}: Vor- und Nachname fehlen.`);
  if (!isIsoDate(p.geburtsdatum)) throw new Error(`${label}: Das Geburtsdatum fehlt.`);
}

export function buildEstXml(input: EstXmlInput): string {
  const a = input.personA;
  const b = input.personB;
  checkPerson("Person A", a);
  if (b) {
    checkPerson("Ehegatte", b);
    if (!input.verheiratetSeit || !isIsoDate(input.verheiratetSeit)) throw new Error("Für die Zusammenveranlagung fehlt das Heiratsdatum.");
  }
  const adresse = splitStrasse(input.anschrift.strasse);
  if (!adresse) throw new Error("In der Anschrift fehlt die Hausnummer.");
  const hausnummer = /^(\d+)(.*)$/.exec(adresse.hausnummer);
  const absender: ErklaerungAbsender = { name: `${a.vorname} ${a.name}`, ...input.anschrift };
  const envelopeInput: Envelope = { ...input, absender, datenArt: "ESt" };
  checkEnvelope(envelopeInput);
  const x = input.angaben;
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
              ["E0100081", a.idnr],
              ["E0100401", germanDate(a.geburtsdatum)],
              ["E0100201", a.name.trim()],
              ["E0100301", a.vorname.trim()],
              ["E0100402", a.religion || "11"],
              ["E0100403", a.beruf.trim() || undefined],
              ["E0101104", adresse.strasse],
              ["E0101206", hausnummer?.[1] ?? adresse.hausnummer],
              ["E0101207", hausnummer?.[2]?.replace(/^[\s-]+/, "") || undefined],
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
                  ["E0100082", b.idnr],
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

  const kinder: XmlNode[] = x.kinder.map((kind): XmlNode => {
    if (!kind.vorname.trim() || !isIsoDate(kind.geburtsdatum)) throw new Error("Kind: Vorname und Geburtsdatum fehlen.");
    if (kind.idnr && !isValidIdnr(kind.idnr)) throw new Error(`Kind ${kind.vorname}: Die Identifikationsnummer ist ungültig.`);
    const zeitraum = kindZeitraum(input.year, kind.geburtsdatum);
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
            zusammen
              ? [
                  "K_Verh_B",
                  [
                    ["E0500808", "1"],
                    ["E0500805", zeitraum],
                  ],
                ]
              : null,
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
                zusammen
                  ? [
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
                    ]
                  : [
                      "Ang_HH",
                      [
                        [
                          "K_gem_HH_Elt",
                          [
                            ["E0505201", zeitraum],
                            ["E0505202", zeitraum],
                          ],
                        ],
                      ],
                    ],
                // Ohne Zusammenveranlagung: selbst getragene Kosten, hier die vollen Kosten
                zusammen
                  ? null
                  : [
                      "Elt_k_ZV",
                      [
                        [
                          "Kosten",
                          [
                            [
                              "Einz",
                              [
                                ["E0506606", zeitraum],
                                ["E0506605", betreuung],
                              ],
                            ],
                            ["Sum", [["E0506604", betreuung]]],
                          ],
                        ],
                      ],
                    ],
              ],
            ]
          : null,
      ],
    ];
  });

  const gewinn = input.gewinn;
  const gewinnEuro = gewinn ? String(Math.round(gewinn.betrag / 100)) : undefined;
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
            ["Ant", [["E1900401", k.guenstigerpruefung ? "1" : undefined]]],
            ["KapErt_inl_StAbz", [["Betr_lt_StBesch", [["E1900701", euro(k.ertraegeMitSteuerabzug)]]]]],
            // Nur zusammen mit Erträgen mit Steuerabzug (ERiC-Regel 192021)
            ["Sp_PB", [["E1901401", k.ertraegeMitSteuerabzug ? euro(k.sparerPauschbetrag) : undefined]]],
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

  const vorsorgePersonen: [string, EstVorsorgePerson | undefined][] = [
    ["PersonA", x.vorsorge.a],
    ["PersonB", zusammen ? x.vorsorge.b : undefined],
  ];
  const vor: XmlNode = [
    "VOR",
    [
      ...vorsorgePersonen.map(([person, v]): XmlNode | null =>
        euro(v?.rentenversicherung)
          ? [
              "AVor",
              [
                ["Person", person],
                ["E2000601", euro(v?.rentenversicherung)],
              ],
            ]
          : null,
      ),
      ...vorsorgePersonen.map(([person, v]): XmlNode | null =>
        euro(v?.gkv) || euro(v?.gpv) || euro(v?.gkvZusatz)
          ? [
              "Beitr_g_KV_PV_Inl",
              [
                ["Person", person],
                [
                  "And_Pers",
                  [
                    ["E2001805", euro(v?.gkv)],
                    ["E2002105", euro(v?.gpv)],
                    ["E2002206", euro(v?.gkvZusatz)],
                  ],
                ],
              ],
            ]
          : null,
      ),
      ...vorsorgePersonen.map(([person, v]): XmlNode | null =>
        euro(v?.pkv) || euro(v?.ppv) || euro(v?.pkvErstattung)
          ? [
              "Beitr_p_KV_PV_Inl",
              [
                ["Person", person],
                ["E2003104", euro(v?.pkv)],
                ["E2003202", euro(v?.ppv)],
                ["E2003302", euro(v?.pkvErstattung)],
              ],
            ]
          : null,
      ),
      ["Weit_Sons_VorAW", [["A_B_LP", [["U_HP_Ris_Vers", [["Sum", [["E2001803", euro(x.vorsorge.sonstige)]]]]]]]]],
    ],
  ];

  return envelope(envelopeInput, [
    `<E10 xmlns="http://finkonsens.de/elster/elstererklaerung/est/e10/v${input.year}" version="${input.year}">`,
    ...[est1a, sa, agb, ha35a, ...kinder, anlageG, anlageS, kap, vor].flatMap((node) => render(node, "  ")),
    ...render(vorsatz("10", envelopeInput), "  "),
    `</E10>`,
  ]);
}
