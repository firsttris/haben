/**
 * status: je Instanz Version, Erreichbarkeit, ERiC und letzte Sicherung. Version, ERiC und Sicherung kommen aus der
 * App selbst (`haben status --json`, apps/web/src/server/modules/betrieb); das Werkzeug kennt weder ihre Pfade noch
 * ihre Tabellen.
 */
import { compose, type Ergebnis } from "./ausfuehren.ts";
import { instanzen } from "./instanzen.ts";
import type { Kontext } from "./kontext.ts";
import { spalten } from "./liste.ts";
import { dienste, lauf } from "./zustand.ts";

const BREITEN = [20, 32, 10, 11, 12];

interface AppStand {
  version: string;
  eric: string;
  sicherung: string;
}

/** Antwort von `haben status --json`; ein Image ohne den Befehl kennt docker nicht (Code 126/127) */
export function standAus(r: Ergebnis): AppStand {
  if (r.code !== 0) {
    const zuAlt = r.code === 126 || r.code === 127 || /executable file not found/.test(r.stderr);
    return { version: zuAlt ? "? (Image zu alt)" : "?", eric: "?", sicherung: "?" };
  }
  try {
    const s = JSON.parse(r.stdout) as { version?: unknown; summary?: { eric?: unknown; backup?: unknown } };
    const text = (w: unknown) => (typeof w === "string" && w !== "" ? w : "?");
    return { version: text(s.version), eric: text(s.summary?.eric), sicherung: text(s.summary?.backup) };
  } catch {
    return { version: "?", eric: "?", sicherung: "?" };
  }
}

async function erreichbar(k: Kontext, domain: string): Promise<string> {
  const code = await k.abrufen(`https://${domain}/login`);
  return code === 200 ? "ja" : `nein (${String(code ?? 0).padStart(3, "0")})`;
}

export async function status(k: Kontext): Promise<void> {
  k.aus(spalten(["Instanz", "Domain", "Version", "Erreichbar", "ERiC", "Letzte Sicherung"], BREITEN));
  for (const { name, dir, env } of await instanzen(k.basis)) {
    const domain = env.get("DOMAIN") ?? "";
    const erreichbarText = await erreichbar(k, domain);
    let stand: AppStand;
    switch (lauf(await dienste(k, dir), "app")) {
      case "laeuft":
        stand = standAus(await compose(k, dir, ["exec", "-T", "app", "haben", "status", "--json"]));
        break;
      case "fehler":
        stand = { version: "Fehler", eric: "–", sicherung: "? (Compose-Fehler)" };
        break;
      case "neustart":
        stand = { version: "startet neu", eric: "–", sicherung: "–" };
        break;
      case "gestoppt":
        stand = { version: "gestoppt", eric: "–", sicherung: "–" };
        break;
    }
    k.aus(spalten([name, domain, stand.version, erreichbarText, stand.eric, stand.sicherung], BREITEN));
  }
}
