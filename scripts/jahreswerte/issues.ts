/*
 * Befunde als GitHub-Issues (REST-API, https://docs.github.com/en/rest/issues). Jedes Issue trägt die Kennung
 * `[jahreswerte:<schlüssel>]` im Titel und das Label „jahreswerte“. Gibt es schon ein offenes Issue mit der Kennung,
 * entsteht kein zweites; hat sich der Befund geändert (andere Version, anderer Hash), bekommt es einen Kommentar und
 * Titel und Text werden nachgezogen. Woran der Lauf das erkennt, steht als Hash im Text (HTML-Kommentar).
 */
import { createHash } from "node:crypto";
import type { Befund } from "./abruf.ts";

export const LABEL = "jahreswerte";
const LABEL_FARBE = "c5def5";
const LABEL_BESCHREIBUNG = "Amtliche Jahreswerte, ERiC oder Normen haben sich geändert (Workflow „Jahreswerte prüfen“)";

/** Aufruf der GitHub-API; `pfad` ohne Host, z. B. `/repos/firsttris/haben/issues` */
export type GitHub = (methode: "GET" | "POST" | "PATCH", pfad: string, daten?: unknown) => Promise<{ status: number; daten: unknown }>;

export interface Issue {
  number: number;
  title: string;
  body: string | null;
}

export type Aktion =
  | { art: "anlegen"; befund: Befund }
  | { art: "aktualisieren"; nummer: number; befund: Befund }
  | { art: "unveraendert"; nummer: number; befund: Befund };

export const beschreibeAktion = (a: Aktion) =>
  a.art === "anlegen"
    ? "Issue angelegt"
    : a.art === "aktualisieren"
      ? `Issue #${a.nummer} kommentiert und aktualisiert`
      : `Issue #${a.nummer} besteht unverändert`;

export const kennung = (schluessel: string) => `[jahreswerte:${schluessel}]`;

const inhaltHash = (b: Befund) => createHash("sha256").update(`${b.titel}\n${b.text}`).digest("hex").slice(0, 16);
const MARKE = /<!-- jahreswerte-inhalt:([0-9a-f]+) -->/;

export const issueTitel = (b: Befund) => `${b.titel} ${kennung(b.schluessel)}`;

export const issueText = (b: Befund) =>
  [
    b.text,
    "",
    "---",
    "Geöffnet vom Workflow „Jahreswerte prüfen“ (`.github/workflows/jahreswerte.yml`). Erledigt: schließen; besteht der Befund beim nächsten Lauf noch, öffnet er ein neues Issue. Das Label „jahreswerte“ bitte lassen, daran findet der Workflow seine offenen Issues.",
    `<!-- jahreswerte-inhalt:${inhaltHash(b)} -->`,
  ].join("\n");

/** Was mit jedem Befund geschieht, gemessen an den offenen Issues mit dem Label */
export function plane(befunde: readonly Befund[], offen: readonly Issue[]): Aktion[] {
  return befunde.map((befund) => {
    const issue = offen.find((i) => i.title.includes(kennung(befund.schluessel)));
    if (!issue) return { art: "anlegen", befund };
    const bisher = MARKE.exec(issue.body ?? "")?.[1];
    return bisher === inhaltHash(befund) ? { art: "unveraendert", nummer: issue.number, befund } : { art: "aktualisieren", nummer: issue.number, befund };
  });
}

function erwarte(antwort: { status: number; daten: unknown }, was: string): unknown {
  if (antwort.status < 200 || antwort.status >= 300)
    throw new Error(`GitHub: ${was} fehlgeschlagen (HTTP ${antwort.status}): ${JSON.stringify(antwort.daten)}`);
  return antwort.daten;
}

/** Offene Issues mit dem Label, seitenweise; Pull Requests liefert dieselbe Schnittstelle mit, sie zählen nicht */
export async function offeneIssues(gh: GitHub, repo: string): Promise<Issue[]> {
  const alle: Issue[] = [];
  for (let seite = 1; ; seite++) {
    const daten = erwarte(await gh("GET", `/repos/${repo}/issues?state=open&labels=${LABEL}&per_page=100&page=${seite}`), "Issues lesen") as (Issue & {
      pull_request?: unknown;
    })[];
    alle.push(...daten.filter((i) => !i.pull_request).map(({ number, title, body }) => ({ number, title, body })));
    if (daten.length < 100) return alle;
  }
}

export async function sicherstelleLabel(gh: GitHub, repo: string): Promise<void> {
  const vorhanden = await gh("GET", `/repos/${repo}/labels/${LABEL}`);
  if (vorhanden.status === 200) return;
  if (vorhanden.status !== 404) erwarte(vorhanden, "Label lesen");
  erwarte(await gh("POST", `/repos/${repo}/labels`, { name: LABEL, color: LABEL_FARBE, description: LABEL_BESCHREIBUNG }), "Label anlegen");
}

async function ausfuehren(gh: GitHub, repo: string, aktion: Aktion): Promise<void> {
  const { befund } = aktion;
  if (aktion.art === "unveraendert") return;
  if (aktion.art === "anlegen") {
    erwarte(await gh("POST", `/repos/${repo}/issues`, { title: issueTitel(befund), body: issueText(befund), labels: [LABEL] }), "Issue anlegen");
    return;
  }
  erwarte(
    await gh("POST", `/repos/${repo}/issues/${aktion.nummer}/comments`, { body: `Der Befund hat sich geändert:\n\n${befund.text}` }),
    "Kommentar anlegen",
  );
  erwarte(await gh("PATCH", `/repos/${repo}/issues/${aktion.nummer}`, { title: issueTitel(befund), body: issueText(befund) }), "Issue aktualisieren");
}

/** Gleicht die Befunde mit den offenen Issues ab und gibt zurück, was geschehen ist */
export async function issuesAbgleichen(gh: GitHub, repo: string, befunde: readonly Befund[]): Promise<Aktion[]> {
  if (befunde.length === 0) return [];
  await sicherstelleLabel(gh, repo);
  const aktionen = plane(befunde, await offeneIssues(gh, repo));
  for (const aktion of aktionen) await ausfuehren(gh, repo, aktion);
  return aktionen;
}

/** Die echte API mit dem Token des Workflows */
export const githubApi =
  (token: string, holen: typeof fetch = fetch): GitHub =>
  async (methode, pfad, daten) => {
    const antwort = await holen(`https://api.github.com${pfad}`, {
      method: methode,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: daten === undefined ? undefined : JSON.stringify(daten),
    });
    const textInhalt = await antwort.text();
    return { status: antwort.status, daten: textInhalt ? JSON.parse(textInhalt) : null };
  };
