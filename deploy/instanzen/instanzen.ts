/**
 * Die Instanzen unter der Basis: je ein Verzeichnis mit compose.yml und .env, deren COMPOSE_PROJECT_NAME
 * haben-<Verzeichnis> ist (von diesem Werkzeug angelegt) oder gleich dem Verzeichnis, wenn es mit haben- beginnt
 * (von Hand nach docs/installation.md, „Von Hand“).
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { envWerte } from "./env-datei.ts";

export interface Instanz {
  name: string;
  dir: string;
  /** Werte der .env, wie Compose sie liest */
  env: Map<string, string>;
}

export function gehoertDazu(name: string, projekt: string | undefined): boolean {
  return projekt === `haben-${name}` || (projekt === name && name.startsWith("haben-"));
}

/** Nach Namen sortiert; versteckte Verzeichnisse (etwa .neu-… während neu) zählen nicht */
export async function instanzen(basis: string): Promise<Instanz[]> {
  let eintraege: string[];
  try {
    eintraege = await readdir(basis);
  } catch {
    return [];
  }
  const gefunden: Instanz[] = [];
  for (const name of eintraege.filter((n) => !n.startsWith(".")).sort()) {
    const dir = join(basis, name);
    if (!existsSync(join(dir, "compose.yml")) || !existsSync(join(dir, ".env"))) continue;
    const env = envWerte(await readFile(join(dir, ".env"), "utf8"));
    if (gehoertDazu(name, env.get("COMPOSE_PROJECT_NAME"))) gefunden.push({ name, dir, env });
  }
  return gefunden;
}
