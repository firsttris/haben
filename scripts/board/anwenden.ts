import {
  type Feld,
  feldSetzen,
  felder,
  hinzufuegen,
  karte,
  kommentieren,
  labelSetzen,
  type Projekt,
  positionSetzen,
  projekt,
  statusLesen,
  statusSetzen,
  zuweisen,
} from "./github.ts";
import type { Schritt } from "./plan.ts";
import { STATUS } from "./regel.ts";

/*
 * Führt Schritte eines Plans aus, ohne KI (plan-posten.ts für die Routine, plan-anwenden.ts nach `/ok`). Eine Karte
 * in „In Arbeit“ oder weiter rechts rückt nie zurück.
 */

const RECHTS = ["In Arbeit", "Im nächsten Release", "Erledigt"];
const warten = (ms: number) => new Promise((fertig) => setTimeout(fertig, ms));

export type Umgebung = { github: string; projectToken: string; repo: string; board: Projekt; felder: Map<string, Feld> };

export async function umgebung(github: string, projectToken: string, repo: string): Promise<Umgebung> {
  return { github, projectToken, repo, board: await projekt(projectToken, STATUS), felder: await felder(projectToken) };
}

async function itemVon(u: Umgebung, issue: number, anlegen: boolean) {
  const stand = await karte(u.projectToken, u.repo, issue, u.board.id);
  if (stand.istPr || !stand.offen) throw new Error(stand.istPr ? "ist ein Pull Request" : "ist geschlossen");
  if (stand.itemId) return { id: stand.itemId, status: stand.status, neu: false };
  if (!anlegen) throw new Error("hat keine Karte im Board");
  return { id: await hinzufuegen(u.projectToken, u.board.id, stand.issueId), status: null, neu: true };
}

/**
 * Führt einen Schritt aus und gibt das Ergebnis als kurzen Text zurück. Mit `nurNeueKarten` (Routine ohne `/ok`)
 * gibt es für eine Karte, die schon im Board steht, null zurück und ändert nichts: Verschieben braucht das OK des
 * Maintainers.
 */
export async function schrittAnwenden(u: Umgebung, schritt: Schritt, nurNeueKarten: boolean): Promise<string | null> {
  if (schritt.art === "frage") return "nur Frage";
  if (schritt.art === "kommentar") {
    await kommentieren(u.github, u.repo, schritt.issue, schritt.text);
    return "kommentiert";
  }
  if (schritt.art === "zuweisen") {
    const item = await itemVon(u, schritt.issue, false);
    if (!(await zuweisen(u.github, u.repo, schritt.issue, schritt.person)).includes(schritt.person)) {
      throw new Error(`@${schritt.person} lässt sich nicht zuweisen`);
    }
    if (!RECHTS.includes(item.status ?? "")) await statusSetzen(u.projectToken, u.board, item.id, "In Arbeit");
    await kommentieren(u.github, u.repo, schritt.issue, schritt.kommentar);
    return `zugewiesen an @${schritt.person}`;
  }
  const stand = await karte(u.projectToken, u.repo, schritt.issue, u.board.id);
  if (nurNeueKarten && stand.itemId) return null;
  const item = await itemVon(u, schritt.issue, true);
  if (RECHTS.includes(item.status ?? "")) throw new Error(`steht schon in „${item.status}“, bleibt dort`);
  await statusSetzen(u.projectToken, u.board, item.id, schritt.status);
  for (const [name, wert] of [
    ["Aufwand", schritt.aufwand],
    ["Bereich", schritt.bereich],
    ["Hinweis", schritt.hinweis],
  ] as const) {
    const feld = u.felder.get(name);
    if (feld && (wert || name !== "Hinweis")) await feldSetzen(u.projectToken, u.board.id, item.id, feld, wert);
  }
  const darueber = schritt.nach ? (await itemVon(u, schritt.nach, false)).id : null;
  await positionSetzen(u.projectToken, u.board.id, item.id, darueber);
  if (schritt.einstieg) await labelSetzen(u.github, u.repo, schritt.issue, "einstieg");
  if (schritt.kommentar) await kommentieren(u.github, u.repo, schritt.issue, schritt.kommentar);
  // Der Workflow „Item added to project“ setzt bei neuen Karten selbst einen Status, auch kurz nach uns
  if (item.neu) {
    await warten(5000);
    if ((await statusLesen(u.projectToken, item.id)) !== schritt.status) await statusSetzen(u.projectToken, u.board, item.id, schritt.status);
  }
  return `Karte: ${schritt.status}${schritt.nach ? `, nach #${schritt.nach}` : ", ganz oben"}`;
}

export const fehlertext = (fehler: unknown) => (fehler as Error).message.slice(0, 300);
