import { readFileSync } from "node:fs";
import { fehlertext, schrittAnwenden, umgebung } from "./anwenden.ts";
import { kommentare, kommentieren } from "./github.ts";
import { auslesen, freigabe } from "./plan.ts";

/*
 * `/ok` oder `/ok ohne 2, 5` des Maintainers im Issue „Board-Pflege“ (.github/workflows/board-pflege.yml): setzt die
 * Schritte um, die im letzten Bericht unter „Wartet auf dich“ stehen. Ohne KI, genau wie dort angezeigt, mit
 * Protokoll. Ein zweites `/ok` zum selben Bericht tut nichts.
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
const bericht = alle
  .slice(0, bis < 0 ? alle.length : bis)
  .filter((k) => k.person === BOT)
  .findLast((k) => auslesen(k.text));
const inhalt = bericht ? auslesen(bericht.text) : null;
if (!bericht || !inhalt || inhalt.offen.length === 0) {
  await kommentieren(github, repo, nummer, "Im letzten Bericht wartet nichts auf ein `/ok`.");
  process.exit(0);
}
const marke = `<!-- board-angewendet:${bericht.id} -->`;
if (alle.some((k) => k.person === BOT && k.text.includes(marke))) {
  await kommentieren(github, repo, nummer, "Dieser Bericht ist schon umgesetzt.");
  process.exit(0);
}

const u = await umgebung(github, projectToken, repo);
const protokoll: string[] = [];
for (const nr of inhalt.offen) {
  const schritt = inhalt.plan.schritte[nr - 1];
  if (!schritt) continue;
  const wo = schritt.issue ? `#${schritt.issue}` : "";
  if (antwort.ohne.includes(nr)) {
    protokoll.push(`| ${nr} | ${wo} | ausgelassen |`);
    continue;
  }
  try {
    protokoll.push(`| ${nr} | ${wo} | ✓ ${(await schrittAnwenden(u, schritt, false)) ?? ""} |`);
  } catch (fehler) {
    protokoll.push(`| ${nr} | ${wo} | ✗ ${fehlertext(fehler).replace(/\|/g, "\\|")} |`);
  }
}
await kommentieren(github, repo, nummer, ["Umgesetzt:", "", "| Nr. | Issue | Ergebnis |", "| --- | --- | --- |", ...protokoll, "", marke].join("\n"));
console.log(protokoll.join("\n"));
