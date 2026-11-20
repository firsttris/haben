import { execFileSync } from "node:child_process";
import { issueLesen, kommentieren, schliessen } from "./github.ts";
import { istFertigeVersion, kommentar, prNummer, verweise, vorigeFertigeVersion, zuSchliessen } from "./regel.ts";

/*
 * Schließt beim Release einer fertigen Version alle Issues, die seit der vorigen fertigen Version mit
 * `Umgesetzt #…` gemergt wurden, mit einem Kommentar (.github/workflows/release.yml). Zählt auch ein `Refs`,
 * das erst nach dem Merge in der Beschreibung zu `Umgesetzt` wurde. Ein Release Candidate
 * schließt nichts. Das Board schiebt geschlossene Karten selbst nach „Erledigt“.
 *
 *   bun scripts/board/release.ts v0.7.0            schließt (GITHUB_TOKEN mit issues: write)
 *   bun scripts/board/release.ts v0.7.0 --probe    zeigt nur, was geschlossen würde
 */

const [tag, schalter] = process.argv.slice(2);
const probe = schalter === "--probe";
const repo = process.env.GITHUB_REPOSITORY ?? "Speicherstadt/haben";
const token = process.env.GITHUB_TOKEN ?? "";

if (!tag || !istFertigeVersion(tag)) {
  console.log(`Issues schließen: ${tag ?? "ohne Tag"} ist keine fertige Version, nichts zu tun`);
  process.exit(0);
}

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });
const vorher = vorigeFertigeVersion(git("tag", "--list", "v*").split("\n").filter(Boolean), tag);
if (!vorher) {
  console.log(`Issues schließen: keine fertige Version vor ${tag}, nichts zu tun`);
  process.exit(0);
}

const commits = git("log", "--format=%B%x00", `${vorher}..${tag}`)
  .split("\0")
  .map((nachricht) => nachricht.trim());
// Heutige Beschreibung der Pull Requests, deren Commit nur `Refs` hat: ein nach dem Merge gesetztes `Umgesetzt`
// steht nicht im Commit (zuSchliessen). Scheitert das Lesen, zählt wie bisher nur der Commit.
const beschreibungen = new Map<number, string>();
for (const nachricht of commits) {
  const pr = prNummer(nachricht);
  if (pr === null || verweise(nachricht).refs.length === 0) continue;
  try {
    beschreibungen.set(pr, (await issueLesen(token, repo, pr)).body ?? "");
  } catch (fehler) {
    console.log(`#${pr}: Beschreibung nicht lesbar, es zählt nur der Commit (${fehler instanceof Error ? fehler.message : fehler})`);
  }
}
const liste = zuSchliessen(commits.filter(Boolean), beschreibungen);
console.log(`Issues schließen: ${liste.size} umgesetzt zwischen ${vorher} und ${tag}`);

for (const [issue, prs] of liste) {
  if (probe) {
    console.log(`#${issue} (aus ${prs.map((pr) => `#${pr}`).join(", ") || "ohne PR-Nummer"})`);
    continue;
  }
  const stand = await issueLesen(token, repo, issue);
  if (stand.pull_request || stand.state !== "open") {
    console.log(`#${issue}: ${stand.pull_request ? "ist ein Pull Request" : "schon geschlossen"}, bleibt`);
    continue;
  }
  await kommentieren(token, repo, issue, kommentar(repo, tag, issue, prs));
  await schliessen(token, repo, issue);
  console.log(`#${issue}: geschlossen`);
}
