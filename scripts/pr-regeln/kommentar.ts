import type { Report } from "./regel.ts";

/*
 * Kommentar im Pull Request mit den Fehlern und Hinweisen von „PR-Regeln“. Die Prüfung läuft mit Leserecht und
 * legt ihr Ergebnis als Artefakt ab; .github/workflows/pr-regeln-kommentar.yml liest es nach dem Lauf und
 * schreibt einen einzigen Kommentar, den es bei jedem Push ändert statt neue anzulegen.
 * Das Artefakt kommt aus einem Lauf mit dem Code des Pull Requests, bei Forks also von außen: ergebnisLesen()
 * nimmt nur die erwartete Form an, und jeder Text wird entschärft, bevor er in den Kommentar geht.
 */

/** Erkennt den eigenen Kommentar unter allen im Pull Request */
export const MARKER = "<!-- haben:pr-regeln -->";

export type Ergebnis = { pr: number; headSha: string; reports: Report[] };

const MAX_REPORTS = 50;
const MAX_LAENGE = 500;

/** Ergebnis aus dem Artefakt; wirft bei allem, was nicht von pruefen.ts stammen kann */
export function ergebnisLesen(daten: unknown): Ergebnis {
  const { pr, headSha, reports } = (daten ?? {}) as Record<string, unknown>;
  if (typeof pr !== "number" || !Number.isInteger(pr) || pr <= 0) throw new Error("Ergebnis: pr fehlt oder ist keine Nummer.");
  if (typeof headSha !== "string" || !/^[0-9a-f]{40}$/.test(headSha)) throw new Error("Ergebnis: headSha ist kein Commit.");
  if (!Array.isArray(reports) || reports.length > MAX_REPORTS) throw new Error("Ergebnis: reports fehlt oder ist zu lang.");
  for (const report of reports) {
    const { level, message } = (report ?? {}) as Record<string, unknown>;
    if ((level !== "error" && level !== "warning") || typeof message !== "string") {
      throw new Error("Ergebnis: ein Eintrag hat nicht die Form { level, message }.");
    }
  }
  return { pr, headSha, reports: reports as Report[] };
}

/**
 * Eine Zeile Text ohne Markdown-Wirkung, die stört: keine Zeilenumbrüche, keine Erwähnung (der Titel steht in der
 * Meldung, „@name“ darin würde sonst jemanden benachrichtigen), kein HTML-Kommentar, der den Marker vortäuscht.
 */
export function entschaerfen(text: string): string {
  const zeile = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/@(?=[\w-])/g, "@​")
    .replace(/</g, "&lt;");
  return zeile.length > MAX_LAENGE ? `${zeile.slice(0, MAX_LAENGE - 1)}…` : zeile;
}

const liste = (reports: Report[]) => reports.map(({ message }) => `- ${entschaerfen(message)}`).join("\n");

/** Text des Kommentars; ohne Fehler und Hinweise steht darin, dass nichts mehr offen ist */
export function kommentarText(reports: Report[], headSha: string): string {
  const fehler = reports.filter(({ level }) => level === "error");
  const hinweise = reports.filter(({ level }) => level === "warning");
  const teile = [MARKER, "### PR-Regeln", ""];
  if (reports.length === 0) {
    teile.push("Keine Fehler und keine Hinweise mehr.", "");
  } else {
    if (fehler.length > 0) teile.push("**Fehler** (halten den Pull Request auf):", "", liste(fehler), "");
    if (hinweise.length > 0) teile.push("**Hinweise** (der Check bleibt grün, bitte trotzdem ansehen):", "", liste(hinweise), "");
  }
  teile.push(
    `<sub>Stand ${headSha.slice(0, 7)}. Dieser Kommentar ändert sich mit jedem Push; die Regeln stehen in docs/entwicklung.md unter „Automatische Prüfungen der Regeln“.</sub>`,
  );
  return teile.join("\n");
}

export type Kommentar = { id: number; body: string; user: { login: string } };

/** Kommentare schreibt der Workflow mit GITHUB_TOKEN; den Marker allein könnte jeder in einen Kommentar setzen */
const BOT = "github-actions[bot]";

export function eigenerKommentar(kommentare: Kommentar[]): Kommentar | null {
  return kommentare.find(({ user, body }) => user.login === BOT && body.includes(MARKER)) ?? null;
}

export type Aktion = { art: "anlegen"; text: string } | { art: "aendern"; id: number; text: string } | { art: "nichts" };

/**
 * Ohne Fehler und Hinweise kommt kein neuer Kommentar; ein alter bekommt den Stand „nichts mehr offen“, damit
 * dort keine erledigten Hinweise stehen bleiben.
 */
export function aktion(reports: Report[], headSha: string, vorhanden: Kommentar | null): Aktion {
  const text = kommentarText(reports, headSha);
  if (!vorhanden) return reports.length === 0 ? { art: "nichts" } : { art: "anlegen", text };
  return vorhanden.body === text ? { art: "nichts" } : { art: "aendern", id: vorhanden.id, text };
}
