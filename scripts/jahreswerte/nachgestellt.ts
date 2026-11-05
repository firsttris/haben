/* Nachgestellte Quellen für die Tests der Prüfungen: je URL eine Antwort oder ein Netzwerkfehler */
import type { Holen } from "./abruf.ts";

export type Nachgestellt = { status: number; text?: string; bytes?: Uint8Array<ArrayBuffer>; headers?: Record<string, string> } | { fehler: string };

export const antwort = (status: number, text = "", headers: Record<string, string> = {}): Nachgestellt => ({ status, text, headers });
export const netzwerkfehler: Nachgestellt = { fehler: "Connection reset by peer" };

/** Unbekannte URLs antworten mit 404; `aufrufe` hält fest, was abgefragt wurde */
export function nachgestellt(antworten: Record<string, Nachgestellt>): Holen & { aufrufe: { url: string; init?: RequestInit }[] } {
  const aufrufe: { url: string; init?: RequestInit }[] = [];
  const holen = async (url: string, init?: RequestInit) => {
    aufrufe.push({ url, init });
    const a = antworten[url] ?? antwort(404);
    if ("fehler" in a) throw new TypeError(a.fehler);
    return new Response(a.bytes ?? a.text ?? "", { status: a.status, headers: a.headers });
  };
  return Object.assign(holen, { aufrufe });
}
