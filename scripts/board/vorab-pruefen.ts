import { appendFileSync, readFileSync } from "node:fs";
import { arbeit, type IssueKurz } from "./vorab.ts";

/*
 * Liest /tmp/board/board.json und /tmp/board/issues-voll.json (Schritt „Board und Issues lesen“ in
 * .github/workflows/board-pflege.yml) und setzt die Ausgabe `arbeit` auf ja oder nein.
 */

const verzeichnis = process.argv[2] ?? "/tmp/board";
const board: { issue: number | null }[] = JSON.parse(readFileSync(`${verzeichnis}/board.json`, "utf8"));
const roh: { number: number; author: { login: string }; labels: { name: string }[]; comments: { author: { login: string } | null }[] }[] = JSON.parse(
  readFileSync(`${verzeichnis}/issues-voll.json`, "utf8"),
);
const issues: IssueKurz[] = roh.map((i) => ({
  number: i.number,
  author: i.author.login,
  labels: i.labels.map((l) => l.name),
  kommentarVon: i.comments.map((k) => k.author?.login ?? ""),
}));
const { ohneKarte, gespraeche } = arbeit(issues, new Set(board.flatMap((k) => (k.issue ? [k.issue] : []))));
const liste = (n: number[]) => (n.length > 0 ? n.map((x) => `#${x}`).join(", ") : "keine");
console.log(`Ohne Karte: ${liste(ohneKarte)}\nOffene Gespräche: ${liste(gespraeche)}`);
const ja = ohneKarte.length + gespraeche.length > 0;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `arbeit=${ja ? "ja" : "nein"}\n`);
