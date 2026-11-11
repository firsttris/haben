import { readFileSync } from "node:fs";
import { kommentarAendern, kommentare, kommentieren, sammelIssue } from "./github.ts";
import { alsKommentar, offenerVorschlag, pruefen } from "./plan.ts";

/*
 * Stellt den Plan des Agenten als Vorschlag ins Issue „Board-Pflege“ (.github/workflows/board-pflege.yml).
 * Ein ungültiger Plan wird nicht gepostet; der Lauf endet rot mit den Fehlern. Ist der letzte Kommentar ein
 * unbeantworteter Vorschlag, ersetzt der neue ihn, damit nur ein aktueller Vorschlag im Issue steht.
 *
 *   bun scripts/board/plan-posten.ts plan.json
 */

export const LABEL = "board-pflege";
const github = process.env.GITHUB_TOKEN ?? "";
const repo = process.env.GITHUB_REPOSITORY ?? "firsttris/haben";
const lauf = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID ?? ""}`;

const datei = process.argv[2] ?? "plan.json";
let daten: unknown;
try {
  daten = JSON.parse(readFileSync(datei, "utf8"));
} catch (fehler) {
  console.error(`::error title=Board-Pflege::${datei} fehlt oder ist kein JSON: ${(fehler as Error).message}`);
  process.exit(1);
}
const ergebnis = pruefen(daten);
if ("fehler" in ergebnis) {
  for (const meldung of ergebnis.fehler) console.error(`::error title=Board-Pflege::${meldung}`);
  process.exit(1);
}

const nummer = await sammelIssue(
  github,
  repo,
  LABEL,
  "Board-Pflege",
  "Hier stellt der Workflow „Board-Pflege“ täglich seinen Vorschlag für das [Project „Roadmap“](https://github.com/users/firsttris/projects/2) ein. Der Maintainer antwortet mit `/ok`, `/ok ohne …` oder `/überarbeiten …` (docs/entwicklung.md, „Vom Issue zum Release“).",
);
const text = alsKommentar(ergebnis.plan, lauf);
const alt = offenerVorschlag(await kommentare(github, repo, nummer), "github-actions[bot]");
if (alt) await kommentarAendern(github, repo, alt, text);
else await kommentieren(github, repo, nummer, text);
console.log(`Vorschlag mit ${ergebnis.plan.schritte.length} Schritten in #${nummer}${alt ? " (ersetzt den unbeantworteten)" : ""}`);
