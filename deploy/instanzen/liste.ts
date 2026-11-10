import { instanzen } from "./instanzen.ts";
import type { Kontext } from "./kontext.ts";

/** Spalten mit fester Breite wie printf '%-20s %-32s …' */
export function spalten(werte: string[], breiten: number[]): string {
  return werte.map((w, i) => (i < breiten.length ? w.padEnd(breiten[i] ?? 0) : w)).join(" ");
}

/** liste: Name, Domain und Verzeichnis */
export async function liste(k: Kontext): Promise<void> {
  for (const i of await instanzen(k.basis)) k.aus(spalten([i.name, i.env.get("DOMAIN") ?? "", i.dir], [20, 32]));
}
