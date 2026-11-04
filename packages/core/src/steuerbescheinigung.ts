import type { Cents } from "./money.ts";
import type { KirchensteuerSatz } from "./ausschuettung.ts";

/*
 * Steuerbescheinigung nach § 45a Abs. 2 EStG, die eine GmbH oder UG als Schuldner der Kapitalerträge
 * (§ 45a Abs. 2 Satz 1 Nr. 1 EStG) ihrem Gesellschafter zu einer Gewinnausschüttung ausstellt.
 *
 * Amtliches Muster: Muster II „Steuerbescheinigung einer leistenden Körperschaft, Personenvereinigung oder
 * Vermögensmasse oder eines Personenunternehmens oder eines Spezial-Investmentfonds oder eines inländischen Betreibers
 * /einer inländischen Zweigniederlassung eines ausländischen Betreibers einer Internet-Dienstleistungsplattform“, Anlage
 * zum BMF-Schreiben vom 16. Mai 2025, IV C 1 - S 2401/00008/014/051, BStBl I 2025 S. 1388, Seiten 37 bis 42 von 50.
 * Am Original geprüft in der Fassung, die das Bayerische Landesamt für Steuern bereitstellt (BMF-Kopf, Stand 17.07.2025):
 * https://www.lfst.bayern.de/fileadmin/RESSOURCEN/Formulare/Weitere_Themen_A_bis_Z/Kapitalertragsteuer/Steuerbescheinigung_Muster_II.pdf
 * Rz. 1 des Schreibens (Wortlaut bei Haufe, HI16827399): „Nach Inhalt, Aufbau und Reihenfolge der Angaben darf von ihnen
 * nicht abgewichen werden. Die Gestaltung der Felder für die Bezeichnung des Instituts und des Gläubigers ist nicht
 * vorgeschrieben. Eine Ergänzung der Steuerbescheinigungen um ein zusätzliches Adressfeld ist zulässig.“
 *
 * Was Haben aus dem Muster nimmt: Einzelsteuerbescheinigung, Alternative 1 („An … wurden lt. Beschluss vom … am …
 * (Zahlungstag) für … (Zeitraum) folgende Kapitalerträge gezahlt“) und die Zeilen, die bei einer Gewinnausschüttung einer
 * GmbH oder UG an einen Gesellschafter vorkommen, in der Reihenfolge und im Wortlaut des Musters, samt dessen Fußnoten zur
 * Anlage KAP. Zeilen für andere Kapitalerträge (Nr. 2 bis 8a, Investmenterträge, Lebensversicherungen, ausländische
 * Steuer, Sparer-Pauschbetrag) bleiben weg: „Nicht erforderliche Zeilen können daher weggelassen werden“
 * (Littmann/Bitz/Pust, EStG § 45a Rn. 14, zum BMF-Schreiben vom 16.05.2025).
 *
 * Die Identifikationsnummer verlangt das Muster nicht; Haben stellt die Bescheinigung trotzdem nur mit ihr aus, weil es
 * nur natürliche Personen als Gesellschafter abdeckt, und druckt sie im frei gestaltbaren Feld des Gläubigers.
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
  /** Name der kirchensteuererhebenden Religionsgemeinschaft; das Muster verlangt ihn zur Kirchensteuer */
  religionsgemeinschaft?: string;
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
  /** Gewinnverwendungsbeschluss: Tag und Geschäftsjahr, dessen Gewinn ausgeschüttet wird (null bei älteren Buchungen) */
  beschluss: { datum: string; geschaeftsjahr: number | null };
  /** Tag des Zuflusses (§ 44 Abs. 2 EStG) */
  zahlungstag: string;
  /** Tag der Ausstellung */
  ausstellungstag: string;
}

/** Eine Zeile des Musters: ein Betrag, gegebenenfalls mit der Fußnote des Musters, oder eine Angabe als Text */
export type BescheinigungsZeile = { label: string; betrag: Cents; fussnote?: string } | { label: string; text: string };

export interface Steuerbescheinigung {
  aussteller: Required<Pick<Aussteller, "name" | "strasse" | "plz" | "ort">> & { steuernummer: string | null };
  glaeubiger: { name: string; anschrift: string[]; idnr: string };
  beschlusstag: string;
  /** „für … (Zeitraum)“ im Satz des Musters, etwa „das Geschäftsjahr 2025“; null, wenn unbekannt */
  zeitraum: string | null;
  zahlungstag: string;
  ausstellungstag: string;
  zeilen: BescheinigungsZeile[];
}

export type SteuerbescheinigungErgebnis = { ok: true; bescheinigung: Steuerbescheinigung } | { ok: false; fehlend: string[] };

const blank = (s: string | undefined | null) => !s?.trim();

/** Was für die Bescheinigung fehlt; leer, wenn sie ausgestellt werden kann */
export function bescheinigungFehlend(e: SteuerbescheinigungEingabe): string[] {
  const fehlend: string[] = [];
  const { aussteller: a, glaeubiger: g, anteil } = e;
  const angaben = "(Jahreserklärung › Angaben zu den Erklärungen)";
  if (blank(a.name)) fehlend.push("Name der Gesellschaft fehlt (Einstellungen › Firmendaten).");
  if (blank(a.strasse) || blank(a.plz) || blank(a.ort)) fehlend.push("Anschrift der Gesellschaft ist unvollständig (Einstellungen › Firmendaten).");
  // Muster II: Name und Anschrift des Gläubigers. Die IdNr. grenzt auf natürliche Personen ein (siehe Kopf der Datei).
  if (blank(g.strasse) || blank(g.plzOrt)) fehlend.push(`Anschrift von ${g.name} fehlt ${angaben}.`);
  if (!g.idnr || !/^\d{11}$/.test(g.idnr)) fehlend.push(`Steuerliche Identifikationsnummer von ${g.name} fehlt ${angaben}.`);
  // Muster II, Zeile unter der Kirchensteuer: „kirchensteuererhebende Religionsgemeinschaft“, mit Namen, nicht als Schlüssel
  if (anteil.kist > 0 && blank(g.religionsgemeinschaft)) fehlend.push(`Kirchensteuererhebende Religionsgemeinschaft von ${g.name} fehlt ${angaben}.`);
  // Muster II „darf erst nach Vornahme der Leistung an den Gläubiger ausgestellt werden“ (Frotscher/Geurts, EStG § 45a Rz. 100)
  if (e.zahlungstag > e.ausstellungstag)
    fehlend.push(`Die Ausschüttung fließt erst am ${deutschesDatum(e.zahlungstag)} zu; die Bescheinigung gibt es ab diesem Tag.`);
  return fehlend;
}

function deutschesDatum(iso: string): string {
  return iso.split("-").reverse().join(".");
}

/**
 * Die Zeilen des Musters II für eine Gewinnausschüttung, in seiner Reihenfolge (Seite 38 und 39 der Anlage). Leistungen aus
 * dem Einlagekonto sind kein Kapitalertrag (§ 20 Abs. 1 Nr. 1 Satz 3 EStG) und stehen nur in ihrer eigenen Zeile.
 */
function zeilen(anteil: BescheinigungsAnteil, religionsgemeinschaft: string): BescheinigungsZeile[] {
  return [
    { label: "Kapitalerträge im Sinne des § 43 Abs. 1 Satz 1 Nr. 1 EStG", betrag: anteil.ertrag },
    {
      label: "Summe Kapitalertragsteuer in Höhe von 25 % oder wegen einbehaltener Kirchensteuer entsprechend geminderter Kapitalertragsteuerbetrag",
      betrag: anteil.kapest,
    },
    // Fußnoten 8 und 9 des Musters
    { label: "Summe Solidaritätszuschlag", betrag: anteil.soli, fussnote: "Bei Verwendung der Anlage KAP: Eintragung in Zeile 40." },
    { label: "Summe Kirchensteuer zur Kapitalertragsteuer", betrag: anteil.kist, fussnote: "Bei Verwendung der Anlage KAP: Eintragung in Zeile 41." },
    ...(anteil.kist > 0 ? [{ label: "kirchensteuererhebende Religionsgemeinschaft", text: religionsgemeinschaft }] : []),
    { label: "Leistungen aus dem steuerlichen Einlagekonto (§ 27 Abs. 1 – 7 KStG)", betrag: anteil.ausEinlagekonto },
  ];
}

/** Inhalt der Steuerbescheinigung eines Gesellschafters zu einer Ausschüttung, oder was dafür fehlt */
export function steuerbescheinigung(e: SteuerbescheinigungEingabe): SteuerbescheinigungErgebnis {
  const fehlend = bescheinigungFehlend(e);
  if (fehlend.length > 0) return { ok: false, fehlend };
  const { aussteller: a, glaeubiger: g, anteil, beschluss } = e;
  return {
    ok: true,
    bescheinigung: {
      aussteller: { name: a.name.trim(), strasse: a.strasse.trim(), plz: a.plz.trim(), ort: a.ort.trim(), steuernummer: a.steuernummer?.trim() || null },
      glaeubiger: { name: g.name.trim(), anschrift: [g.strasse!.trim(), g.plzOrt!.trim()], idnr: g.idnr! },
      beschlusstag: beschluss.datum,
      zeitraum: beschluss.geschaeftsjahr === null ? null : `das Geschäftsjahr ${beschluss.geschaeftsjahr}`,
      zahlungstag: e.zahlungstag,
      ausstellungstag: e.ausstellungstag,
      zeilen: zeilen(anteil, g.religionsgemeinschaft?.trim() ?? ""),
    },
  };
}
