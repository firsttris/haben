import { z } from "zod";
import { normalizeUstId, ustIdAufbauProblem, ustIdProblem } from "./zm.ts";

/*
 * Bestätigung ausländischer USt-IdNrn. beim BZSt (§ 18e Nr. 1 UStG) über die eVatR-REST-API (#1385).
 *
 * Quelle: OpenAPI-Beschreibung v1.2.3 unter https://api.evatr.vies.bzst.de/api-docs und die Statusmeldungen unter
 * GET /app/v1/info/statusmeldungen, gelesen am 2026-11-18. Die Abfrage ist einfach mit anfragendeUstid und angefragteUstid
 * und qualifiziert, sobald auch firmenname und ort besetzt sind (strasse und plz optional). Die FAQ des BZSt verlangen erst
 * eine einfache, dann die qualifizierte Abfrage. Nachweis ist bei Abfragen über die Schnittstelle der vom BZSt empfangene
 * Datensatz (UStAE 18e.1 Abs. 2 Sätze 3 bis 5, FAQ des BZSt); Haben speichert ihn unverändert. Rückwirkend bestätigt das BZSt nichts.
 */

export const EVATR_URL = "https://api.evatr.vies.bzst.de/app/v1/abfrage";

export type EvatrArt = "einfach" | "qualifiziert";

export interface EvatrAnfrage {
  anfragendeUstid: string;
  angefragteUstid: string;
  firmenname?: string;
  strasse?: string;
  plz?: string;
  ort?: string;
}

/** Was eine Abfrage vom Kontakt braucht */
export interface EvatrKontakt {
  ustId: string;
  name: string;
  strasse: string;
  plz: string;
  ort: string;
}

/** Vergleich einer Angabe der qualifizierten Abfrage */
export const EVATR_VERGLEICH = {
  A: "Stimmt",
  B: "Stimmt nicht",
  C: "Nicht angefragt",
  D: "Nicht mitgeteilt",
} as const;

export type EvatrVergleich = keyof typeof EVATR_VERGLEICH;

const vergleich = z.enum(["A", "B", "C", "D"]).nullish();

/** Antwort der Abfrage; auch Fehler kommen in dieser Form (id, anfrageZeitpunkt, status). Weitere Felder bleiben im Rohtext */
export const evatrAntwortSchema = z.object({
  id: z.string().max(100).nullish(),
  anfrageZeitpunkt: z.string().max(60),
  status: z.string().regex(/^evatr-\d{4}$/),
  gueltigAb: z.string().max(40).nullish(),
  gueltigBis: z.string().max(40).nullish(),
  ergFirmenname: vergleich,
  ergStrasse: vergleich,
  ergPlz: vergleich,
  ergOrt: vergleich,
});

export type EvatrAntwort = z.infer<typeof evatrAntwortSchema>;

/**
 * Ob Haben die Nummer anfragt: Kennzeichen eines anderen Mitgliedstaats und Aufbau wie in der Zusammenfassenden Meldung
 * (#1413). Deutsche Nummern bestätigt das BZSt nicht (evatr-0006), Nordirland (XI) schon.
 */
export function evatrPruefbar(ustId: string): boolean {
  const nummer = normalizeUstId(ustId);
  return nummer !== "" && (ustIdProblem(nummer, "L") ?? ustIdAufbauProblem(nummer)) === null;
}

/** Qualifiziert geht nur mit Name und Ort */
export function evatrQualifizierbar(kontakt: EvatrKontakt): boolean {
  return kontakt.name.trim() !== "" && kontakt.ort.trim() !== "";
}

/** Rumpf der Abfrage; leere Straße und PLZ fehlen, statt leer zu stehen */
export function evatrAnfrage(eigeneUstId: string, kontakt: EvatrKontakt, art: EvatrArt): EvatrAnfrage {
  const basis = { anfragendeUstid: normalizeUstId(eigeneUstId), angefragteUstid: normalizeUstId(kontakt.ustId) };
  if (art === "einfach") return basis;
  const strasse = kontakt.strasse.trim();
  const plz = kontakt.plz.trim();
  return { ...basis, firmenname: kontakt.name.trim(), ...(strasse && { strasse }), ...(plz && { plz }), ort: kontakt.ort.trim() };
}

/** anfrageZeitpunkt wie „2026-11-18T14:34:36.318854732+01:00“: Nanosekunden, die Date nicht versteht */
export function evatrZeitpunkt(text: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (!match) return null;
  const date = new Date(`${match[1]}.${(match[2] ?? "").padEnd(3, "0").slice(0, 3)}${match[3]}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Fehler der angefragten Nummer selbst (Syntax, Länderkennzeichen); andere Nummern betrifft das nicht, anders als ein Ausfall */
const evatrNummerFehler = (status: string) => status === "evatr-0005" || status === "evatr-0012" || status === "evatr-2003";

/**
 * Antworten, die etwas über die angefragte Nummer sagen; nur sie zählen als Nachweis. Dazu gehören die Fehler der Nummer
 * selbst: Eine falsche Prüfziffer beantwortet das BZSt mit evatr-0005, mit id und Zeitpunkt (Testabfrage 2026-11-20,
 * #1578). Gespeichert gilt sie wie eine ungültige Antwort, statt bei jeder Gelegenheit neu gefragt zu werden.
 */
const NACHWEIS = new Set(["evatr-0000", "evatr-2001", "evatr-2002", "evatr-2006", "evatr-2008"]);

export const evatrNachweis = (status: string) => NACHWEIS.has(status) || evatrNummerFehler(status);

/** Gültig zum Anfragezeitpunkt; evatr-2008 heißt gültig mit einer Besonderheit der qualifizierten Abfrage */
export const evatrGueltig = (status: string) => status === "evatr-0000" || status === "evatr-2008";

/**
 * So lange gilt eine gültige Antwort vor dem Festschreiben und in der ZM als aktuell; danach fragt Haben neu. Eine feste
 * Frist nennt weder § 18e UStG noch UStAE 18e.1; bestätigt wird der Stand am Tag der Anfrage, rückwirkend nichts (FAQ des BZSt)
 */
export const EVATR_FRIST_TAGE = 30;

/** Ob eine Antwort höchstens EVATR_FRIST_TAGE alt ist */
export function evatrFrisch(anfrageZeitpunkt: Date | string, jetzt: Date): boolean {
  return jetzt.getTime() - new Date(anfrageZeitpunkt).getTime() <= EVATR_FRIST_TAGE * 86_400_000;
}

/** Ob die Antwort gültig und höchstens EVATR_FRIST_TAGE alt ist; dann fragen Festschreiben und ZM nicht neu */
export function evatrFrischGueltig(antwort: { status: string; anfrageZeitpunkt: Date | string } | undefined, jetzt: Date): boolean {
  return Boolean(antwort && evatrGueltig(antwort.status) && evatrFrisch(antwort.anfrageZeitpunkt, jetzt));
}

/**
 * Für Reverse Charge zählt nur eine frische qualifizierte Bestätigung, bei der Name und Ort nicht „stimmt nicht“ (B) sind:
 * UStAE 3a.2 Abs. 9 Satz 5 setzt die Bestätigung von Gültigkeit, Name und Anschrift voraus. Straße und PLZ sind optional.
 */
export function evatrQualifiziertBestaetigt(
  antwort: { art: EvatrArt; status: string; anfrageZeitpunkt: Date | string; ergFirmenname: string | null; ergOrt: string | null } | undefined,
  jetzt: Date,
): boolean {
  return Boolean(antwort?.art === "qualifiziert" && evatrFrischGueltig(antwort, jetzt) && antwort.ergFirmenname !== "B" && antwort.ergOrt !== "B");
}

/** Höchstzahl qualifizierter Abfragen „für diese Session“ erreicht; das BZSt rät, mit einer einfachen neu zu beginnen */
export const EVATR_LIMIT = "evatr-0008";

/** Wort für den Status einer gespeicherten Antwort; was es genauer macht, steht in evatrMeldung */
export function evatrWort(status: string): string {
  switch (status) {
    case "evatr-0000":
    case "evatr-2008":
      return "Gültig";
    case "evatr-2001":
      return "Nicht vergeben";
    case "evatr-2002":
      return "Noch nicht gültig";
    case "evatr-2006":
      return "Nicht mehr gültig";
    case "evatr-0005":
    case "evatr-0012":
    case "evatr-2003":
      return "Syntaktisch falsch";
    default:
      return status;
  }
}

/** Meldung zum Status für Hinweise und das Jahresarchiv, nach den Statusmeldungen des BZSt */
export function evatrMeldung(antwort: { status: string; gueltigAb?: string | null; gueltigBis?: string | null }): string {
  switch (antwort.status) {
    case "evatr-0000":
      return "Gültig";
    case "evatr-2008":
      return "Gültig; zur qualifizierten Abfrage meldet das BZSt eine Besonderheit, Rückfragen dort";
    case "evatr-2001":
      return "Nicht vergeben";
    case "evatr-2002":
      return `Noch nicht gültig, erst ab ${antwort.gueltigAb ?? "einem späteren Tag"}`;
    case "evatr-2006":
      return `Nicht mehr gültig; gültig war sie ${antwort.gueltigAb ? `vom ${antwort.gueltigAb} ` : ""}bis ${antwort.gueltigBis ?? "zu einem früheren Tag"}`;
    case EVATR_LIMIT:
      return "Höchstzahl qualifizierter Abfragen beim BZSt erreicht; nur einfach bestätigt";
    case "evatr-0004":
      return "Deine USt-IdNr. in den Firmendaten passt nicht in das deutsche Schema";
    case "evatr-2005":
      return "Deine USt-IdNr. in den Firmendaten ist laut BZSt nicht gültig";
    case "evatr-0006":
      return "Deutsche USt-IdNrn. bestätigt das BZSt nicht";
    case "evatr-0005":
    case "evatr-0012":
    case "evatr-2003":
      return "Das BZSt hält die USt-IdNr. für syntaktisch falsch";
    default:
      return `Das BZSt kann die Anfrage gerade nicht bearbeiten (${antwort.status}); versuch es später noch einmal`;
  }
}

/** Gespeicherte Bestätigung, soweit evatrNeuNoetig sie braucht; neueste zuerst */
export interface EvatrStand {
  art: EvatrArt;
  angefragteUstid: string;
  status: string;
  firmenname: string | null;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
}

/**
 * Ob nach dem Speichern eines Kontakts eine Abfrage fällig ist: wenn seine Nummer noch nie angefragt wurde, oder wenn sie
 * zuletzt gültig war und Name oder Anschrift von der letzten qualifizierten Bestätigung abweichen (auch zurück auf einen
 * früheren Stand: die Karte zeigt die letzte). Eine ungültige Nummer fragt Haben nicht bei jedem Speichern neu ab; das
 * geht auf Knopfdruck.
 */
export function evatrNeuNoetig(kontakt: EvatrKontakt, bisher: readonly EvatrStand[]): boolean {
  if (!evatrPruefbar(kontakt.ustId)) return false;
  const nummer = normalizeUstId(kontakt.ustId);
  const zurNummer = bisher.filter((b) => b.angefragteUstid === nummer);
  if (!zurNummer.length) return true;
  if (!evatrGueltig(zurNummer[0]!.status) || !evatrQualifizierbar(kontakt)) return false;
  const anfrage = evatrAnfrage("", kontakt, "qualifiziert");
  const letzte = zurNummer.find((b) => b.art === "qualifiziert");
  return (
    !letzte ||
    letzte.firmenname !== anfrage.firmenname ||
    (letzte.strasse ?? undefined) !== anfrage.strasse ||
    (letzte.plz ?? undefined) !== anfrage.plz ||
    letzte.ort !== anfrage.ort
  );
}
