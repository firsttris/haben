import { readFileSync } from "node:fs";
import { hinzufuegen, karte, projekt, statusLesen, statusSetzen } from "./github.ts";
import { STATUS, schritte, zielStatus } from "./regel.ts";

/*
 * Schiebt Karten im Project „Roadmap“ nach einem Ereignis (.github/workflows/board.yml): Issue zugewiesen, PR
 * geöffnet, geändert oder gemergt. Was genau, entscheidet schritte() in regel.ts. Ohne PROJECT_TOKEN (Fork,
 * Secret fehlt) endet es mit einem Hinweis, ohne Fehler.
 */

const token = process.env.PROJECT_TOKEN;
const repo = process.env.GITHUB_REPOSITORY ?? "firsttris/haben";
const name = process.env.GITHUB_EVENT_NAME ?? "";
const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"));

const liste =
  name === "issues"
    ? schritte({ art: "issues", action: payload.action, issue: payload.issue })
    : name.startsWith("pull_request")
      ? schritte({ art: "pull_request", action: payload.action, pull_request: payload.pull_request })
      : [];

if (liste.length === 0) {
  console.log("Board: nichts zu tun");
  process.exit(0);
}
if (!token) {
  console.log("::notice title=Board::PROJECT_TOKEN fehlt, das Board bleibt unverändert.");
  process.exit(0);
}

const board = await projekt(token, STATUS);
const warten = (ms: number) => new Promise((fertig) => setTimeout(fertig, ms));

for (const { issue, ziel, hinzufuegen: anlegen } of liste) {
  const stand = await karte(token, repo, issue, board.id);
  if (stand.istPr || !stand.offen) {
    console.log(`#${issue}: ${stand.istPr ? "ist ein Pull Request" : "ist geschlossen"}, bleibt`);
    continue;
  }
  let itemId = stand.itemId;
  if (!itemId) {
    if (!anlegen) {
      console.log(`#${issue}: nicht im Board, bleibt draußen`);
      continue;
    }
    itemId = await hinzufuegen(token, board.id, stand.issueId);
  }
  const neu = zielStatus(stand.status, ziel);
  if (!neu) {
    console.log(`#${issue}: steht schon auf „${stand.status}“`);
    continue;
  }
  await statusSetzen(token, board, itemId, neu);
  // Der Workflow „Item added to project“ des Boards setzt bei neuen Karten selbst einen Status, auch kurz nach uns
  if (!stand.itemId) {
    await warten(5000);
    if ((await statusLesen(token, itemId)) !== neu) await statusSetzen(token, board, itemId, neu);
  }
  console.log(`#${issue}: ${stand.status ?? "neu"} → ${neu}`);
}
