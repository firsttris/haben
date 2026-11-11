import { readFileSync } from "node:fs";
import {
  feldSetzen,
  felder,
  hinzufuegen,
  karte,
  kommentare,
  kommentieren,
  labelSetzen,
  positionSetzen,
  projekt,
  statusLesen,
  statusSetzen,
  zuweisen,
} from "./github.ts";
import { auslesen, freigabe, type Schritt } from "./plan.ts";
import { STATUS } from "./regel.ts";

/*
 * Setzt einen freigegebenen Vorschlag um (.github/workflows/board-pflege.yml): `/ok` oder `/ok ohne 2, 5` des
 * Maintainers im Issue „Board-Pflege“. Ohne KI: Es tut genau, was im Plan des letzten Vorschlags steht, und
 * schreibt ein Protokoll. Ein zweites `/ok` zum selben Vorschlag tut nichts.
 */

const github = process.env.GITHUB_TOKEN ?? "";
const projectToken = process.env.PROJECT_TOKEN ?? "";
const repo = process.env.GITHUB_REPOSITORY ?? "firsttris/haben";
const BOT = "github-actions[bot]";
const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"));

const antwort = freigabe(payload.comment?.body ?? "");
if (antwort?.art !== "ok") {
  console.log("Board-Pflege: keine Freigabe");
  process.exit(0);
}
const nummer: number = payload.issue.number;
const alle = await kommentare(github, repo, nummer);
const bis = alle.findIndex((k) => k.id === payload.comment.id);
const vorschlag = alle
  .slice(0, bis < 0 ? alle.length : bis)
  .filter((k) => k.person === BOT)
  .findLast((k) => auslesen(k.text));
if (!vorschlag) {
  await kommentieren(github, repo, nummer, "Kein Vorschlag gefunden, auf den sich das `/ok` beziehen könnte.");
  process.exit(0);
}
const marke = `<!-- board-angewendet:${vorschlag.id} -->`;
if (alle.some((k) => k.person === BOT && k.text.includes(marke))) {
  await kommentieren(github, repo, nummer, "Dieser Vorschlag ist schon umgesetzt. Für einen neuen: `/überarbeiten …` oder den Workflow von Hand starten.");
  process.exit(0);
}
const plan = auslesen(vorschlag.text);
if (!plan) process.exit(1);

const board = await projekt(projectToken, STATUS);
const feld = await felder(projectToken);
const warten = (ms: number) => new Promise((fertig) => setTimeout(fertig, ms));
const RECHTS = ["In Arbeit", "Im nächsten Release", "Erledigt"];

async function itemVon(issue: number, anlegen: boolean): Promise<{ id: string; status: string | null; neu: boolean }> {
  const stand = await karte(projectToken, repo, issue, board.id);
  if (stand.istPr || !stand.offen) throw new Error(stand.istPr ? "ist ein Pull Request" : "ist geschlossen");
  if (stand.itemId) return { id: stand.itemId, status: stand.status, neu: false };
  if (!anlegen) throw new Error("hat keine Karte im Board");
  return { id: await hinzufuegen(projectToken, board.id, stand.issueId), status: null, neu: true };
}

async function anwenden(schritt: Schritt): Promise<string> {
  if (schritt.art === "frage") return "nur Frage";
  if (schritt.art === "kommentar") {
    await kommentieren(github, repo, schritt.issue, schritt.text);
    return "kommentiert";
  }
  if (schritt.art === "zuweisen") {
    const item = await itemVon(schritt.issue, false);
    if (!(await zuweisen(github, repo, schritt.issue, schritt.person)).includes(schritt.person)) {
      throw new Error(`@${schritt.person} lässt sich nicht zuweisen`);
    }
    if (!RECHTS.includes(item.status ?? "")) await statusSetzen(projectToken, board, item.id, "In Arbeit");
    await kommentieren(github, repo, schritt.issue, schritt.kommentar);
    return `zugewiesen an @${schritt.person}`;
  }
  const item = await itemVon(schritt.issue, true);
  if (RECHTS.includes(item.status ?? "")) throw new Error(`steht schon in „${item.status}“, bleibt dort`);
  await statusSetzen(projectToken, board, item.id, schritt.status);
  for (const [name, wert] of [
    ["Aufwand", schritt.aufwand],
    ["Bereich", schritt.bereich],
    ["Hinweis", schritt.hinweis],
  ] as const) {
    const f = feld.get(name);
    if (f && (wert || name !== "Hinweis")) await feldSetzen(projectToken, board.id, item.id, f, wert);
  }
  const darueber = schritt.nach ? (await itemVon(schritt.nach, false)).id : null;
  await positionSetzen(projectToken, board.id, item.id, darueber);
  if (schritt.einstieg) await labelSetzen(github, repo, schritt.issue, "einstieg");
  if (schritt.kommentar) await kommentieren(github, repo, schritt.issue, schritt.kommentar);
  // Der Workflow „Item added to project“ setzt bei neuen Karten selbst einen Status, auch kurz nach uns
  if (item.neu) {
    await warten(5000);
    if ((await statusLesen(projectToken, item.id)) !== schritt.status) await statusSetzen(projectToken, board, item.id, schritt.status);
  }
  return `Karte: ${schritt.status}${schritt.nach ? `, nach #${schritt.nach}` : ", ganz oben"}`;
}

const protokoll: string[] = [];
for (const [i, schritt] of plan.schritte.entries()) {
  const nr = i + 1;
  const wo = schritt.issue ? `#${schritt.issue}` : "";
  if (antwort.ohne.includes(nr)) {
    protokoll.push(`| ${nr} | ${wo} | ausgelassen |`);
    continue;
  }
  try {
    protokoll.push(`| ${nr} | ${wo} | ✓ ${await anwenden(schritt)} |`);
  } catch (fehler) {
    protokoll.push(`| ${nr} | ${wo} | ✗ ${(fehler as Error).message.replace(/\|/g, "\\|").slice(0, 300)} |`);
  }
}
await kommentieren(github, repo, nummer, ["Umgesetzt:", "", "| Nr. | Issue | Ergebnis |", "| --- | --- | --- |", ...protokoll, "", marke].join("\n"));
console.log(protokoll.join("\n"));
