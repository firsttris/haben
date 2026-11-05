import {
  finanzamtsnummer,
  lstaLabel,
  lstaZeitraumCode,
  summeJahresteile,
  type Cents,
  type Jahresteile,
  type LstaKennzahlen,
  type LstaZeitraum,
} from "@haben/core";
import { checkSteuernummer13, element, elsterDecimal, ElsterEingabeError, elsterXml, TESTMERKER, type Datenlieferant } from "./xml.ts";

/*
 * Lohnsteuer-Anmeldung (Verfahren ElsterAnmeldung, Datenart LStA). Elementnamen und Reihenfolge aus den Schemas
 * LStA-2026.xsd und LStA-2027.xsd, Regeln aus den Jahresdokumentationen LStA_2026 und LStA_2027 (ERiC 45.1.5.0,
 * Dokumentation/Datenarten/ElsterAnmeldung/LStA). Testmerker 700000004 wie im Beispiel lsta_2026_ok.xml.
 *
 * - 2026: alle Kennzahlen in /Anmeldungssteuern/Steuerfall/Lohnsteueranmeldung, Jahr und Zeitraum dort.
 * - 2027: neuer Aufbau; Steuernummer direkt unter Anmeldungssteuern, Jahr und Zeitraum in Allgemein, Kz 09, 10 und 86
 *   in Lohnsteueranmeldung, die Beträge in LStSoliKi; Kz 09 nur noch die fünfstellige Hersteller-ID.
 *
 * Pflicht laut Regeln: Kz 42 (oder 41/44), Kz 48, Kz 49, Kz 83 und Kz 86, auch mit 0; zu Kz 42, 49 und jeder Kirchensteuer
 * ungleich 0 die Aufteilung nach Vorjahr, laufendem Jahr und Folgejahr (Regeln LStA_Kz42_SummeOhneEinzelwert usw.).
 * Kirchensteuer mit 0 lässt Haben weg (Nullwert-Hinweise LStA_Kz61_Nullwertangabe_Hinweis usw.).
 */

/** Jahre mit Schema; LStA_2027 kennt ERiC erst ab 45 (Plugin libcheckLStA_2027) */
export const LSTA_JAHRE = [2026, 2027] as const;
export const LSTA_JAHRE_TEXT = new Intl.ListFormat("de", { type: "conjunction" }).format(LSTA_JAHRE.map(String));

export interface LStAInput {
  zeitraum: LstaZeitraum;
  /** 13-stellige Steuernummer im ELSTER-Format (Betriebsstättenfinanzamt) */
  steuernummer13: string;
  kennzahlen: LstaKennzahlen;
  /** Berichtigte Anmeldung (Kz 10) */
  berichtigt: boolean;
  datenlieferant: Datenlieferant;
  herstellerId: string;
  produktVersion: string;
  test: boolean;
  erstellungsdatum?: Date;
}

/** Betrag wie im Schema: Punkt, immer zwei Nachkommastellen ("1289.33", "0.00") */
const betrag = (cents: Cents) => elsterDecimal(cents).replace(",", ".");

const datum = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

/** Felder _Vorjahr, _lfdJahr, _Folgejahr (nur ungleich 0) und die Kennzahl selbst; ganz weg, wenn optional und 0 */
function aufgeteilt(kz: string, teile: Jahresteile, pflicht: boolean): string[] {
  const summe = summeJahresteile(teile);
  if (summe === 0 && !pflicht && teile.vorjahr === 0 && teile.lfdJahr === 0 && teile.folgejahr === 0) return [];
  return [
    ...(teile.vorjahr !== 0 ? [element(`${kz}_Vorjahr`, betrag(teile.vorjahr))] : []),
    ...(teile.lfdJahr !== 0 ? [element(`${kz}_lfdJahr`, betrag(teile.lfdJahr))] : []),
    ...(teile.folgejahr !== 0 ? [element(`${kz}_Folgejahr`, betrag(teile.folgejahr))] : []),
    element(kz, betrag(summe)),
  ];
}

function pruefen(input: Omit<LStAInput, "produktVersion" | "test">): void {
  checkSteuernummer13(input.steuernummer13);
  const { year } = input.zeitraum;
  if (!(LSTA_JAHRE as readonly number[]).includes(year)) {
    throw new ElsterEingabeError(`Die Lohnsteuer-Anmeldung sendet Haben für ${LSTA_JAHRE_TEXT}, nicht für ${year}.`);
  }
  const k = input.kennzahlen;
  const kirche = summeJahresteile(k.kirche.kz61) + summeJahresteile(k.kirche.kz62) + summeJahresteile(k.kirche.kz63);
  // Summenregeln LStA_Kz48_Summenplausi und LStA_Kz83_Summenplausi
  if (k.kz48 !== summeJahresteile(k.kz42) || k.kz83 !== k.kz48 + summeJahresteile(k.kz49) + kirche) {
    throw new ElsterEingabeError("Die Summen der Lohnsteuer-Anmeldung (Kz 48, Kz 83) passen nicht zu den Einzelbeträgen.");
  }
  if (!Number.isInteger(k.kz86) || k.kz86 < 0 || k.kz86 > 9_999_999) throw new ElsterEingabeError(`Zahl der Arbeitnehmer ungültig: ${k.kz86}`);
  if (year >= 2027 && !/^\d{5}$/.test(input.herstellerId)) throw new ElsterEingabeError("Kz 09 ist ab 2027 nur die fünfstellige Hersteller-ID.");
}

/** Kz 48, Soli und Kirchensteuer in der Reihenfolge des Schemas (in beiden Jahren 48, 49, 61, 62, 63, 83) */
function betraege(k: LstaKennzahlen): { lohnsteuer: string[]; rest: string[] } {
  return {
    lohnsteuer: aufgeteilt("Kz42", k.kz42, true),
    rest: [
      element("Kz48", betrag(k.kz48)),
      ...aufgeteilt("Kz49", k.kz49, true),
      ...aufgeteilt("Kz61", k.kirche.kz61, false),
      ...aufgeteilt("Kz62", k.kirche.kz62, false),
      ...aufgeteilt("Kz63", k.kirche.kz63, false),
      element("Kz83", betrag(k.kz83)),
    ],
  };
}

function datenlieferant(dl: Datenlieferant): string[] {
  // Längen laut Schema (Name 45, Strasse 30, Ort 30)
  return [
    `<DatenLieferant>`,
    element("Name", dl.name.slice(0, 45)),
    element("Strasse", dl.strasse.slice(0, 30)),
    element("PLZ", dl.plz),
    element("Ort", dl.ort.slice(0, 30)),
    `</DatenLieferant>`,
  ];
}

/** Inhalt von /Elster/DatenTeil/Nutzdatenblock/Nutzdaten: das Element <Anmeldungssteuern>, zeilenweise */
export function lstaNutzdaten(input: Omit<LStAInput, "produktVersion" | "test">): string[] {
  pruefen(input);
  const { year } = input.zeitraum;
  const k = input.kennzahlen;
  const { lohnsteuer, rest } = betraege(k);
  const kopf = [
    `<Anmeldungssteuern xmlns="http://finkonsens.de/elster/elsteranmeldung/lsta/v${year}" version="${year}">`,
    element("Erstellungsdatum", datum(input.erstellungsdatum ?? new Date())),
  ];
  if (year === 2026) {
    return [
      ...kopf,
      ...datenlieferant(input.datenlieferant),
      `<Steuerfall>`,
      `<Lohnsteueranmeldung>`,
      element("Jahr", String(year)),
      element("Zeitraum", lstaZeitraumCode(input.zeitraum)),
      element("Steuernummer", input.steuernummer13),
      element("Kz09", input.herstellerId),
      ...(input.berichtigt ? [element("Kz10", "1")] : []),
      ...lohnsteuer,
      ...rest,
      element("Kz86", String(k.kz86)),
      `</Lohnsteueranmeldung>`,
      `</Steuerfall>`,
      `</Anmeldungssteuern>`,
    ];
  }
  return [
    ...kopf,
    element("Steuernummer", input.steuernummer13),
    `<Allgemein>`,
    element("Jahr", String(year)),
    element("Zeitraum", lstaZeitraumCode(input.zeitraum)),
    `</Allgemein>`,
    ...datenlieferant(input.datenlieferant),
    `<Lohnsteueranmeldung>`,
    element("Kz09", input.herstellerId),
    ...(input.berichtigt ? [element("Kz10", "1")] : []),
    element("Kz86", String(k.kz86)),
    `</Lohnsteueranmeldung>`,
    `<LStSoliKi>`,
    ...lohnsteuer,
    ...rest,
    `</LStSoliKi>`,
    `</Anmeldungssteuern>`,
  ];
}

export function buildLStAXml(input: LStAInput): string {
  const nutzdaten = lstaNutzdaten(input);
  const dl = input.datenlieferant;
  return elsterXml(
    {
      verfahren: "ElsterAnmeldung",
      datenArt: "LStA",
      testmerker: input.test ? TESTMERKER : undefined,
      herstellerId: input.herstellerId,
      datenlieferant: `${dl.name}, ${dl.strasse}, ${dl.plz} ${dl.ort}`,
    },
    [{ ticket: "1", empfaenger: { id: "F", wert: finanzamtsnummer(input.steuernummer13) }, produktVersion: input.produktVersion, nutzdaten }],
  );
}

// ------------------------------------------------------------------ Ausfüllliste für Mein ELSTER

export interface LstaAusfuellFeld {
  /** Kennung wie im XML, z. B. "Kz42_lfdJahr" */
  kennung: string;
  bezeichnung: string;
  /** Wie man es in Mein ELSTER eintippt: Dezimalkomma, ohne Tausenderpunkt */
  eingabe: string;
}

/** Bezeichnungen laut Jahresdokumentation LStA_2026, Blatt „Anmeldungssteuern - Texte“ */
const BEZEICHNUNG: Record<string, string> = {
  Kz10: "Berichtigte Anmeldung",
  Kz42: "Summe der einzubehaltenden Lohnsteuer",
  Kz48: "Verbleiben",
  Kz49: "Solidaritätszuschlag",
  Kz61: "Evangelische Kirchensteuer",
  Kz62: "Römisch-Katholische Kirchensteuer",
  Kz63: "Alt-Katholische Kirchensteuer",
  Kz83: "Gesamtbetrag",
  Kz86: "Zahl der Arbeitnehmer",
};
const TEIL: Record<string, string> = { Vorjahr: "Vorjahr", lfdJahr: "laufendes Jahr", Folgejahr: "Folgejahr" };

/**
 * Die Werte der Anmeldung in der Reihenfolge des Formulars, für die Abgabe in Mein ELSTER ohne eigene Hersteller-ID.
 * Gelesen aus denselben Nutzdaten, die Haben über ERiC senden würde; Kz 09 gehört nicht ins Formular.
 */
export function lstaAusfuellliste(input: Pick<LStAInput, "zeitraum" | "steuernummer13" | "kennzahlen" | "berichtigt" | "datenlieferant">): {
  zeitraum: string;
  felder: LstaAusfuellFeld[];
} {
  const xml = lstaNutzdaten({ ...input, herstellerId: "00000" }).join("\n");
  const felder: LstaAusfuellFeld[] = [];
  for (const [, kennung, wert] of xml.matchAll(/<(Kz\d{2}(?:_\w+)?)>([^<]*)<\/\1>/g)) {
    if (kennung === "Kz09") continue;
    const [kz, teil] = kennung!.split("_");
    const name = BEZEICHNUNG[kz!] ?? kz!;
    felder.push({
      kennung: kennung!,
      bezeichnung: `${name}${teil ? `: ${TEIL[teil] ?? teil}` : ""} (Kz ${kz!.slice(2)})`,
      eingabe: wert!.replace(".", ","),
    });
  }
  return { zeitraum: lstaLabel(input.zeitraum), felder };
}
