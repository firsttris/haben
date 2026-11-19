import type { Cents } from "@haben/core";
import { germanDate } from "./bankverbindung.ts";
import { amount, type XmlNode } from "./erklaerung.ts";
import { elsterDecimal } from "./xml.ts";

/* Anlage AVEÜR zur Anlage EÜR (euer-erklaerung.ts) */

/** Gruppen der Anlage AVEÜR für bewegliche Wirtschaftsgüter */
export type AveuerGruppe = "kfz" | "buero" | "andere";

export interface AveuerAnlage {
  gruppe: AveuerGruppe | "sammelposten";
  bezeichnung: string;
  /** ISO-Datum */
  anschaffung: string;
  anschaffungskosten: Cents;
  /** Buchwert zu Beginn des Jahres; bei Anschaffung im Jahr die Anschaffungskosten */
  buchwertBeginn: Cents;
  afa: Cents;
  /** Restbuchwert beim Ausscheiden */
  abgang: Cents;
  buchwertEnde: Cents;
  /** Nur Kfz: Elektro- oder extern aufladbares Hybridfahrzeug (Pflichtangabe in der AVEÜR) */
  elektro?: boolean;
}

/** Feldkennungen je Gruppe: Einzelangaben und Summe (AVEÜR 2025) */
const AVEUER_GRUPPEN: Record<
  AveuerGruppe,
  {
    kontext: string;
    einz: { bez: string; datum: string; ak: string; bwBeginn: string; afa: string; abgang: string; bwEnde: string };
    sum: { ak: string; bwBeginn: string; afa: string; abgang: string; bwEnde: string };
  }
> = {
  kfz: {
    kontext: "KFZ",
    einz: { bez: "E6007311", datum: "E6007326", ak: "E6007312", bwBeginn: "E6007314", afa: "E6007320", abgang: "E6007322", bwEnde: "E6007324" },
    sum: { ak: "E6007313", bwBeginn: "E6007315", afa: "E6007321", abgang: "E6007323", bwEnde: "E6007325" },
  },
  buero: {
    kontext: "Buero",
    einz: { bez: "E6007331", datum: "E6007346", ak: "E6007332", bwBeginn: "E6007334", afa: "E6007340", abgang: "E6007342", bwEnde: "E6007344" },
    sum: { ak: "E6007333", bwBeginn: "E6007335", afa: "E6007341", abgang: "E6007343", bwEnde: "E6007345" },
  },
  andere: {
    kontext: "Andere",
    einz: { bez: "E6007351", datum: "E6007366", ak: "E6007352", bwBeginn: "E6007354", afa: "E6007360", abgang: "E6007362", bwEnde: "E6007364" },
    sum: { ak: "E6007353", bwBeginn: "E6007355", afa: "E6007361", abgang: "E6007363", bwEnde: "E6007365" },
  },
};

/** Sammelposten des Jahres und der vier Vorjahre: Kontext und Felder (AK, Buchwert Beginn, Auflösung, Buchwert Ende) */
const SAMMELPOSTEN_VORJAHRE = [
  { kontext: "Sammelposten_VZm1", ak: "E6017391", bwBeginn: "E6017392", afa: "E6017393", bwEnde: "E6017394" },
  { kontext: "Sammelposten_VZm2", ak: "E6017395", bwBeginn: "E6017396", afa: "E6017397", bwEnde: "E6017398" },
  { kontext: "Sammelposten_VZm3", ak: "E6017400", bwBeginn: "E6017401", afa: "E6017402", bwEnde: "E6017403" },
  { kontext: "Sammelposten_VZm4", ak: "E6017404", bwBeginn: "E6017405", afa: "E6017406", bwEnde: undefined },
] as const;

const sum = (list: AveuerAnlage[], key: "anschaffungskosten" | "buchwertBeginn" | "afa" | "abgang" | "buchwertEnde") => list.reduce((s, a) => s + a[key], 0);

/** Bewegliche Wirtschaftsgüter einer Gruppe, einzeln und als Summe; null ohne Anlagen der Gruppe */
function beweglicheGruppe(gruppe: "kfz" | "buero" | "andere", anlagen: AveuerAnlage[], year: number): XmlNode | null {
  const list = anlagen.filter((a) => a.gruppe === gruppe);
  if (list.length === 0) return null;
  const { kontext, einz, sum: s } = AVEUER_GRUPPEN[gruppe];
  return [
    kontext,
    [
      ...list.map(
        (a): XmlNode => [
          "Einz",
          [
            [einz.bez, a.bezeichnung.slice(0, 100)],
            [einz.datum, germanDate(a.anschaffung)],
            [einz.ak, elsterDecimal(a.anschaffungskosten)],
            [einz.bwBeginn, elsterDecimal(a.buchwertBeginn)],
            [einz.afa, amount(a.afa)],
            [einz.abgang, amount(a.abgang)],
            [einz.bwEnde, elsterDecimal(a.buchwertEnde)],
            // Antrieb des Kfz verlangt das Formular ab 2025
            gruppe === "kfz" && year >= 2025 ? ["E6007327", a.elektro ? "1" : "2"] : null,
          ],
        ],
      ),
      [
        "Sum",
        [
          [s.ak, elsterDecimal(sum(list, "anschaffungskosten"))],
          [s.bwBeginn, amount(sum(list, "buchwertBeginn"))],
          [s.afa, amount(sum(list, "afa"))],
          [s.abgang, amount(sum(list, "abgang"))],
          [s.bwEnde, elsterDecimal(sum(list, "buchwertEnde"))],
          gruppe === "kfz" && year >= 2025 ? ["E6007328", list.some((a) => a.elektro) ? "1" : "2"] : null,
        ],
      ],
    ],
  ] as XmlNode;
}

/** Sammelposten des Jahres einzeln und der vier Vorjahre als Summe */
function sammelposten(year: number, sammel: AveuerAnlage[]): XmlNode[] {
  const sammelJahr = sammel.filter((a) => Number(a.anschaffung.slice(0, 4)) === year);
  const sammelNodes: XmlNode[] = [];
  if (sammelJahr.length > 0) {
    sammelNodes.push([
      "Sammelposten_VZ",
      [
        ...sammelJahr.map(
          (a): XmlNode => [
            "Einz",
            [
              ["E6007381", a.bezeichnung.slice(0, 100)],
              ["E6007384", elsterDecimal(a.anschaffungskosten)],
              ["E6007385", amount(a.afa)],
              ["E6007386", elsterDecimal(a.buchwertEnde)],
            ],
          ],
        ),
        [
          "Sum",
          [
            ["E6007393", elsterDecimal(sum(sammelJahr, "anschaffungskosten"))],
            ["E6007394", amount(sum(sammelJahr, "afa"))],
            ["E6007395", elsterDecimal(sum(sammelJahr, "buchwertEnde"))],
          ],
        ],
      ],
    ]);
  }
  SAMMELPOSTEN_VORJAHRE.forEach((fields, i) => {
    const list = sammel.filter((a) => Number(a.anschaffung.slice(0, 4)) === year - i - 1);
    if (list.length === 0) return;
    sammelNodes.push([
      fields.kontext,
      [
        [fields.ak, elsterDecimal(sum(list, "anschaffungskosten"))],
        [fields.bwBeginn, elsterDecimal(sum(list, "buchwertBeginn"))],
        [fields.afa, amount(sum(list, "afa"))],
        fields.bwEnde ? [fields.bwEnde, elsterDecimal(sum(list, "buchwertEnde"))] : null,
      ],
    ]);
  });
  return sammelNodes;
}

/** Anlage AVEÜR; null ohne Anlagen */
export function aveuer(year: number, anlagen: AveuerAnlage[]): XmlNode | null {
  const beweglich = (["kfz", "buero", "andere"] as const).map((gruppe) => beweglicheGruppe(gruppe, anlagen, year));
  const afaBeweglich = sum(
    anlagen.filter((a) => a.gruppe !== "sammelposten"),
    "afa",
  );

  const sammel = anlagen.filter((a) => a.gruppe === "sammelposten");
  const sammelNodes = sammelposten(year, sammel);
  const sammelAfa = sum(sammel, "afa");

  if (beweglich.every((n) => n === null) && sammelNodes.length === 0) return null;
  return [
    "AVEUER",
    [
      ["Bewegliche_WG", [...beweglich, ["GesamtSum", [["E6007372", amount(afaBeweglich)]]]]],
      ...sammelNodes,
      sammelNodes.length > 0 ? ["GesamtSum", [["E6017399", amount(sammelAfa)]]] : null,
    ],
  ];
}
