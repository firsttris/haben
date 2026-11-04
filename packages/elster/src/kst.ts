import type { Cents } from "@haben/core";
import { germanDate } from "./bankverbindung.ts";
import { checkEnvelope, envelope, render, vorsatz, type Envelope, type XmlNode } from "./erklaerung.ts";
import { kst1fNode, type Kst1fInput } from "./kst1f.ts";
import { ElsterEingabeError } from "./xml.ts";

/**
 * Körperschaftsteuererklärung (E30, Unterfallart 30) einer GmbH oder UG: Hauptvordruck KSt 1 mit Anteilseignern,
 * Anlage GK (Gewinnermittlung), Anlage ZVE (Einkommen und Steuer), Anlage Verluste (§ 10d EStG) und Anlage KSt 1 F
 * (steuerliches Einlagekonto, § 27 KStG). Für ein Unternehmen ohne Organschaft, Beteiligungen, ausländische Einkünfte,
 * Spenden und verdeckte Gewinnausschüttungen, mit Kalenderjahr als Wirtschaftsjahr; offene Gewinnausschüttungen mindern
 * das Einlagekonto (kst1f.ts), Einlagen in das Einlagekonto gibt es nicht.
 *
 * Feldkennungen, Kontexte und Reihenfolge aus der Jahresdokumentation 30_2025 und dem Schema E30-2025 im ERiC-Paket
 * 43.4.6.0. Die Anlagen rechnen in vollen Euro; die Summen bildet der Baustein selbst aus den Einzelbeträgen, damit sie
 * zu den Plausibilitätsregeln passen.
 */

export const KST_JAHRE = [2025] as const;

/** Schlüssel RECHTSFORM_KOERPERSCHAFTEN_V3: 350 GmbH, 370 UG (haftungsbeschränkt) */
const RECHTSFORM = { gmbh: "350", ug: "370" } as const;

/** Sockel und Quote in Prozent der Mindestbesteuerung (§ 10d Abs. 2 EStG, 70 % für 2024 bis 2027) */
const SOCKEL = 1_000_000;
const QUOTE = (year: number) => (year >= 2024 && year <= 2027 ? 70 : 60);

export interface KstAnteilseigner {
  name: string;
  /** Straße und Hausnummer */
  strasse: string;
  /** Postleitzahl und Wohnort */
  plzOrt: string;
  /** Steuernummer im ELSTER-Format (13 Ziffern) oder steuerliche Identifikationsnummer */
  steuernummer13?: string;
  idnr?: string;
  /** Höhe der Beteiligung (Nennbetrag der Geschäftsanteile) */
  beteiligung: Cents;
  /** Anteil in Hundertstel Prozent, 10000 = 100 % */
  anteil: number;
  /** Seit wann beteiligt, JJJJ-MM-TT; nur wenn im Jahr eingetreten */
  seit?: string;
  geaendert: boolean;
}

export interface KstXmlInput extends Omit<Envelope, "datenArt">, Omit<Kst1fInput, "year" | "gruendung"> {
  rechtsform: keyof typeof RECHTSFORM;
  /** Ort von Sitz und Geschäftsleitung */
  sitz: string;
  /** Im Jahr gegründet: Beginn der unbeschränkten Steuerpflicht und des ersten (Rumpf-)Wirtschaftsjahres, JJJJ-MM-TT */
  gruendung?: string;
  anteilseigner: readonly KstAnteilseigner[];
  jahresergebnis: Cents;
  /** Nicht abziehbare Aufwendungen je Zeile der Anlage GK */
  hinzurechnungen: { kst: Cents; soli: Cents; kapest: Cents; gewst: Cents; sonstige: Cents };
  /** Verbleibender Verlustvortrag zum Schluss des Vorjahres */
  verlustvortrag: Cents;
  /** Verlustrücktrag in die Vorjahre; 0 = Verzicht (§ 10d Abs. 1 Satz 5 EStG) */
  verlustruecktrag: Cents;
  /** Anlage WA: Verträge mit Anteilseignern und ihnen nahestehenden Personen (Anstellung, Miete, Darlehen, Pension) */
  vertraege: readonly { art: string; datum: string; partner: string; verguetung: Cents }[];
}

/** Werte der Erklärung in vollen Euro */
export interface KstBerechnung {
  einkuenfte: number;
  verlustabzug: { sockel: number; quote: number };
  einkommen: number;
  zvE: number;
  kst: number;
  verlust: { anfang: number; laufend: number; ruecktrag: number; zwischensumme: number; ende: number } | null;
}

const euro = (cents: Cents) => Math.trunc(cents / 100);

export function kstBerechnung(input: Pick<KstXmlInput, "year" | "jahresergebnis" | "hinzurechnungen" | "verlustvortrag" | "verlustruecktrag">): KstBerechnung {
  const h = input.hinzurechnungen;
  const einkuenfte = euro(input.jahresergebnis) + euro(h.kst) + euro(h.soli) + euro(h.kapest) + euro(h.gewst) + euro(h.sonstige);
  const anfang = euro(input.verlustvortrag);
  const laufend = Math.max(0, -einkuenfte);
  const ruecktrag = Math.min(euro(input.verlustruecktrag), laufend, SOCKEL);
  const zwischensumme = anfang + laufend - ruecktrag;
  const positiv = Math.max(0, einkuenfte);
  const sockel = Math.min(zwischensumme, positiv, SOCKEL);
  const quote = Math.min(zwischensumme - sockel, Math.floor(((positiv - sockel) * QUOTE(input.year)) / 100));
  const einkommen = einkuenfte - sockel - quote;
  const zvE = einkommen;
  return {
    einkuenfte,
    verlustabzug: { sockel, quote },
    einkommen,
    zvE,
    kst: zvE > 0 ? Math.floor((zvE * 15) / 100) : 0,
    verlust: anfang > 0 || laufend > 0 ? { anfang, laufend, ruecktrag, zwischensumme, ende: zwischensumme - sockel - quote } : null,
  };
}

const n = (value: number): string | undefined => (value === 0 ? undefined : String(value));
const prozent = (anteil: number) => `${Math.trunc(anteil / 100)},${String(anteil % 100).padStart(2, "0")}00`;

function anteilseigner(input: KstXmlInput): XmlNode {
  return [
    "AE",
    [
      ...input.anteilseigner.map(
        (a): XmlNode => [
          "Einzel",
          [
            ["E8122111", a.geaendert ? "1" : "2"],
            ["E8122109", a.steuernummer13],
            ["E8122110", a.steuernummer13 ? undefined : a.idnr],
            ["E8122101", a.name],
            ["E8122102", a.strasse],
            ["E8122103", a.plzOrt],
            [
              "Besitzdauer",
              [
                ["E8122104", `${Math.trunc(a.beteiligung / 100)},${String(a.beteiligung % 100).padStart(2, "0")}`],
                ["E8122105", prozent(a.anteil)],
                [
                  "E8122106",
                  germanDate(
                    [a.seit, input.gruendung, `${input.year}-01-01`]
                      .filter((d): d is string => Boolean(d))
                      .sort()
                      .at(-1)!,
                  ),
                ],
                ["E8122107", germanDate(`${input.year}-12-31`)],
              ],
            ],
          ],
        ],
      ),
      ["Gesamt", [["E8122601", input.anteilseigner.some((a) => a.geaendert) ? "1" : "2"]]],
    ],
  ];
}

/**
 * Anlage Verluste, Zeilen 22 bis 27: Abzug bis 1 Mio. € (Zeile 25), vom Rest die Quote (Zeile 27). Die Zwischensummen der
 * Zeile 26 nur, wenn danach Einkünfte und Verlustvortrag übrig sind.
 */
function positiv(einkuenfte: number, vortrag: number, abzug: KstBerechnung["verlustabzug"]): XmlNode {
  const rest = vortrag - abzug.sockel > 0 && einkuenfte - abzug.sockel > 0;
  return [
    "Positiv",
    [
      [
        "Vorspalte",
        [
          ["E8008501", String(einkuenfte)],
          ["E8008503", String(einkuenfte)],
          ["E8008601", String(abzug.sockel)],
          ["E8008701", rest ? String(einkuenfte - abzug.sockel) : undefined],
        ],
      ],
      [
        "Hauptspalte",
        [
          ["E8008602", String(abzug.sockel)],
          ["E8008702", rest ? String(vortrag - abzug.sockel) : undefined],
          ["E8008801", rest ? String(abzug.quote) : undefined],
        ],
      ],
    ],
  ];
}

export function buildKstXml(input: KstXmlInput): string {
  const envelopeInput: Envelope = { ...input, datenArt: "KSt" };
  checkEnvelope(envelopeInput);
  if (!(KST_JAHRE as readonly number[]).includes(input.year)) {
    throw new ElsterEingabeError(`Die Körperschaftsteuererklärung sendet Haben für ${KST_JAHRE.join(", ")}, nicht für ${input.year}.`);
  }
  if (input.anteilseigner.length === 0) throw new ElsterEingabeError("Die Anteilseigner fehlen.");
  if (!input.sitz.trim()) throw new ElsterEingabeError("Der Ort des Sitzes fehlt.");
  const y = input.year;
  if (input.gruendung && !input.gruendung.startsWith(`${y}-`)) throw new ElsterEingabeError(`Das Gründungsdatum liegt nicht in ${y}.`);
  // Im Gründungsjahr beginnt das erste Wirtschaftsjahr mit der Gründung
  const von = germanDate(input.gruendung ?? `${y}-01-01`);
  const bis = germanDate(`${y}-12-31`);
  const b = kstBerechnung(input);
  const h = input.hinzurechnungen;
  const ort = input.sitz.trim().slice(0, 24);

  const kst1: XmlNode = [
    "KSt1",
    [
      // Zugleich Erklärung zur Feststellung des steuerlichen Einlagekontos (Anlage KSt 1 F)
      ["E8000016", "X"],
      ["Allgemein", [["E8000101", input.absender.name.slice(0, 103)]]],
      [
        "Steuerpflicht",
        [
          ["E8000501", ort],
          ["E8000601", ort],
          ["Rechtsform", [["E8001105", RECHTSFORM[input.rechtsform]]]],
        ],
      ],
      [
        "Wirtschaftsjahr",
        [
          ["E8002606", von],
          ["E8002607", bis],
          ["E8000703", input.gruendung ? "1" : undefined],
        ],
      ],
      // Kein Unternehmen nach § 8 Abs. 9 KStG (Spartentrennung bei Dauerverlusten)
      ["Weiteres", [["E8001007", "2"]]],
      anteilseigner(input),
    ],
  ];

  const gk: XmlNode = [
    "GK",
    [
      ["WJ", "WJ1"],
      [
        "Allgemein",
        [
          ["E8000201", von],
          ["E8000202", bis],
        ],
      ],
      ["Bilanz", [["E8002001", String(euro(input.jahresergebnis))]]],
      [
        "ABil",
        [
          [
            "Weiteres2",
            [
              ["E8100301", n(euro(h.kst))],
              ["E8100501", n(euro(h.soli))],
              ["E8100601", n(euro(h.kapest))],
              ["E8100702", n(euro(h.gewst))],
              ["E8101301", n(euro(h.sonstige))],
            ],
          ],
        ],
      ],
      ["Einkunfte", [["E8109901", String(b.einkuenfte)]]],
    ],
  ];

  const abzug = b.verlustabzug.sockel + b.verlustabzug.quote;
  const zve: XmlNode = [
    "ZVE",
    [
      [
        "SdE",
        [
          ["Gewerbe", [["Laufend", [["E8004904", String(b.einkuenfte)]]]]],
          ["SdE", [["E8005401", String(b.einkuenfte)]]],
        ],
      ],
      ["GdE", [["GdE", [["E8006901", String(b.einkuenfte)]]]]],
      [
        "ZVE",
        [
          ["Verlustabzug", [["E8007001", n(abzug)]]],
          ["ZVE", [["E8007501", String(b.zvE)]]],
        ],
      ],
      [
        "Steuerberechnung",
        [
          [
            "Regel",
            b.zvE > 0
              ? [
                  ["E8007504", String(b.zvE)],
                  ["E8007502", String(b.kst)],
                ]
              : [],
          ],
        ],
      ],
    ],
  ];

  const v = b.verlust;
  const verluste: XmlNode | null = v && [
    "Verluste",
    [
      ["Anfang", [["E8007801", String(v.anfang)]]],
      [
        "Negativ",
        [
          ["E8008001", v.laufend > 0 ? String(v.laufend) : undefined],
          ["E8008102", v.laufend > 0 ? String(v.ruecktrag) : undefined],
          // Zwischensumme der Zeile 21 nur für die Rechnung mit positiven Einkünften
          ["E8008401", b.einkuenfte > 0 ? String(v.zwischensumme) : undefined],
        ],
      ],
      b.einkuenfte > 0 ? positiv(b.einkuenfte, v.zwischensumme, b.verlustabzug) : null,
      ["Ende", [["E8009201", String(v.ende)]]],
    ],
  ];

  const wa: XmlNode = [
    "WA",
    [
      // Kein schädlicher Beteiligungserwerb nach § 8c KStG (Haben rechnet den Verlustuntergang nicht)
      ["Erwerb_P8c", [["E8122710", "2"]]],
      [
        "AE",
        [
          ["E8122801", input.vertraege.length > 0 ? "1" : "2"],
          ...input.vertraege.map(
            (v): XmlNode => [
              "Einzel",
              [
                ["E8123003", v.art.slice(0, 999)],
                ["E8123004", germanDate(v.datum)],
                ["E8123005", v.partner],
                ["E8123006", String(euro(v.verguetung))],
              ],
            ],
          ),
        ],
      ],
    ],
  ];

  const kst1f = kst1fNode(input);

  const e30 = [
    `<E30 xmlns="http://finkonsens.de/elster/elstererklaerung/kst/e30/v${y}" version="${y}">`,
    ...render(kst1, "  "),
    ...render(gk, "  "),
    ...render(zve, "  "),
    ...render(verluste, "  "),
    ...render(wa, "  "),
    ...render(kst1f, "  "),
    ...render(vorsatz("30", envelopeInput), "  "),
    "</E30>",
  ];
  return envelope(envelopeInput, e30);
}
