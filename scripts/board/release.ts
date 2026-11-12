import { execFileSync } from "node:child_process";
import { issueLesen, kommentieren, schliessen } from "./github.ts";
import { istFertigeVersion, kommentar, vorigeFertigeVersion, zuSchliessen } from "./regel.ts";

/*
 * Schließt beim Release einer fertigen Version alle Issues, die seit der vorigen fertigen Version mit
 * `Umgesetzt #…` gemergt wurden, mit einem Kommentar (.github/workflows/release.yml). Ein Release Candidate
 * schließt nichts. Das Board schiebt geschlossene Karten selbst nach „Erledigt“.
 *
 *   bun scripts/board/release.ts v0.7.0            schließt (GITHUB_TOKEN mit issues: write)
 *   bun scripts/board/release.ts v0.7.0 --probe    zeigt nur, was geschlossen würde
 */

const [tag, schalter] = process.argv.slice(2);
const probe = schalter === "--probe";
const repo = process.env.GITHUB_REPOSITORY ?? "firsttris/haben";
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
const liste = zuSchliessen(commits.filter(Boolean));
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
