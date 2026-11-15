import type { FileProblem, IntegrityReport } from "../server/modules/auswertungen/index.ts";
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
  const abweichungen =
    differences > 0 ? ` Journal und Nebenbücher weichen ${differences === 1 ? "an einer Stelle" : `an ${differences} Stellen`} voneinander ab.` : "";
  if (result.problems.length > 0)
    return {
      tone: "danger",
      text: `${result.problems.length}${result.truncated ? " oder mehr" : ""} Befunde. Die Datenbank wurde außerhalb von Haben verändert.${dateien}${abweichungen}`,
    };
  if (fileProblems > 0) return { tone: "danger", text: `Kette, Siegel und Sperren sind unverändert, aber ${dateienText(fileProblems)}.${abweichungen}` };
  if (differences > 0)
    return {
      tone: "danger",
      text: `Kette, Siegel und Sperren sind unverändert, aber Journal und Nebenbücher weichen ${differences === 1 ? "an einer Stelle" : `an ${differences} Stellen`} voneinander ab.`,
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
