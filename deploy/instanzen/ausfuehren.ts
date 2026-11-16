/**
 * Externe Befehle (docker) über eine ersetzbare Funktion: Das Werkzeug ruft nur `Ausfuehren` auf, die Tests geben
 * einen Nachbau von docker hinein.
 */
import type { Kontext } from "./kontext.ts";

export interface Ergebnis {
  code: number;
  stdout: string;
  stderr: string;
  /** stdout als Bytes, nur mit `binaer` (dann bleibt stdout leer): Text würde ein Logo zerstören */
  daten?: Uint8Array;
}

export interface AusfuehrenOptionen {
  cwd: string;
  /** Die ganze Umgebung des Befehls; nichts aus der Shell kommt dazu */
  env: Record<string, string>;
  /** Ausgabe direkt im Terminal zeigen statt einzusammeln (Pull, Start, Backup); stdout und stderr bleiben dann leer */
  sichtbar?: boolean;
  /** Text für die Standardeingabe des Befehls, etwa ein Passwort, das nicht in den Argumenten stehen soll */
  eingabe?: string;
  /** stdout als Bytes in `daten` statt als Text, etwa für `haben kennzeichen` */
  binaer?: boolean;
  /** Nach so vielen Millisekunden den Befehl abbrechen; das Ergebnis hat dann `ZEITLIMIT` als Code */
  zeitlimit?: number;
}

/** Code im Ergebnis eines Befehls, den das Zeitlimit abgebrochen hat; kein echter Exit-Code */
export const ZEITLIMIT = -1;

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

/**
 * So lange nach SIGTERM auf das Ende warten, dann SIGKILL und das Lesen abbrechen. Die docker-CLI endet beim ersten
 * SIGTERM nicht, sie schließt nur den Socket zum Plugin und wartet auf docker-compose; das hält stdout offen
 * (docker/cli, cmd/docker/docker.go, tryPluginRun).
 */
export const NACHFRIST_MS = 2000;

/** Liest einen Strom ganz; `abbrechen` beendet das Lesen vorzeitig, das Ergebnis enthält dann, was bis dahin kam */
function sammeln(strom: unknown): { bytes: Promise<Uint8Array>; abbrechen: () => void } {
  if (!(strom instanceof ReadableStream)) return { bytes: Promise.resolve(new Uint8Array()), abbrechen: () => {} };
  const leser = (strom as ReadableStream<Uint8Array>).getReader();
  const bytes = (async () => {
    const teile: Uint8Array[] = [];
    for (let r = await leser.read(); !r.done; r = await leser.read()) teile.push(r.value);
    const alle = new Uint8Array(teile.reduce((summe, t) => summe + t.length, 0));
    let stelle = 0;
    for (const t of teile) {
      alle.set(t, stelle);
      stelle += t.length;
    }
    return alle;
  })();
  return { bytes, abbrechen: () => void leser.cancel().catch(() => {}) };
}

/** Ausfuehren mit Bun.spawn; fehlt das Programm, Code 127 wie in der Shell */
export const bunAusfuehren: Ausfuehren = async (befehl, { cwd, env, sichtbar, eingabe, binaer, zeitlimit }) => {
  const stdin = eingabe === undefined ? "ignore" : new TextEncoder().encode(eingabe);
  let prozess: Bun.Prozess;
  try {
    prozess = Bun.spawn(befehl, { cwd, env, stdin, stdout: sichtbar ? "inherit" : "pipe", stderr: sichtbar ? "inherit" : "pipe" });
  } catch (error) {
    return { code: 127, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
  const aus = sammeln(prozess.stdout);
  const fehler = sammeln(prozess.stderr);
  let abgelaufen = false;
  let beendet = false;
  void prozess.exited.then(() => {
    beendet = true;
  });
  let nachfassen: ReturnType<typeof setTimeout> | undefined;
  const uhr =
    zeitlimit === undefined
      ? undefined
      : setTimeout(() => {
          // Bis hierher kam kein vollständiges Ergebnis; endete der Befehl schon, hält ein Kindprozess die Ausgabe offen
          abgelaufen = true;
          if (!beendet) prozess.kill();
          nachfassen = setTimeout(() => {
            if (!beendet) prozess.kill("SIGKILL");
            aus.abbrechen();
            fehler.abbrechen();
          }, NACHFRIST_MS);
        }, zeitlimit);
  try {
    const [daten, stderr, code] = await Promise.all([aus.bytes, fehler.bytes.then((b) => new TextDecoder().decode(b)), prozess.exited]);
    const ergebnis = { code: abgelaufen ? ZEITLIMIT : code, stderr };
    return binaer ? { ...ergebnis, stdout: "", daten } : { ...ergebnis, stdout: new TextDecoder().decode(daten) };
  } finally {
    clearTimeout(uhr);
    clearTimeout(nachfassen);
  }
};

/** docker compose im Verzeichnis einer Instanz: Compose liest dort compose.yml, die Override-Datei und .env */
export function compose(
  k: Kontext,
  dir: string,
  args: string[],
  sichtbar = false,
  { eingabe, binaer, zeitlimit }: Pick<AusfuehrenOptionen, "eingabe" | "binaer" | "zeitlimit"> = {},
): Promise<Ergebnis> {
  return k.ausfuehren(["docker", "compose", ...args], {
    cwd: dir,
    env: umgebungFuerDocker(k.shell),
    sichtbar,
    eingabe,
    ...(binaer ? { binaer } : {}),
    ...(zeitlimit === undefined ? {} : { zeitlimit }),
  });
}

/** docker ohne Projekt (Volumes, Netze, Liste der Projekte); im Wurzelverzeichnis, damit keine compose.yml mitliest */
export function docker(k: Kontext, args: string[]): Promise<Ergebnis> {
  return k.ausfuehren(["docker", ...args], { cwd: "/", env: umgebungFuerDocker(k.shell) });
}
