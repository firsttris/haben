import { z } from "zod";

/**
 * Angaben zum Betrieb für die Verfahrensdokumentation: was nur der Betrieb wissen kann, kein Programm. Sie gehören zum
 * Unternehmen, nicht zu einer App; jede App speichert sie selbst (mit Änderungsprotokoll, Rz. 154) und nimmt die Felder,
 * die sie nicht schon aus eigenen Daten kennt.
 *
 * Quelle der Gliederung: GoBD, BMF-Schreiben vom 28.11.2019 (Rz. 100 bis 106 internes Kontrollsystem und
 * Datensicherung, Rz. 134 Schlüssel, Rz. 136 und 140 Papierbelege und Scannen, Rz. 151 bis 155 Verfahrensdokumentation),
 * dazu § 146 Abs. 2 bis 2b AO (Ort der Aufbewahrung: im Inland, in der EU oder mit Bewilligung in einem Drittstaat).
 */

export interface AngabeFeld {
  /** Beschriftung im Formular und Name im Dokument */
  label: string;
  /** Hilfetext unter dem Feld: was hineingehört */
  hinweis: string;
  /** Was im Dokument als Lücke steht, wenn die Angabe fehlt */
  luecke: string;
  max: number;
  mehrzeilig: boolean;
  /** Grundlage in den GoBD oder im Gesetz */
  quelle: string;
}

export const ANGABEN_FELDER = {
  firma: {
    label: "Name des Betriebs",
    hinweis: "Wie im Handelsregister oder auf den Rechnungen.",
    luecke: "Name des Betriebs",
    max: 300,
    mehrzeilig: false,
    quelle: "GoBD Rz. 153 (allgemeine Beschreibung)",
  },
  rechtsform: {
    label: "Rechtsform",
    hinweis: "Etwa Einzelunternehmen, GmbH oder UG.",
    luecke: "Rechtsform",
    max: 100,
    mehrzeilig: false,
    quelle: "GoBD Rz. 153 (allgemeine Beschreibung)",
  },
  anschrift: {
    label: "Anschrift",
    hinweis: "Straße, Postleitzahl und Ort des Betriebs.",
    luecke: "Anschrift des Betriebs",
    max: 1000,
    mehrzeilig: true,
    quelle: "GoBD Rz. 153 (allgemeine Beschreibung)",
  },
  verantwortlich: {
    label: "Verantwortlich",
    hinweis: "Wer für Buchführung und Aufbewahrung verantwortlich ist, wer vertritt und wer mitarbeitet.",
    luecke: "verantwortliche Person (und wer vertritt)",
    max: 1000,
    mehrzeilig: true,
    quelle: "GoBD Rz. 100 und 102 (internes Kontrollsystem)",
  },
  datensicherung: {
    label: "Datensicherung",
    hinweis: "Wie, wohin und wie oft gesichert wird, wie lange Sicherungen bleiben und wer die Wiederherstellung prüft.",
    luecke: "Beschreibung der Datensicherung (wie, wohin, wie oft, wer die Wiederherstellung prüft)",
    max: 5000,
    mehrzeilig: true,
    quelle: "GoBD Rz. 103 bis 106 (Datensicherheit)",
  },
  aufbewahrungsort: {
    label: "Ort der Aufbewahrung",
    hinweis: "Wo Server, Daten und Sicherungen stehen (Land, Rechenzentrum oder Büro), bei Papier auch dessen Ablage.",
    luecke: "Ort der Aufbewahrung von Daten und Sicherungen",
    max: 2000,
    mehrzeilig: true,
    quelle: "§ 146 Abs. 2 bis 2b AO",
  },
  papierbelege: {
    label: "Papierbelege und Scannen",
    hinweis:
      "Wer Papierbelege erfasst und wann, wer Lesbarkeit und Vollständigkeit prüft und was danach mit dem Papier geschieht; oder dass nicht gescannt wird.",
    luecke: "Umgang mit Papierbelegen (wer scannt, wer prüft, was mit dem Papier geschieht) oder der Hinweis, dass nicht gescannt wird",
    max: 5000,
    mehrzeilig: true,
    quelle: "GoBD Rz. 136 bis 141 (bildliche Erfassung)",
  },
  serverbetrieb: {
    label: "Betrieb des Servers",
    hinweis: "Wer den Server betreibt (selbst, Dienstleister, Hoster), wer Updates einspielt und wie Änderungen am System freigegeben werden.",
    luecke: "wer den Server betreibt und Updates einspielt",
    max: 5000,
    mehrzeilig: true,
    quelle: "GoBD Rz. 101 und 153 (Betriebsdokumentation)",
  },
  schluesselablage: {
    label: "Ablage von Schlüsseln und Passwörtern",
    hinweis: "Wo Schlüssel, Passwörter und Zertifikate verwahrt werden und wer im Notfall herankommt; nur der Ort, nie die Geheimnisse selbst.",
    luecke: "wo Schlüssel, Passwörter und Zertifikate verwahrt werden (nur der Ort)",
    max: 2000,
    mehrzeilig: true,
    quelle: "GoBD Rz. 103 und 134",
  },
  ergaenzungen: {
    label: "Ergänzungen",
    hinweis: "Was sonst zum Verständnis nötig ist, etwa weitere Programme oder Abläufe. Absätze mit einer Leerzeile trennen.",
    luecke: "",
    max: 20000,
    mehrzeilig: true,
    quelle: "GoBD Rz. 151",
  },
} as const satisfies Record<string, AngabeFeld>;

export type AngabeName = keyof typeof ANGABEN_FELDER;

export const ANGABE_NAMEN = Object.keys(ANGABEN_FELDER) as AngabeName[];

/** Jedes Feld außer den Ergänzungen fehlt, wenn es leer ist */
export const PFLICHTANGABEN: readonly AngabeName[] = ANGABE_NAMEN.filter((name) => name !== "ergaenzungen");

const text = (name: AngabeName) =>
  z.string().trim().max(ANGABEN_FELDER[name].max, `${ANGABEN_FELDER[name].label}: höchstens ${ANGABEN_FELDER[name].max} Zeichen`);

/** Alle Angaben als Zod-Schema; eine App nimmt mit `.pick()` die, die sie speichert */
export const angabenZumBetrieb = z.object(Object.fromEntries(ANGABE_NAMEN.map((name) => [name, text(name)])) as { [K in AngabeName]: z.ZodString });

export type AngabenZumBetrieb = z.infer<typeof angabenZumBetrieb>;

export const LEERE_ANGABEN: AngabenZumBetrieb = Object.fromEntries(ANGABE_NAMEN.map((name) => [name, ""])) as AngabenZumBetrieb;

/** Die Lücken zu den gewünschten Feldern, in deren Reihenfolge; ein Feld aus Leerzeichen gilt als leer */
export function fehlendeAngaben(angaben: Partial<AngabenZumBetrieb>, felder: readonly AngabeName[] = PFLICHTANGABEN): string[] {
  return felder.filter((name) => !angaben[name]?.trim() && ANGABEN_FELDER[name].luecke).map((name) => ANGABEN_FELDER[name].luecke);
}

/**
 * Die Angaben zu `felder` als Absätze „Beschriftung: Text“ und die Lücken der leeren, für einen Abschnitt des Dokuments.
 * Ergänzungen werden ohne Beschriftung an Leerzeilen in Absätze geteilt.
 */
export function angabenAbsaetze(angaben: Partial<AngabenZumBetrieb>, felder: readonly AngabeName[]): { absaetze: string[]; luecken: string[] } {
  const absaetze = felder.flatMap((name) => {
    const wert = angaben[name]?.trim();
    if (!wert) return [];
    return name === "ergaenzungen" ? wert.split(/\n\s*\n/) : [`${ANGABEN_FELDER[name].label}: ${wert}`];
  });
  return { absaetze, luecken: fehlendeAngaben(angaben, felder) };
}
