/**
 * status: je Instanz Version, Erreichbarkeit, ERiC und letzte Sicherung. Version, ERiC und Sicherung kommen aus der
 * App selbst (`haben status --json`, apps/web/src/server/modules/betrieb); das Werkzeug kennt weder ihre Pfade noch
 * ihre Tabellen.
 */
import { compose, type Ergebnis } from "./ausfuehren.ts";
import { instanzen } from "./instanzen.ts";
import type { Kontext } from "./kontext.ts";
import { tabelle } from "./liste.ts";
import { dienste, lauf } from "./zustand.ts";

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
    const s = JSON.parse(r.stdout) as { version?: unknown; commit?: unknown; summary?: { eric?: unknown; backup?: unknown } };
    const text = (w: unknown) => (typeof w === "string" && w !== "" ? w : "?");
    // Kurze Kennung des Commits (#887), damit sich etwa edge und das letzte Release unterscheiden; ältere Images ohne
    // das Feld zeigen nur die Version
    const commit = typeof s.commit === "string" && s.commit !== "" ? ` (${s.commit.slice(0, 7)})` : "";
    return { version: `${text(s.version)}${commit}`, eric: text(s.summary?.eric), sicherung: text(s.summary?.backup) };
  } catch {
    return { version: "?", eric: "?", sicherung: "?" };
  }
}

/**
 * Erreichbar, wenn /login über den Proxy antwortet: 200, oder eine Weiterleitung der App, die nicht verfolgt wird
 * (bis zur Einrichtung leitet /login nach /setup weiter, apps/web/src/routes/login.tsx)
 */
async function erreichbar(k: Kontext, domain: string): Promise<string> {
  const code = await k.abrufen(`https://${domain}/login`);
  return code !== null && code >= 200 && code < 400 ? "ja" : `nein (${String(code ?? 0).padStart(3, "0")})`;
}

export async function status(k: Kontext): Promise<void> {
  const zeilen = [["Instanz", "Domain", "Version", "Erreichbar", "ERiC", "Letzte Sicherung"]];
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
    zeilen.push([name, domain, stand.version, erreichbarText, stand.eric, stand.sicherung]);
  }
  for (const zeile of tabelle(zeilen)) k.aus(zeile);
}
