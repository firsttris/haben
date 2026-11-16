import { abschnitt, alsMarkdown, kernAbschnitt, tagInDeutschland, verfahrensdoku, type Verfahrensdoku } from "@firsttris/gobd-kern/verfahrensdoku";
import { releaseNotesUrl } from "../../../lib/release-notes.ts";
import { loadProcedureDetails, type ProcedureDetails } from "./angaben.ts";
import { readInstanzStand, type InstanzStand } from "./stand.ts";
import { allgemein, anwender, betrieb, ergaenzungen, zeit, zugaenge } from "./texte.ts";

/**
 * Verfahrensdokumentation aus der eigenen Instanz (#860, GoBD Rz. 151 bis 155), bei jedem Aufruf aus dem aktuellen
 * Stand erzeugt. Gliederung nach Rz. 153: allgemeine Beschreibung, Anwenderdokumentation, technische
 * Systemdokumentation, Betriebsdokumentation. Datenmodell, Lücken, Textbausteine zum Kern und Markdown kommen aus
 * @firsttris/gobd-kern; Stand ist Tag und Haben-Version (Rz. 154).
 */

const VERSIEGELT = [
  "festgeschriebene Rechnungen mit Positionen, Steuerbeträgen, Anhängen und PDF",
  "gebuchte Belege mit ihren Beträgen",
  "festgeschriebene Buchungen mit ihren Buchungszeilen",
  "gesendete oder vermerkte Voranmeldungen mit dem Abgabevermerk",
  "die Zeilen von Kassenbuch, Zuordnungen, Pauschalen und AfA, jede schon beim Anlegen",
];

function system(s: InstanzStand): ReturnType<typeof kernAbschnitt> {
  const kern = kernAbschnitt("3. Technische Systemdokumentation: Unveränderbarkeit und Änderungsprotokoll", {
    versiegelt: VERSIEGELT,
    pruefwert: s.pruefwert,
    dateien: true,
    zugriff: { anmeldung: s.datenbank.loginRole, eingeschraenkt: s.datenbank.restricted, probleme: s.datenbank.problems },
  });
  const mail = s.pruefwertMail
    ? `Haben prüft wöchentlich Kette, Siegel und Sperren und schickt den Prüfwert an ${s.pruefwertMail}, damit er außerhalb des Servers liegt.`
    : "Die wöchentliche Mail mit dem Prüfwert ist ausgeschaltet; außerhalb des Servers liegt der Prüfwert dann nur im Jahresarchiv oder dort, wo der Betrieb ihn selbst ablegt.";
  return {
    ...kern,
    absaetze: [
      ...kern.absaetze,
      mail,
      "Mahnungen, Übermittlungen an ELSTER und Angebote tragen kein Siegel; ihr Anlegen steht im Änderungsprotokoll. Kontoumsätze stehen nicht im Protokoll; sie sind ab dem Import gegen Ändern gesperrt, ihre Auszugsdatei ist mit SHA-256 erfasst. Geprüft wird unter Einstellungen › Export › Änderungsprotokoll prüfen.",
    ],
  };
}

function versionen(s: InstanzStand) {
  return abschnitt("4. Technische Systemdokumentation: eingesetzte Versionen", {
    absaetze: [
      "Jeder Start mit einer neuen Haben- oder PostgreSQL-Version, auch das Zurückrollen auf einen älteren Stand, hängt einen Eintrag an, der selbst im Änderungsprotokoll steht (Programmidentität, Rz. 154). Was sich je Version geändert hat, nennen die Versionshinweise.",
    ],
    liste: s.versionen.map(
      (v) => `Haben ${v.version} seit ${zeit(v.startedAt)}, PostgreSQL ${v.postgresVersion}${v.note ? ` (${v.note})` : ""}: ${releaseNotesUrl(v.version)}`,
    ),
  });
}

export function buildProcedureDocument(s: InstanzStand, angaben: ProcedureDetails, now: Date): Verfahrensdoku {
  const zusatz = ergaenzungen(angaben);
  return verfahrensdoku({
    titel: s.company?.name ? `Verfahrensdokumentation ${s.company.name}` : "Verfahrensdokumentation",
    stand: { datum: tagInDeutschland(now), programm: "Haben", version: s.version },
    abschnitte: [allgemein(s, angaben), anwender(s, angaben), system(s), versionen(s), zugaenge(s), betrieb(s, angaben), ...(zusatz ? [zusatz] : [])],
  });
}

/** Das Dokument mit dem aktuellen Stand und den gespeicherten Angaben */
export async function procedureDocument(now = new Date()): Promise<Verfahrensdoku> {
  const [stand, angaben] = await Promise.all([readInstanzStand(now), loadProcedureDetails()]);
  return buildProcedureDocument(stand, angaben, now);
}

/** Für das Jahresarchiv und den Download: dieselbe Fassung als Markdown */
export async function procedureMarkdown(now = new Date()): Promise<string> {
  return alsMarkdown(await procedureDocument(now));
}
