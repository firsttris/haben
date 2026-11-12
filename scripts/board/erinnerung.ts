import {
  istCollaborator,
  karte,
  kommentareSeit,
  kommentieren,
  offenePrs,
  projekt,
  statusSetzen,
  zugewiesenAm,
  zugewieseneIssues,
  zuweisungAufheben,
} from "./github.ts";
import { STATUS, verweise } from "./regel.ts";
import { faellig, MARKE_ERINNERUNG, textAutomatischFreigegeben, textErinnerung } from "./uebernahme.ts";

/*
 * Täglicher Lauf (.github/workflows/uebernehmen.yml): Zuweisungen ohne Pull Request und ohne Kommentar der
 * zugewiesenen Person seit 14 Tagen bekommen eine Erinnerung, sieben Tage danach werden sie freigegeben. Issues
 * von Maintainern und Collaborators bleiben außen vor; die regeln das selbst.
 *
 *   bun scripts/board/erinnerung.ts            erinnert und gibt frei
 *   bun scripts/board/erinnerung.ts --probe    zeigt nur, was passieren würde
 */

const probe = process.argv.includes("--probe");
const github = process.env.GITHUB_TOKEN ?? "";
const projectToken = process.env.PROJECT_TOKEN;
const repo = process.env.GITHUB_REPOSITORY ?? "firsttris/haben";
const jetzt = new Date();

const beiPrs = new Set((await offenePrs(github, repo)).flatMap((text) => Object.values(verweise(text)).flat()));
const vertraut = new Map<string, boolean>();
const istVertraut = async (person: string) => {
  if (!vertraut.has(person)) vertraut.set(person, await istCollaborator(github, repo, person));
  return vertraut.get(person) ?? false;
};

for (const { number: nummer, assignees } of await zugewieseneIssues(github, repo)) {
  const personen: string[] = [];
  for (const person of assignees) if (!(await istVertraut(person))) personen.push(person);
  if (personen.length === 0) continue;

  const seit = await zugewiesenAm(github, repo, nummer, personen);
  if (!seit) continue;
  const kommentare = await kommentareSeit(github, repo, nummer, seit);
  const erinnerungen = kommentare.filter((k) => k.text.includes(MARKE_ERINNERUNG)).map((k) => k.am.getTime());
  const was = faellig(
    {
      zugewiesenAm: seit,
      kommentareAm: kommentare.filter((k) => personen.includes(k.person)).map((k) => k.am),
      erinnertAm: erinnerungen.length > 0 ? new Date(Math.max(...erinnerungen)) : null,
      offenerPr: beiPrs.has(nummer),
    },
    jetzt,
  );
  if (!was) continue;
  console.log(`#${nummer} (${personen.join(", ")}): ${was}${probe ? " (Probe)" : ""}`);
  if (probe) continue;

  if (was === "erinnern") {
    await kommentieren(github, repo, nummer, textErinnerung(personen));
    continue;
  }
  await zuweisungAufheben(github, repo, nummer, personen);
  // Die Karte geht nur zurück, wenn niemand mehr zugewiesen ist und sie noch in Arbeit steht
  if (projectToken && personen.length === assignees.length) {
    const board = await projekt(projectToken, STATUS);
    const stand = await karte(projectToken, repo, nummer, board.id);
    if (stand.itemId && stand.status === "In Arbeit") await statusSetzen(projectToken, board, stand.itemId, "Geplant");
  }
  await kommentieren(github, repo, nummer, textAutomatischFreigegeben(personen));
}
