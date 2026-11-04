import type { Cents } from "./money.ts";
import type { KirchensteuerSatz } from "./ausschuettung.ts";

/*
 * Steuerbescheinigung nach § 45a Abs. 2 EStG, die eine GmbH oder UG als Schuldner der Kapitalerträge
 * (§ 45a Abs. 2 Satz 1 Nr. 1 EStG) ihrem Gesellschafter zu einer Gewinnausschüttung ausstellt.
 *
 * Amtliches Muster: Muster II „Steuerbescheinigung einer leistenden Körperschaft, Personenvereinigung oder
 * Vermögensmasse oder eines Personenunternehmens oder eines Spezial-Investmentfonds“ aus dem BMF-Schreiben vom
 * 16. Mai 2025, IV C 1 - S 2401/00008/014/051, BStBl I 2025 S. 1388 (ersetzt das Schreiben vom 17. Januar 2023),
 * als Einzelsteuerbescheinigung für einen Zahlungstag:
 * https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Abgeltungsteuer/2025-05-16-kapitalertragSt-steuerbescheinigung.pdf
 * Muster II im Amtlichen Einkommensteuer-Handbuch, Anhang 19 I:
 * https://esth.bundesfinanzministerium.de/esth/2025/B-Anhaenge/Anhang-19/I/anlage-2.pdf
 *
 * Abweichungen vom Muster, mit Grund:
 * - Nur die Zeilen, die bei einer Gewinnausschüttung einer GmbH oder UG an einen Gesellschafter vorkommen können;
 *   Zeilen für Investmenterträge, Ersatzbemessungsgrundlage oder ausländische Steuern bleiben weg.
 * - Ohne Verweise auf Zeilen der Anlage KAP: Sie ändern sich mit jedem Jahrgang des Vordrucks.
 * - Die Kirchensteuer steht mit dem Religionsschlüssel aus dem Kirchensteuerabzugsmerkmal statt mit dem Namen der
 *   Religionsgemeinschaft; Haben kennt nur den Schlüssel.
 */

export interface Aussteller {
  name: string;
  strasse: string;
  plz: string;
  ort: string;
  steuernummer?: string;
}

/** Gesellschafter wie in den Angaben zur Körperschaftsteuererklärung */
export interface Glaeubiger {
  name: string;
  strasse?: string;
  plzOrt?: string;
  /** Steuerliche Identifikationsnummer (§ 139b AO), 11 Ziffern */
  idnr?: string;
}

/** Der Anteil eines Gesellschafters an einer gebuchten Ausschüttung, wie in dividends.empfaenger gespeichert */
export interface BescheinigungsAnteil {
  /** Steuerpflichtiger Kapitalertrag: brutto ohne den Teil aus dem Einlagekonto */
  ertrag: Cents;
  ausEinlagekonto: Cents;
  kapest: Cents;
  soli: Cents;
  kist: Cents;
  kirchensteuer: KirchensteuerSatz;
  religionsschluessel: string | null;
}

export interface SteuerbescheinigungEingabe {
  aussteller: Aussteller;
  glaeubiger: Glaeubiger;
  anteil: BescheinigungsAnteil;
  /** Tag des Zuflusses (§ 44 Abs. 2 EStG) */
  zahlungstag: string;
  /** Tag der Ausstellung */
  ausstellungstag: string;
}

export interface BescheinigungsZeile {
  label: string;
  betrag: Cents;
}

export interface Steuerbescheinigung {
  aussteller: Required<Pick<Aussteller, "name" | "strasse" | "plz" | "ort">> & { steuernummer: string | null };
  glaeubiger: { name: string; anschrift: string[]; idnr: string };
  zahlungstag: string;
  ausstellungstag: string;
  zeilen: BescheinigungsZeile[];
  /** Sechsstelliger Religionsschlüssel, nur mit Kirchensteuer */
  religionsschluessel: string | null;
}

export type SteuerbescheinigungErgebnis = { ok: true; bescheinigung: Steuerbescheinigung } | { ok: false; fehlend: string[] };

const blank = (s: string | undefined | null) => !s?.trim();

/** Was für die Bescheinigung fehlt; leer, wenn sie ausgestellt werden kann */
export function bescheinigungFehlend(e: SteuerbescheinigungEingabe): string[] {
  const fehlend: string[] = [];
  const { aussteller: a, glaeubiger: g, anteil } = e;
  if (blank(a.name)) fehlend.push("Name der Gesellschaft fehlt (Einstellungen › Firmendaten).");
  if (blank(a.strasse) || blank(a.plz) || blank(a.ort)) fehlend.push("Anschrift der Gesellschaft ist unvollständig (Einstellungen › Firmendaten).");
  // § 45a Abs. 2 EStG in Verbindung mit § 32d: Name und Anschrift des Gläubigers; die IdNr. verlangt das Muster
  if (blank(g.strasse) || blank(g.plzOrt)) fehlend.push(`Anschrift von ${g.name} fehlt (Jahreserklärung › Angaben zu den Erklärungen).`);
  if (!g.idnr || !/^\d{11}$/.test(g.idnr))
    fehlend.push(`Steuerliche Identifikationsnummer von ${g.name} fehlt (Jahreserklärung › Angaben zu den Erklärungen).`);
  if (anteil.kist > 0 && !anteil.religionsschluessel) fehlend.push(`Religionsschlüssel zur Kirchensteuer von ${g.name} fehlt.`);
  // BMF-Schreiben vom 16. Mai 2025: Da der Zahlungstag zu bescheinigen ist, erst nach der Zahlung ausstellen
  if (e.zahlungstag > e.ausstellungstag)
    fehlend.push(`Die Ausschüttung fließt erst am ${deutschesDatum(e.zahlungstag)} zu; die Bescheinigung gibt es ab diesem Tag.`);
  return fehlend;
}

function deutschesDatum(iso: string): string {
  return iso.split("-").reverse().join(".");
}

/** Inhalt der Steuerbescheinigung eines Gesellschafters zu einer Ausschüttung, oder was dafür fehlt */
export function steuerbescheinigung(e: SteuerbescheinigungEingabe): SteuerbescheinigungErgebnis {
  const fehlend = bescheinigungFehlend(e);
  if (fehlend.length > 0) return { ok: false, fehlend };
  const { aussteller: a, glaeubiger: g, anteil } = e;
  return {
    ok: true,
    bescheinigung: {
      aussteller: { name: a.name.trim(), strasse: a.strasse.trim(), plz: a.plz.trim(), ort: a.ort.trim(), steuernummer: a.steuernummer?.trim() || null },
      glaeubiger: { name: g.name.trim(), anschrift: [g.strasse!.trim(), g.plzOrt!.trim()], idnr: g.idnr! },
      zahlungstag: e.zahlungstag,
      ausstellungstag: e.ausstellungstag,
      // Reihenfolge wie im Muster II; Leistungen aus dem Einlagekonto sind kein Kapitalertrag (§ 20 Abs. 1 Nr. 1 Satz 3 EStG)
      zeilen: [
        { label: "Höhe der Kapitalerträge", betrag: anteil.ertrag },
        { label: "Kapitalertragsteuer", betrag: anteil.kapest },
        { label: "Solidaritätszuschlag", betrag: anteil.soli },
        { label: "Kirchensteuer zur Kapitalertragsteuer", betrag: anteil.kist },
        { label: "Leistungen aus dem steuerlichen Einlagekonto (§ 27 Abs. 1 bis 7 KStG)", betrag: anteil.ausEinlagekonto },
      ],
      religionsschluessel: anteil.kist > 0 ? anteil.religionsschluessel : null,
    },
  };
}
