/**
 * Zustand der Dienste einer Instanz aus `docker compose ps -a --format json`. Ältere Compose-Versionen geben ein
 * JSON-Array aus, neuere (ab 2.21) ein Objekt je Zeile; beides wird gelesen.
 */
import { compose } from "./ausfuehren.ts";
import type { Kontext } from "./kontext.ts";

export interface Dienst {
  /** running, restarting, exited, created, paused, dead */
  state: string;
  /** healthy, unhealthy, starting oder leer ohne Healthcheck */
  health: string;
}

/** null: Compose meldet einen Fehler (etwa eine fehlerhafte .env) oder eine Ausgabe, die sich nicht lesen lässt */
export type Dienste = Map<string, Dienst> | null;

export function diensteAusPs(stdout: string): Dienste {
  const text = stdout.trim();
  let eintraege: unknown[];
  try {
    eintraege = text === "" ? [] : text.startsWith("[") ? JSON.parse(text) : text.split("\n").map((z) => JSON.parse(z));
  } catch {
    return null;
  }
  if (!Array.isArray(eintraege)) return null;
  const dienste = new Map<string, Dienst>();
  for (const e of eintraege) {
    const { Service, State, Health } = (e ?? {}) as Record<string, unknown>;
    if (typeof Service !== "string" || typeof State !== "string") return null;
    if (!dienste.has(Service)) dienste.set(Service, { state: State, health: typeof Health === "string" ? Health : "" });
  }
  return dienste;
}

export async function dienste(k: Kontext, dir: string): Promise<Dienste> {
  const r = await compose(k, dir, ["ps", "-a", "--format", "json"]);
  return r.code === 0 ? diensteAusPs(r.stdout) : null;
}

/**
 * laeuft, gestoppt (auch: nie gestartet), neustart (der Container startet ständig neu, etwa nach einer
 * fehlgeschlagenen Migration; das ist ein Fehler, keine gestoppte Instanz) oder fehler (Compose meldet einen Fehler)
 */
export type Lauf = "laeuft" | "gestoppt" | "neustart" | "fehler";

export function lauf(d: Dienste, dienst: string): Lauf {
  if (!d) return "fehler";
  const s = d.get(dienst)?.state;
  return s === "running" ? "laeuft" : s === "restarting" ? "neustart" : "gestoppt";
}

/** Wartet, bis die App gesund ist; false, sobald sie beendet ist oder neu startet, oder nach der Wartezeit */
export async function wartenAufApp(k: Kontext, dir: string): Promise<boolean> {
  const schritte = Math.floor(k.warten / (k.takt > 0 ? k.takt : 1));
  for (let i = 0; i <= schritte; i++) {
    const app = (await dienste(k, dir))?.get("app");
    if (app?.state === "running" && app.health === "healthy") return true;
    if (app && ["exited", "dead", "restarting"].includes(app.state)) return false;
    await k.schlafen(k.takt * 1000);
  }
  return false;
}
