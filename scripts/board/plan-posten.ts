import { readFileSync } from "node:fs";
import { fehlertext, schrittAnwenden, umgebung } from "./anwenden.ts";
import { kommentieren, sammelIssue } from "./github.ts";
import { alsKommentar, automatisch, pruefen } from "./plan.ts";

/*
 * Nach dem Agenten (.github/workflows/board-pflege.yml): prüft plan.json, setzt die Routine sofort um (neue Karten
 * einordnen, Rückfragen) und stellt das Ergebnis mit allem, was auf den Maintainer wartet, ins Issue „Board-Pflege“.
 * Ein ungültiger Plan wird weder angewendet noch gepostet; der Lauf endet rot mit den Fehlern.
 *
 *   bun scripts/board/plan-posten.ts plan.json
 */

const LABEL = "board-pflege";
const github = process.env.GITHUB_TOKEN ?? "";
const projectToken = process.env.PROJECT_TOKEN ?? "";
const repo = process.env.GITHUB_REPOSITORY ?? "firsttris/haben";
const lauf = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID ?? ""}`;

const datei = process.argv[2] ?? "plan.json";
let daten: unknown;
try {
  daten = JSON.parse(readFileSync(datei, "utf8"));
} catch (fehler) {
  console.error(`::error title=Board-Pflege::${datei} fehlt oder ist kein JSON: ${fehlertext(fehler)}`);
  process.exit(1);
}
const ergebnis = pruefen(daten);
if ("fehler" in ergebnis) {
  for (const meldung of ergebnis.fehler) console.error(`::error title=Board-Pflege::${meldung}`);
  process.exit(1);
}
const { plan } = ergebnis;
if (plan.schritte.length === 0) {
  console.log(`Nichts zu tun: ${plan.zusammenfassung}`);
  process.exit(0);
}

const u = await umgebung(github, projectToken, repo);
const erledigt = new Map<number, string>();
const offen: number[] = [];
for (const [i, schritt] of plan.schritte.entries()) {
  const nr = i + 1;
  if (schritt.art === "frage") continue;
  if (!automatisch(schritt)) {
    offen.push(nr);
    continue;
  }
  try {
    const text = await schrittAnwenden(u, schritt, true);
    // null: Die Karte steht schon im Board, Verschieben wartet auf das OK des Maintainers
    if (text === null) offen.push(nr);
    else erledigt.set(nr, `✓ ${text}`);
  } catch (fehler) {
    erledigt.set(nr, `✗ ${fehlertext(fehler)}`);
  }
}

const nummer = await sammelIssue(
  github,
  repo,
  LABEL,
  "Board-Pflege",
  "Hier meldet der Workflow „Board-Pflege“ täglich, was er im [Project „Roadmap“](https://github.com/users/firsttris/projects/2) eingeordnet hat und was auf den Maintainer wartet. Freigabe mit `/ok`, `/ok ohne …` oder `/überarbeiten …` (docs/entwicklung.md, „Vom Issue zum Release“).",
);
await kommentieren(github, repo, nummer, alsKommentar(plan, lauf, erledigt, offen));
console.log(`#${nummer}: ${erledigt.size} erledigt, ${offen.length} warten`);
