import type { FileProblem, IntegrityReport, PruefwertResult } from "../server/modules/auswertungen/index.ts";
import type { Notice } from "./use-action.ts";

/** Texte zur Prüfung von Kette, Siegeln, Sperren und Dateien, gleich in „Änderungsprotokoll prüfen“ und der Wochenmail */

export const dateienText = (n: number) => (n === 1 ? "1 Datei fehlt oder ist verändert" : `${n} Dateien fehlen oder sind verändert`);

/** „und 1 weiterer Datensatz“, wenn mehrere Datensätze auf dieselbe Datei verweisen, sonst leer */
export const weitereText = (weitere: number) => (weitere === 0 ? "" : ` (und ${weitere} ${weitere === 1 ? "weiterer Datensatz" : "weitere Datensätze"})`);

/** Ein Befund als Zeile: „Beleg hosting.pdf: fehlt“ */
export const dateiBefund = (p: FileProblem) => `${p.art} ${p.datei}: ${p.befund}${weitereText(p.weitere)}`;

/** Meldung nach „Kette prüfen“ oder „Dateien prüfen“: Befunde zuerst, Abweichungen immer dazu, dann Kollisionen */
export function integrityNotice(result: IntegrityReport): NonNullable<Notice> {
  const differences = result.abgleich.abweichungen.length;
  const collisions = result.accountCollisions.length;
  const fileProblems = result.files?.problemCount ?? 0;
  const dateien = fileProblems > 0 ? ` ${dateienText(fileProblems)}.` : "";
  const abweichungen = differences > 0 ? ` Der Abgleich im Journal zeigt ${differences === 1 ? "eine Abweichung" : `${differences} Abweichungen`}.` : "";
  if (result.problems.length > 0)
    return {
      tone: "danger",
      text: `${result.problems.length}${result.truncated ? " oder mehr" : ""} Befunde. Die Datenbank wurde außerhalb von Haben verändert.${dateien}${abweichungen}`,
    };
  if (fileProblems > 0) return { tone: "danger", text: `Kette, Siegel und Sperren sind unverändert, aber ${dateienText(fileProblems)}.${abweichungen}` };
  if (differences > 0)
    return {
      tone: "danger",
      text: `Kette, Siegel und Sperren sind unverändert, aber der Abgleich im Journal zeigt ${differences === 1 ? "eine Abweichung" : `${differences} Abweichungen`}.`,
    };
  if (collisions > 0)
    return {
      tone: "info",
      text: `Kette, Siegel und Sperren sind unverändert. ${collisions} ${collisions === 1 ? "Kontenkollision" : "Kontenkollisionen"}: Bitte kläre die Kontenzuordnung.`,
    };
  return {
    tone: "ok",
    text: `Kette, Siegel und Sperren sind unverändert: ${result.entries} Einträge, ${result.seals} Siegel geprüft. Die geprüften Journal-, Steuer- und OPOS-Werte stimmen überein.`,
  };
}

/** Meldung zum Vergleich mit einem Prüfwert von außerhalb */
export function pruefwertNotice(result: PruefwertResult): NonNullable<Notice> {
  switch (result.status) {
    case "ok":
      return {
        tone: "ok",
        text: `Prüfwert Nr. ${result.seq} stimmt und die Kette ist bis dorthin lückenlos: Das Protokoll ist bis zu diesem Eintrag unverändert. Siegel und spätere Einträge prüft „Kette prüfen“.`,
      };
    case "beschaedigt":
      return {
        tone: "danger",
        text: `Prüfwert Nr. ${result.seq} stimmt, aber Eintrag Nr. ${result.first} davor passt nicht mehr zur Kette (${result.befund}). Er wurde nachträglich verändert.`,
      };
    case "unbestaetigt":
      return {
        tone: "danger",
        text: `Prüfwert Nr. ${result.seq} stimmt, die Kette lässt sich aber nicht bestätigen: Die Datenbank weicht vom Sollbestand ab (${result.befunde.length === 1 ? "ein Befund" : `${result.befunde.length} Befunde`}, etwa „${result.befunde[0]}“). Wer Trigger oder Funktionen ändern kann, kann auch das Nachrechnen fälschen. „Kette prüfen“ nennt alle Befunde.`,
      };
    case "abweichend":
      return {
        tone: "danger",
        text: `Prüfwert Nr. ${result.seq} stimmt nicht. Das Protokoll wurde bis zu diesem Eintrag verändert und neu verkettet. Erwartet ${result.expected}, gefunden ${result.actual}.`,
      };
    case "fehlt":
      return {
        tone: "danger",
        text: `Eintrag Nr. ${result.seq} fehlt, das Protokoll endet bei Nr. ${result.head ?? "–"}. Entweder wurde ein älteres Backup eingespielt oder Einträge wurden gelöscht.`,
      };
  }
}
