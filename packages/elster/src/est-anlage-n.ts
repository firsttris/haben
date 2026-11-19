import type { Cents } from "@haben/core";
import type { XmlNode } from "./erklaerung.ts";
import type { EstArbeitnehmer, EstLohnsteuerbescheinigung } from "./est.ts";
import { euro, mitCent } from "./est-werte.ts";
import { elsterDecimal, ElsterEingabeError } from "./xml.ts";

/* Anlage N der Einkommensteuererklärung (est.ts) */

/** Volle Kilometer bzw. Tage, sonst entfällt das Feld */
const ganz = (n: number | undefined) => (n && n > 0 ? String(Math.floor(n)) : undefined);

/** Ein Einzelposten mit Bezeichnung und Betrag und seine Summe */
/** Einzelposten mit Summe; zwischen: weitere Angaben, die das Schema zwischen Einz und Sum erwartet */
const posten = (name: string, felder: [string, string, string], text: string, cents: Cents | undefined, zwischen: XmlNode[] = []): XmlNode | null => {
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
      ...zwischen,
      ["Sum", [[felder[2], value]]],
    ],
  ];
};

/** Anlage N einer Person: Lohnsteuerbescheinigungen (Steuerklasse 1–5 bzw. 6) und Werbungskosten */
/**
 * Ab 2026 hat die Anlage N eine eigene Zeile für Gewerkschaftsbeiträge (Gewerksch_Beit, Schema E10-2026 im ERiC-Paket
 * 45.1.5.0), weil sie neben dem Arbeitnehmer-Pauschbetrag abziehbar sind (§ 9a Satz 3 EStG); bis 2025 stehen sie mit den
 * Berufsverbänden in einer Zeile.
 */
function berufsverbaende(w: EstArbeitnehmer["werbungskosten"], year: number): (XmlNode | null)[] {
  if (year < 2026) {
    return [posten("Berufsverb", ["E0204001", "E0204003", "E0204002"], "Berufsverbände und Gewerkschaft", (w.berufsverbaende ?? 0) + (w.gewerkschaft ?? 0))];
  }
  return [
    posten("Berufsverb", ["E0204001", "E0204003", "E0204002"], "Berufsverbände", w.berufsverbaende),
    posten("Gewerksch_Beit", ["E0205509", "E0205510", "E0205519"], "Gewerkschaft", w.gewerkschaft),
  ];
}

/**
 * Fortbildungskosten. Ab 2026 verlangt die Anlage N daneben die steuerfreien Erstattungen (E0206305, „ggf. 0“) und
 * zieht sie in der Summe ab (Schema E10-2026 und Plausibilitätsprüfung im ERiC-Paket 45.1.5.0). Erstattungen erfasst
 * Haben nicht; die Kosten sind schon um sie gemindert.
 */
function fortbildung(cents: Cents | undefined, year: number): XmlNode | null {
  return posten("Fortb", ["E0204804", "E0204808", "E0204812"], "Fortbildung", cents, year >= 2026 ? [["Stfrei_Erst", [["E0206305", "0"]]]] : []);
}

const summeAus = (list: EstLohnsteuerbescheinigung[], key: keyof Omit<EstLohnsteuerbescheinigung, "steuerklasse">) =>
  list.reduce((s, b) => s + (b[key] ?? 0), 0);

/** Lohnsteuerbescheinigungen einer Gruppe, einzeln und als Summe */
const lohnGruppe = (list: EstLohnsteuerbescheinigung[], einz: string, summe: string, ids: { einz: string[]; sum: string[] }, mitKlasse: boolean): XmlNode[] => {
  if (list.length === 0) return [];
  const keys = ["brutto", "lohnsteuer", "soli", "kirchensteuer", "kirchensteuerEhegatte"] as const;
  const ausdruecklich = (key: (typeof keys)[number]) => key === "lohnsteuer" || key === "kirchensteuer";
  return [
    // Lohn- und Kirchensteuer verlangt ELSTER ausdrücklich, ggf. mit 0
    ...list.map((b): XmlNode => [einz, keys.map((key, i): XmlNode => [ids.einz[i]!, ausdruecklich(key) ? elsterDecimal(b[key] ?? 0) : mitCent(b[key])])]),
    [
      summe,
      [
        mitKlasse ? ["E0200002", String(list[0]!.steuerklasse)] : null,
        ...keys.map(
          (key, i): XmlNode => [
            ids.sum[i]!,
            i === 0 ? euro(summeAus(list, key)) : ausdruecklich(key) ? elsterDecimal(summeAus(list, key)) : mitCent(summeAus(list, key)),
          ],
        ),
      ],
    ],
  ];
};

/** Werbungskosten der Anlage N */
function werbungskosten(w: EstArbeitnehmer["werbungskosten"], year: number): XmlNode {
  const wege = w.wege && w.wege.tage > 0 && w.wege.km > 0 ? w.wege : undefined;
  if (wege && !wege.adresse.trim()) throw new ElsterEingabeError("Anlage N: Die Anschrift der Tätigkeitsstätte fehlt.");

  return [
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
      ...berufsverbaende(w, year),
      posten("Arbeitsmittel", ["E0204401", "E0204402", "E0204403"], "Arbeitsmittel", w.arbeitsmittel),
      // Häusliches Arbeitszimmer: Einzelaufwendung (E0204503 Bezeichnung, E0204505 Betrag),
      // Summe in E0204504. ERiC verlangt beides zusammen, sonst meldet es die Summe ohne Einzelposten.
      posten("Arb_Zim", ["E0204503", "E0204505", "E0204504"], "Arbeitszimmer", w.arbeitszimmer),
      ganz(w.homeofficeTage) ? ["Homeoffice", [[w.keinAndererArbeitsplatz ? "E0206206" : "E0204507", ganz(w.homeofficeTage)]]] : null,
      fortbildung(w.fortbildung, year),
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
}

export function anlageN(person: string, an: EstArbeitnehmer, year: number): XmlNode {
  for (const b of an.bescheinigungen) {
    if (!(b.brutto > 0)) throw new ElsterEingabeError("Anlage N: Der Bruttoarbeitslohn fehlt.");
    if (![1, 2, 3, 4, 5, 6].includes(b.steuerklasse)) throw new ElsterEingabeError("Anlage N: Die Steuerklasse fehlt.");
  }
  const klasse1bis5 = an.bescheinigungen.filter((b) => b.steuerklasse !== 6);
  const klasse6 = an.bescheinigungen.filter((b) => b.steuerklasse === 6);
  return [
    "N",
    [
      ["Person", person],
      [
        "ArbL",
        [
          ...lohnGruppe(
            klasse1bis5,
            "LStB_1_5_Einz",
            "LStB_1_5_Sum",
            { einz: ["E0200204", "E0200304", "E0200404", "E0200504", "E0200604"], sum: ["E0200201", "E0200301", "E0200401", "E0200501", "E0200601"] },
            true,
          ),
          ...lohnGruppe(
            klasse6,
            "LStB_6_Einz",
            "LStB_6_Sum",
            { einz: ["E0200202", "E0200302", "E0200402", "E0200502", "E0200602"], sum: ["E0200203", "E0200303", "E0200403", "E0200503", "E0200603"] },
            false,
          ),
        ],
      ],
      werbungskosten(an.werbungskosten, year),
    ],
  ];
}
