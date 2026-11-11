import { readFileSync } from "node:fs";
import { aktion, eigenerKommentar, ergebnisLesen, type Kommentar } from "./kommentar.ts";

/*
 * Schreibt oder ändert den Kommentar von „PR-Regeln“ (kommentar.ts). Läuft in
 * .github/workflows/pr-regeln-kommentar.yml nach dem Lauf der Prüfung, mit dem Code der Basis und
 * GITHUB_TOKEN (pull-requests: write). Kommentiert nur, wenn der Pull Request offen ist und sein Kopf noch der
 * geprüfte Commit ist: Ein Artefakt mit fremder Nummer oder ein veralteter Lauf ändert nichts.
 */

const token = process.env.GITHUB_TOKEN ?? "";
const repo = process.env.GITHUB_REPOSITORY ?? "";
const headSha = process.env.HEAD_SHA ?? "";
const datei = process.env.ERGEBNIS ?? "";

async function anfrage<T>(pfad: string, init: RequestInit = {}): Promise<T> {
  const antwort = await fetch(`https://api.github.com/repos/${repo}${pfad}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "haben-pr-regeln",
    },
  });
  if (!antwort.ok) throw new Error(`GitHub ${init.method ?? "GET"} ${pfad}: ${antwort.status} ${await antwort.text()}`);
  return (await antwort.json()) as T;
}

const ergebnis = ergebnisLesen(JSON.parse(readFileSync(datei, "utf8")));
if (ergebnis.headSha !== headSha) throw new Error(`Ergebnis gilt für ${ergebnis.headSha}, der Lauf für ${headSha}.`);

const pr = await anfrage<{ state: string; head: { sha: string } }>(`/pulls/${ergebnis.pr}`);
if (pr.state !== "open" || pr.head.sha !== headSha) {
  console.log(`#${ergebnis.pr}: ${pr.state !== "open" ? "nicht mehr offen" : "inzwischen neuer Commit"}, kein Kommentar`);
  process.exit(0);
}

const kommentare: Kommentar[] = [];
for (let seite = 1; ; seite++) {
  const teil = await anfrage<Kommentar[]>(`/issues/${ergebnis.pr}/comments?per_page=100&page=${seite}`);
  kommentare.push(...teil);
  if (teil.length < 100) break;
}

const schritt = aktion(ergebnis.reports, headSha, eigenerKommentar(kommentare));
if (schritt.art === "anlegen") {
  await anfrage(`/issues/${ergebnis.pr}/comments`, { method: "POST", body: JSON.stringify({ body: schritt.text }) });
} else if (schritt.art === "aendern") {
  await anfrage(`/issues/comments/${schritt.id}`, { method: "PATCH", body: JSON.stringify({ body: schritt.text }) });
}
console.log(`#${ergebnis.pr}: Kommentar ${{ anlegen: "angelegt", aendern: "geändert", nichts: "unverändert" }[schritt.art]}`);
