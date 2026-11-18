import type { XmlNode } from "./erklaerung.ts";
import type { EstAngaben, EstArbeitnehmer, EstLohnsteuerbescheinigung, EstVorsorgePerson } from "./est.ts";
import { euro } from "./est-werte.ts";

/* Anlage Vorsorgeaufwand der Einkommensteuererklärung (est.ts) */

type Arbeitnehmer = EstArbeitnehmer | undefined;

const lstb = (an: Arbeitnehmer, key: keyof Omit<EstLohnsteuerbescheinigung, "steuerklasse">) =>
  an ? an.bescheinigungen.reduce((s, b) => s + (b[key] ?? 0), 0) : 0;

function altersvorsorge(person: string, v: EstVorsorgePerson | undefined, an: Arbeitnehmer): XmlNode | null {
  const felder: XmlNode[] = [
    ["E2000401", euro(lstb(an, "rvArbeitnehmer"))],
    ["E2000601", euro(v?.rentenversicherung)],
    // Zeile 8: zertifizierte Basisrentenverträge (Rürup), teilt den Höchstbetrag mit Zeile 4 bis 6
    ["E2000701", euro(v?.basisrente)],
    ["E2000801", euro(lstb(an, "rvArbeitgeber"))],
  ];
  return felder.some((f) => f[1]) ? ["AVor", [["Person", person], ...felder]] : null;
}

function gesetzlicheKvPv(person: string, v: EstVorsorgePerson | undefined, an: Arbeitnehmer): XmlNode | null {
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
}

function privateKvPv(person: string, v: EstVorsorgePerson | undefined): XmlNode | null {
  // Zeile 27: über die Basisabsicherung hinaus, brutto; erstattete Beiträge stehen in Zeile 25 (E2003302)
  // und sind hier deshalb nicht noch einmal abzuziehen
  const wahl = euro(v?.pkvWahlleistungen);
  if (!euro(v?.pkv) && !euro(v?.ppv) && !euro(v?.pkvErstattung) && !wahl) return null;
  return [
    "Beitr_p_KV_PV_Inl",
    [
      ["Person", person],
      ["E2003104", euro(v?.pkv)],
      ["E2003202", euro(v?.ppv)],
      ["E2003302", euro(v?.pkvErstattung)],
      wahl ? ["WL_Zvers", [["E2003502", wahl]]] : null,
    ],
  ];
}

function arbeitgeberZuschuss(person: string, v: EstVorsorgePerson | undefined): XmlNode | null {
  return (
    // Zeilen 34 bis 36: steuerfreie Zuschüsse des Arbeitgebers laut Nr. 24 a, 24 b und 24 c
    euro(v?.agZuschussGkv) || euro(v?.agZuschussKv) || euro(v?.agZuschussPv)
      ? [
          "Stfr_AG_Zusch",
          [
            ["Person", person],
            ["E2003705", euro(v?.agZuschussGkv)],
            ["E2003807", euro(v?.agZuschussKv)],
            ["E2003907", euro(v?.agZuschussPv)],
          ],
        ]
      : null
  );
}

function arbeitslosenversicherung(person: string, an: Arbeitnehmer): XmlNode | null {
  const av = euro(lstb(an, "avArbeitnehmer"));
  return av
    ? [
        "Pers",
        [
          ["Person", person],
          ["E2004403", av],
        ],
      ]
    : null;
}

/** Anlage Vorsorgeaufwand; die Arbeitnehmerbeiträge kommen aus den Lohnsteuerbescheinigungen */
export function anlageVorsorge(x: EstAngaben, zusammen: boolean, personen: [string, Arbeitnehmer][]): XmlNode {
  const vorsorgePersonen: [string, EstVorsorgePerson | undefined][] = [
    ["PersonA", x.vorsorge.a],
    ["PersonB", zusammen ? x.vorsorge.b : undefined],
  ];
  const arbeitnehmerVon = (person: string) => personen.find(([p]) => p === person)?.[1];
  return [
    "VOR",
    [
      ...vorsorgePersonen.map(([person, v]) => altersvorsorge(person, v, arbeitnehmerVon(person))),
      ...vorsorgePersonen.map(([person, v]) => gesetzlicheKvPv(person, v, arbeitnehmerVon(person))),
      ...vorsorgePersonen.map(([person, v]) => privateKvPv(person, v)),
      ...vorsorgePersonen.map(([person, v]) => arbeitgeberZuschuss(person, v)),
      [
        "Weit_Sons_VorAW",
        [
          ...vorsorgePersonen.map(([person]) => arbeitslosenversicherung(person, arbeitnehmerVon(person))),
          ["A_B_LP", [["U_HP_Ris_Vers", [["Sum", [["E2001803", euro(x.vorsorge.sonstige)]]]]]]],
        ],
      ],
    ],
  ];
}
