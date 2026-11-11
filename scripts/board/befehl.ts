import { readFileSync } from "node:fs";
import { karte, kommentieren, projekt, statusSetzen, zuweisen, zuweisungAufheben } from "./github.ts";
import { STATUS } from "./regel.ts";
import { befehl, entscheiden, textFreigegeben, textZugewiesen } from "./uebernahme.ts";

/*
 * `/übernehmen` und `/freigeben` in einem Issue-Kommentar (.github/workflows/uebernehmen.yml). Die Regeln stehen in
 * uebernahme.ts. Eine Zuweisung mit GITHUB_TOKEN startet den Workflow „Board“ nicht, deshalb schiebt dieses Skript
 * die Karte selbst (PROJECT_TOKEN). Liest vom Kommentar nur den Text, führt nichts davon aus.
 */

const github = process.env.GITHUB_TOKEN ?? "";
const projectToken = process.env.PROJECT_TOKEN;
const repo = process.env.GITHUB_REPOSITORY ?? "firsttris/haben";
const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"));

const { issue, comment } = payload;
const was = befehl(comment?.body ?? "");
if (payload.action !== "created" || issue?.pull_request || comment?.user?.type === "Bot" || !was) {
  console.log("Übernehmen: kein Befehl");
  process.exit(0);
}
if (!projectToken) {
  console.log("::notice title=Übernehmen::PROJECT_TOKEN fehlt, ohne Board kein Übernehmen.");
  process.exit(0);
}

const person: string = comment.user.login;
const nummer: number = issue.number;
const board = await projekt(projectToken, STATUS);
const stand = await karte(projectToken, repo, nummer, board.id);
const zugewiesen: string[] = issue.assignees.map((p: { login: string }) => p.login);
const ergebnis = entscheiden(was, { person, offen: stand.offen, status: stand.status, zugewiesen });
console.log(`#${nummer} ${was} von ${person}: ${ergebnis.art}`);

if (ergebnis.art === "ablehnen") {
  await kommentieren(github, repo, nummer, ergebnis.text);
} else if (ergebnis.art === "zuweisen") {
  // GitHub übergeht eine Zuweisung ohne Fehler, wenn die Person nicht zugewiesen werden darf
  if (!(await zuweisen(github, repo, nummer, person)).includes(person)) {
    await kommentieren(github, repo, nummer, `@${person} das Zuweisen hat nicht geklappt; ein Maintainer kümmert sich darum.`);
    process.exit(1);
  }
  if (stand.itemId) await statusSetzen(projectToken, board, stand.itemId, "In Arbeit");
  await kommentieren(github, repo, nummer, textZugewiesen(person, stand.status ?? ""));
} else {
  await zuweisungAufheben(github, repo, nummer, [person]);
  if (ergebnis.zurueckNachGeplant && stand.itemId) await statusSetzen(projectToken, board, stand.itemId, "Geplant");
  await kommentieren(github, repo, nummer, textFreigegeben(person, ergebnis.zurueckNachGeplant));
}
