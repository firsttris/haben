import { roundHalfAwayFromZero, type Cents } from "@haben/core";
import { germanDate, isValidIdnr } from "./bankverbindung.ts";
import { checkEnvelope, envelope, render, vorsatz, type Envelope, type ErklaerungAbsender, type XmlNode } from "./erklaerung.ts";
import { splitStrasse } from "./nachricht.ts";
import { elsterDecimal, ElsterEingabeError } from "./xml.ts";

/**
 * Einkommensteuererklärung (E10, Unterfallart 10) mit Hauptvordruck ESt 1 A und den Anlagen
 * Sonderausgaben, außergewöhnliche Belastungen, haushaltsnahe Aufwendungen, Kind, G bzw. S, N, KAP
 * und Vorsorgeaufwand. Feldkennungen und Kontexte der Anlage N und der Arbeitnehmerzeilen der
 * Anlage Vorsorgeaufwand aus der Jahresdokumentation 2024. Aufbau und Feldkennungen wie bei viking; die Reihenfolge der Elemente folgt
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

/** Eine Lohnsteuerbescheinigung; die Nummern beziehen sich auf deren Zeilen */
export interface EstLohnsteuerbescheinigung {
  steuerklasse: 1 | 2 | 3 | 4 | 5 | 6;
  /** Nr. 3 Bruttoarbeitslohn */
  brutto: Cents;
  /** Nr. 4 */
  lohnsteuer?: Cents;
  /** Nr. 5 */
  soli?: Cents;
  /** Nr. 6 Kirchensteuer des Arbeitnehmers */
  kirchensteuer?: Cents;
  /** Nr. 7 Kirchensteuer des Ehegatten (nur bei Konfessionsverschiedenheit) */
  kirchensteuerEhegatte?: Cents;
  /** Nr. 22a Arbeitgeberanteil zur gesetzlichen Rentenversicherung */
  rvArbeitgeber?: Cents;
  /** Nr. 23a Arbeitnehmeranteil zur gesetzlichen Rentenversicherung */
  rvArbeitnehmer?: Cents;
  /** Nr. 25 Arbeitnehmerbeiträge zur gesetzlichen Krankenversicherung */
  kvArbeitnehmer?: Cents;
  /** Nr. 26 Arbeitnehmerbeiträge zur sozialen Pflegeversicherung */
  pvArbeitnehmer?: Cents;
  /** Nr. 27 Arbeitnehmerbeiträge zur Arbeitslosenversicherung */
  avArbeitnehmer?: Cents;
}

export interface EstWerbungskosten {
  /** Wege zur ersten Tätigkeitsstätte (Entfernungspauschale) */
  wege?: { tage: number; km: number; adresse: string; arbeitstageJeWoche?: number; urlaubstage?: number };
  /** Homeoffice-Tage ohne Besuch der ersten Tätigkeitsstätte */
  homeofficeTage?: number;
  /** Für die Tätigkeit steht dauerhaft kein anderer Arbeitsplatz zur Verfügung */
  keinAndererArbeitsplatz?: boolean;
  arbeitsmittel?: Cents;
  fortbildung?: Cents;
  berufsverbaende?: Cents;
  /** Weitere, etwa Kontoführung oder Bewerbungen */
  sonstige?: Cents;
}

/** Arbeitslohn einer Person, Anlage N */
export interface EstArbeitnehmer {
  bescheinigungen: EstLohnsteuerbescheinigung[];
  werbungskosten: EstWerbungskosten;
}

export interface EstAngaben {
  vorsorge: { a: EstVorsorgePerson; b?: EstVorsorgePerson; /** Weitere sonstige Vorsorgeaufwendungen (Haftpflicht, Unfall, Risikoleben) */ sonstige?: Cents };
  sonderausgaben: { kirchensteuerGezahlt?: Cents; kirchensteuerErstattet?: Cents; spenden?: Cents };
  /** Krankheitskosten (außergewöhnliche Belastung) */
  krankheitskosten?: Cents;
  haushaltsnah: { minijobs?: Cents; dienstleistungen?: Cents; /** nur Lohn-, Maschinen- und Fahrtkosten */ handwerker?: Cents };
  kinder: EstKind[];
  kap?: EstKap;
  /** Anlage N je Person */
  arbeitnehmer?: { a?: EstArbeitnehmer; b?: EstArbeitnehmer };
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
  const value = roundHalfAwayFromZero(cents / 100);
  return value === 0 ? undefined : String(value);
};
const mitCent = (cents: Cents | undefined) => (cents ? elsterDecimal(cents) : undefined);
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
  if (!isValidIdnr(p.idnr)) throw new ElsterEingabeError(`${label}: Die Identifikationsnummer ist ungültig.`);
  if (!p.vorname.trim() || !p.name.trim()) throw new ElsterEingabeError(`${label}: Vor- und Nachname fehlen.`);
  if (!isIsoDate(p.geburtsdatum)) throw new ElsterEingabeError(`${label}: Das Geburtsdatum fehlt.`);
}

export function buildEstXml(input: EstXmlInput): string {
  const a = input.personA;
  const b = input.personB;
  checkPerson("Person A", a);
  if (b) {
    checkPerson("Ehegatte", b);
    if (!input.verheiratetSeit || !isIsoDate(input.verheiratetSeit)) throw new ElsterEingabeError("Für die Zusammenveranlagung fehlt das Heiratsdatum.");
  }
  const adresse = splitStrasse(input.anschrift.strasse);
  if (!adresse) throw new ElsterEingabeError("In der Anschrift fehlt die Hausnummer.");
  const absender: ErklaerungAbsender = { name: `${a.vorname} ${a.name}`, ...input.anschrift };
  const envelopeInput: Envelope = { ...input, absender, datenArt: "ESt" };
  checkEnvelope(envelopeInput);
  const x = input.angaben;
  const zusammen = Boolean(b);
  // ELSTER verlangt eine Bankverbindung oder die ausdrückliche Erklärung, dass keine besteht
  if (!input.iban?.trim()) throw new ElsterEingabeError("Für die Einkommensteuererklärung fehlt die Bankverbindung (IBAN in den Firmendaten).");
  // Ohne Zusammenveranlagung verlangt die Anlage Kind Angaben zum anderen Elternteil, die Haben nicht erfasst
  if (!zusammen && input.angaben.kinder.length > 0) {
    throw new ElsterEingabeError("Kinder bei Einzelveranlagung: ELSTER verlangt Angaben zum anderen Elternteil, die Haben noch nicht erfasst. Bitte über Mein ELSTER abgeben.");
  }

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
    if (!kind.vorname.trim() || !isIsoDate(kind.geburtsdatum)) throw new ElsterEingabeError("Kind: Vorname und Geburtsdatum fehlen.");
    if (kind.idnr && !isValidIdnr(kind.idnr)) throw new ElsterEingabeError(`Kind ${kind.vorname}: Die Identifikationsnummer ist ungültig.`);
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
  });

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

  const personen: [string, EstArbeitnehmer | undefined][] = [
    ["PersonA", x.arbeitnehmer?.a],
    ["PersonB", zusammen ? x.arbeitnehmer?.b : undefined],
  ];
  const anlagenN = personen.flatMap(([person, an]) => (an && an.bescheinigungen.length > 0 ? [anlageN(person, an)] : []));
  const lstb = (an: EstArbeitnehmer | undefined, key: keyof Omit<EstLohnsteuerbescheinigung, "steuerklasse">) =>
    an ? an.bescheinigungen.reduce((s, b) => s + (b[key] ?? 0), 0) : 0;

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
  const kapB: XmlNode | null = zusammen && k?.guenstigerpruefung ? ["KAP", [["Person", "PersonB"], ["Ant", [["E1900401", "1"]]]]] : null;

  const vorsorgePersonen: [string, EstVorsorgePerson | undefined][] = [
    ["PersonA", x.vorsorge.a],
    ["PersonB", zusammen ? x.vorsorge.b : undefined],
  ];
  const arbeitnehmerVon = (person: string) => personen.find(([p]) => p === person)?.[1];
  const vor: XmlNode = [
    "VOR",
    [
      ...vorsorgePersonen.map(([person, v]): XmlNode | null => {
        const an = arbeitnehmerVon(person);
        const felder: XmlNode[] = [
          ["E2000401", euro(lstb(an, "rvArbeitnehmer"))],
          ["E2000601", euro(v?.rentenversicherung)],
          ["E2000801", euro(lstb(an, "rvArbeitgeber"))],
        ];
        return felder.some((f) => f[1]) ? ["AVor", [["Person", person], ...felder]] : null;
      }),
      ...vorsorgePersonen.map(([person, v]): XmlNode | null => {
        const an = arbeitnehmerVon(person);
        const kvAn = euro(lstb(an, "kvArbeitnehmer"));
        const pvAn = euro(lstb(an, "pvArbeitnehmer"));
        const andere = euro(v?.gkv) || euro(v?.gpv) || euro(v?.gkvZusatz);
        if (!kvAn && !pvAn && !andere) return null;
        return [
          "Beitr_g_KV_PV_Inl",
          [
            ["Person", person],
            kvAn || pvAn
              ? [
                  "AN",
                  [
                    ["E2001203", kvAn],
                    ["E2001505", pvAn],
                  ],
                ]
              : null,
            andere
              ? [
                  "And_Pers",
                  [
                    ["E2001805", euro(v?.gkv)],
                    ["E2002105", euro(v?.gpv)],
                    ["E2002206", euro(v?.gkvZusatz)],
                  ],
                ]
              : null,
          ],
        ];
      }),
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
      [
        "Weit_Sons_VorAW",
        [
          ...vorsorgePersonen.map(([person]): XmlNode | null => {
            const av = euro(lstb(arbeitnehmerVon(person), "avArbeitnehmer"));
            return av
              ? [
                  "Pers",
                  [
                    ["Person", person],
                    ["E2004403", av],
                  ],
                ]
              : null;
          }),
          ["A_B_LP", [["U_HP_Ris_Vers", [["Sum", [["E2001803", euro(x.vorsorge.sonstige)]]]]]]],
        ],
      ],
    ],
  ];

  return envelope(envelopeInput, [
    `<E10 xmlns="http://finkonsens.de/elster/elstererklaerung/est/e10/v${input.year}" version="${input.year}">`,
    ...[est1a, sa, agb, ha35a, ...kinder, anlageG, anlageS, ...anlagenN, kap, kapB, vor].flatMap((node) => render(node, "  ")),
    ...render(vorsatz("10", envelopeInput, { a: a.idnr, ...(b ? { b: b.idnr } : {}) }), "  "),
    `</E10>`,
  ]);
}

/** Volle Kilometer bzw. Tage, sonst entfällt das Feld */
const ganz = (n: number | undefined) => (n && n > 0 ? String(Math.floor(n)) : undefined);

/** Ein Einzelposten mit Bezeichnung und Betrag und seine Summe */
const posten = (name: string, felder: [string, string, string], text: string, cents: Cents | undefined): XmlNode | null => {
  const value = euro(cents);
  if (!value) return null;
  return [
    name,
    [
      [
        "Einz",
        [
          [felder[0], text],
          [felder[1], value],
        ],
      ],
      ["Sum", [[felder[2], value]]],
    ],
  ];
};

/** Anlage N einer Person: Lohnsteuerbescheinigungen (Steuerklasse 1–5 bzw. 6) und Werbungskosten */
export function anlageN(person: string, an: EstArbeitnehmer): XmlNode {
  for (const b of an.bescheinigungen) {
    if (!(b.brutto > 0)) throw new ElsterEingabeError("Anlage N: Der Bruttoarbeitslohn fehlt.");
    if (![1, 2, 3, 4, 5, 6].includes(b.steuerklasse)) throw new ElsterEingabeError("Anlage N: Die Steuerklasse fehlt.");
  }
  const sum = (list: EstLohnsteuerbescheinigung[], key: keyof Omit<EstLohnsteuerbescheinigung, "steuerklasse">) => list.reduce((s, b) => s + (b[key] ?? 0), 0);
  const gruppe = (list: EstLohnsteuerbescheinigung[], einz: string, summe: string, ids: { einz: string[]; sum: string[] }, mitKlasse: boolean): XmlNode[] => {
    if (list.length === 0) return [];
    const keys = ["brutto", "lohnsteuer", "soli", "kirchensteuer", "kirchensteuerEhegatte"] as const;
    return [
      // Kirchensteuer verlangt ELSTER ausdrücklich, ggf. mit 0
      ...list.map((b): XmlNode => [einz, keys.map((key, i): XmlNode => [ids.einz[i]!, key === "kirchensteuer" ? elsterDecimal(b[key] ?? 0) : mitCent(b[key])])]),
      [
        summe,
        [
          mitKlasse ? ["E0200002", String(list[0]!.steuerklasse)] : null,
          ...keys.map((key, i): XmlNode => [ids.sum[i]!, i === 0 ? euro(sum(list, key)) : key === "kirchensteuer" ? elsterDecimal(sum(list, key)) : mitCent(sum(list, key))]),
        ],
      ],
    ];
  };
  const klasse1bis5 = an.bescheinigungen.filter((b) => b.steuerklasse !== 6);
  const klasse6 = an.bescheinigungen.filter((b) => b.steuerklasse === 6);
  const w = an.werbungskosten;
  const wege = w.wege && w.wege.tage > 0 && w.wege.km > 0 ? w.wege : undefined;
  if (wege && !wege.adresse.trim()) throw new ElsterEingabeError("Anlage N: Die Anschrift der Tätigkeitsstätte fehlt.");

  const wk: XmlNode = [
    "Wk",
    [
      wege
        ? [
            "EP",
            [
              [
                "Erste_Taetig",
                [
                  ["E0203003", "1"],
                  ["E0203501", wege.adresse.trim()],
                  ["E0203101", "01.01-31.12"],
                  ["E0203508", ganz(wege.arbeitstageJeWoche)],
                  ["E0203509", ganz(wege.urlaubstage)],
                  ["E0203503", ganz(wege.tage)],
                  ["E0203504", ganz(wege.km)],
                  ["E0203505", ganz(wege.km)],
                ],
              ],
            ],
          ]
        : null,
      posten("Berufsverb", ["E0204001", "E0204003", "E0204002"], "Berufsverbände und Gewerkschaft", w.berufsverbaende),
      posten("Arbeitsmittel", ["E0204401", "E0204402", "E0204403"], "Arbeitsmittel", w.arbeitsmittel),
      ganz(w.homeofficeTage)
        ? ["Homeoffice", [[w.keinAndererArbeitsplatz ? "E0206206" : "E0204507", ganz(w.homeofficeTage)]]]
        : null,
      posten("Fortb", ["E0204804", "E0204808", "E0204812"], "Fortbildung", w.fortbildung),
      euro(w.sonstige)
        ? [
            "Weitere_Wk",
            [
              [
                "Sonst",
                [
                  ["E0205405", "Weitere Werbungskosten (z. B. Kontoführung)"],
                  ["E0205406", euro(w.sonstige)],
                ],
              ],
              ["Sum", [["E0204803", euro(w.sonstige)]]],
            ],
          ]
        : null,
    ],
  ];

  return [
    "N",
    [
      ["Person", person],
      [
        "ArbL",
        [
          ...gruppe(klasse1bis5, "LStB_1_5_Einz", "LStB_1_5_Sum", { einz: ["E0200204", "E0200304", "E0200404", "E0200504", "E0200604"], sum: ["E0200201", "E0200301", "E0200401", "E0200501", "E0200601"] }, true),
          ...gruppe(klasse6, "LStB_6_Einz", "LStB_6_Sum", { einz: ["E0200202", "E0200302", "E0200402", "E0200502", "E0200602"], sum: ["E0200203", "E0200303", "E0200403", "E0200503", "E0200603"] }, false),
        ],
      ],
      wk,
    ],
  ];
}
