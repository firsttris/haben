import { z } from "zod";

/*
 * Neueste stabile Version für Einstellungen › Export › Version.
 *
 * Quelle: GitHub REST, „Get the latest release“ (GET /repos/{owner}/{repo}/releases/latest). Die Antwort ist das neueste
 * Release, das weder Entwurf noch Pre-release ist; Release Candidates (`vX.Y.Z-rc.N`) legt .github/workflows/release.yml
 * als Pre-release an und erscheinen daher nicht. Zusätzlich gilt nur ein Tag `vX.Y.Z`.
 *
 * Die Anfrage geht nur vom Server aus und nur, wenn jemand die Karte lädt, höchstens einmal am Tag. Auch ein Fehlschlag
 * (kein Internet, Zeitüberschreitung, unbrauchbare Antwort) wird so lange gemerkt. Es geht nichts über die Instanz mit:
 * kein Cookie, kein Token, weder Domain noch Version, nur ein fester User-Agent, den GitHub verlangt.
 * Der Zeitpunkt liegt nur im Speicher; nach einem Neustart wird beim ersten Aufruf erneut gefragt.
 * `HABEN_UPDATE_CHECK=off` schaltet die Anfrage ab.
 */

const LATEST_RELEASE_URL = "https://api.github.com/repos/Speicherstadt/haben/releases/latest";
const DAY = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 5000;

const releaseSchema = z.object({ tag_name: z.string().regex(/^v\d+\.\d+\.\d+$/) });

interface Cache {
  at: number;
  version: string | null;
}
interface State {
  __habenNeuesteVersion?: Cache;
  __habenNeuesteVersionLaeuft?: Promise<string | null>;
}

async function fetchLatest(fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const response = await fetchImpl(LATEST_RELEASE_URL, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Haben" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const parsed = releaseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.tag_name.slice(1) : null;
  } catch {
    return null;
  }
}

/**
 * Neueste stabile Version (`X.Y.Z`) oder null, wenn abgeschaltet, nicht erreichbar oder unbrauchbar beantwortet.
 * Wirft nie. `now` und `fetchImpl` sind für Tests austauschbar.
 */
export async function latestStableVersion(now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (process.env.HABEN_UPDATE_CHECK === "off") return null;
  const state = globalThis as State;
  if (state.__habenNeuesteVersion && now - state.__habenNeuesteVersion.at < DAY) return state.__habenNeuesteVersion.version;
  state.__habenNeuesteVersionLaeuft ??= fetchLatest(fetchImpl)
    .then((version) => {
      state.__habenNeuesteVersion = { at: now, version };
      return version;
    })
    .finally(() => {
      state.__habenNeuesteVersionLaeuft = undefined;
    });
  return state.__habenNeuesteVersionLaeuft;
}
