import { resolve } from "node:path";
import {
  createElsterClient,
  DEFAULT_ERIC_VERSION,
  EricInstallError,
  installedEricVersion,
  ericHomeIn,
  installEric,
  isEricVersion,
  type ElsterClient,
  type InstallProgress,
} from "@haben/elster";
import { env } from "./env.ts";

let client: { home: string | undefined; client: ElsterClient } | undefined;

/** ERIC_HOME, sonst das von Haben heruntergeladene ERiC unter ERIC_DIR, sonst keins */
export function ericHome(): string | undefined {
  const e = env();
  if (e.ERIC_HOME?.trim()) return e.ERIC_HOME.trim();
  return ericHomeIn(resolve(e.ERIC_DIR)) ?? undefined;
}

export function elsterClient(): ElsterClient {
  const home = ericHome();
  // Nach einem Download ohne Neustart auf das echte ERiC umschalten
  if (!client || client.home !== home) client = { home, client: createElsterClient({ ...env(), ERIC_HOME: home }) };
  return client.client;
}

/** Ohne ERiC läuft alles gegen einen simulierten Client. */
export function elsterMode(): "eric" | "simuliert" {
  return ericHome() ? "eric" : "simuliert";
}

export class EricSetupError extends Error {}

type InstallState =
  | { status: "laeuft"; version: string; progress: InstallProgress | null; startedAt: string }
  | { status: "fertig"; version: string; finishedAt: string }
  | { status: "fehler"; version: string; message: string; finishedAt: string };

let installState: InstallState | null = null;

export async function ericStatus() {
  const e = env();
  const fromEnv = Boolean(e.ERIC_HOME?.trim());
  const home = ericHome() ?? null;
  return {
    mode: elsterMode(),
    /** env: von Hand eingebunden (ERIC_HOME), download: im Download-Verzeichnis */
    source: fromEnv ? ("env" as const) : home ? ("download" as const) : null,
    home,
    version: home ? await installedEricVersion(home) : null,
    defaultVersion: DEFAULT_ERIC_VERSION,
    platformSupported: process.platform === "linux" && process.arch === "x64",
    install: installState,
  };
}

/**
 * Startet den Download im Hintergrund (rund 300 MB); der Stand steht in ericStatus().
 * Wer startet, hat den Nutzungsbedingungen von ERiC zugestimmt.
 */
export function startEricInstall(version: string): void {
  if (env().ERIC_HOME?.trim()) throw new EricSetupError("ERiC ist über ERIC_HOME eingebunden; zum Herunterladen ERIC_HOME entfernen.");
  if (!isEricVersion(version)) throw new EricSetupError("Die Version hat die Form 43.4.6.0.");
  if (installState?.status === "laeuft") throw new EricSetupError("Der Download läuft schon.");
  const state: InstallState = { status: "laeuft", version, progress: null, startedAt: new Date().toISOString() };
  installState = state;
  void installEric({
    version,
    dir: resolve(env().ERIC_DIR),
    baseUrl: env().ERIC_DOWNLOAD_URL,
    onProgress: (progress) => {
      state.progress = progress;
    },
  }).then(
    () => {
      installState = { status: "fertig", version, finishedAt: new Date().toISOString() };
      console.log(`ERiC ${version} installiert unter ${resolve(env().ERIC_DIR)}`);
    },
    (error: unknown) => {
      const message = error instanceof EricInstallError || error instanceof Error ? error.message : String(error);
      installState = { status: "fehler", version, message, finishedAt: new Date().toISOString() };
      console.error("ERiC-Download", error);
    },
  );
}
