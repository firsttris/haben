/**
 * Externe Befehle (docker) über eine ersetzbare Funktion: Das Werkzeug ruft nur `Ausfuehren` auf, die Tests geben
 * einen Nachbau von docker hinein.
 */
import type { Kontext } from "./kontext.ts";

export interface Ergebnis {
  code: number;
  stdout: string;
  stderr: string;
}

export interface AusfuehrenOptionen {
  cwd: string;
  /** Die ganze Umgebung des Befehls; nichts aus der Shell kommt dazu */
  env: Record<string, string>;
  /** Ausgabe direkt im Terminal zeigen statt einzusammeln (Pull, Start, Backup); stdout und stderr bleiben dann leer */
  sichtbar?: boolean;
}

export type Ausfuehren = (befehl: string[], optionen: AusfuehrenOptionen) => Promise<Ergebnis>;

/**
 * Was aus der Shell an docker geht. Compose gibt Variablen aus der Shell Vorrang vor der .env: Ein exportiertes
 * COMPOSE_PROJECT_NAME, COMPOSE_FILE, DOMAIN oder ENCRYPTION_KEY liefe sonst gegen das Projekt oder mit den
 * Schlüsseln einer anderen Firma. Deshalb eine Positivliste statt einer Liste zum Entfernen; die DOCKER_*-Werte
 * wählen nur den Daemon und die Zugangsdaten des Clients.
 */
export const DURCHGELASSEN = ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY"] as const;

export function umgebungFuerDocker(shell: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(DURCHGELASSEN.flatMap((key) => (shell[key] === undefined ? [] : [[key, shell[key]]])));
}

/** Ausfuehren mit Bun.spawn; fehlt das Programm, Code 127 wie in der Shell */
export const bunAusfuehren: Ausfuehren = async (befehl, { cwd, env, sichtbar }) => {
  let prozess: Bun.Prozess;
  try {
    prozess = Bun.spawn(befehl, { cwd, env, stdin: "ignore", stdout: sichtbar ? "inherit" : "pipe", stderr: sichtbar ? "inherit" : "pipe" });
  } catch (error) {
    return { code: 127, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
  const text = (strom: unknown) => (strom instanceof ReadableStream ? new Response(strom).text() : Promise.resolve(""));
  const [stdout, stderr, code] = await Promise.all([text(prozess.stdout), text(prozess.stderr), prozess.exited]);
  return { code, stdout, stderr };
};

/** docker compose im Verzeichnis einer Instanz: Compose liest dort compose.yml, die Override-Datei und .env */
export function compose(k: Kontext, dir: string, args: string[], sichtbar = false): Promise<Ergebnis> {
  return k.ausfuehren(["docker", "compose", ...args], { cwd: dir, env: umgebungFuerDocker(k.shell), sichtbar });
}

/** docker ohne Projekt (Volumes, Netze, Liste der Projekte); im Wurzelverzeichnis, damit keine compose.yml mitliest */
export function docker(k: Kontext, args: string[]): Promise<Ergebnis> {
  return k.ausfuehren(["docker", ...args], { cwd: "/", env: umgebungFuerDocker(k.shell) });
}
