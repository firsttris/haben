/*
 * Firmen wechseln (#504): Jede Firma ist eine eigene Instanz von Haben mit eigener Adresse. HABEN_FIRMEN nennt sie,
 * damit die Navigation zwischen ihnen verlinkt. Haben kennt dabei nur Namen und Adressen, keine Daten der anderen.
 * Ohne Serverbezug: env.ts prüft die Angabe beim Start, getAuthState gibt der Sitzung ihren Teil.
 */
import type { Rolle } from "./rollen.ts";

export interface Firma {
  name: string;
  /** Origin der Instanz, z. B. https://nord.example.de */
  url: string;
}

/** Was eine Sitzung sieht: den Namen der eigenen Firma und, nur der Inhaber, die übrigen zum Wechseln */
export interface FirmenSicht {
  aktuell: string | null;
  andere: Firma[];
}

const MAX_FIRMEN = 50;
const MAX_NAME = 60;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
// Zeichen einer Domain (Umlaute stehen nach new URL als Punycode da). Die URL-Norm lässt im Host auch ' " ! und
// ähnliche zu; so bliebe ein Anführungszeichen aus der .env unbemerkt an der letzten Adresse hängen
const DOMAIN = /^[a-z0-9._-]+$/;

/**
 * Liest HABEN_FIRMEN: Einträge „Name|https://adresse“, getrennt durch „;“. Nur die Adresse der Instanz (Origin) ohne
 * Pfad, Query, Fragment und Zugangsdaten; HTTP nur für localhost. Namen und Adressen je einmal.
 */
export function parseFirmen(text: string): { firmen: Firma[] } | { fehler: string } {
  const firmen: Firma[] = [];
  const eintraege = text
    .split(";")
    .map((e) => e.trim())
    .filter((e) => e !== "");
  if (eintraege.length > MAX_FIRMEN) return { fehler: `höchstens ${MAX_FIRMEN} Firmen` };
  for (const eintrag of eintraege) {
    const teile = eintrag.split("|");
    if (teile.length !== 2) return { fehler: `„${eintrag}“: je Firma Name|Adresse, getrennt durch ;` };
    const name = teile[0]!.trim();
    const adresse = teile[1]!.trim();
    // Steuerzeichen würden in der Navigation unsichtbar oder verschoben erscheinen
    if (name === "" || name.length > MAX_NAME || /\p{Cc}/u.test(name)) return { fehler: `„${eintrag}“: Name mit 1 bis ${MAX_NAME} Zeichen` };
    if (!URL.canParse(adresse)) return { fehler: `„${name}“: keine gültige Adresse` };
    const url = new URL(adresse);
    const https = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
    const host = DOMAIN.test(url.hostname) || LOOPBACK.has(url.hostname);
    if (!https || !host || url.username || url.password || url.search || url.hash || url.pathname !== "/" || adresse.includes("?") || adresse.includes("#")) {
      return { fehler: `„${name}“: nur https://domain ohne Pfad, Query und Zugangsdaten (http nur für localhost)` };
    }
    if (firmen.some((f) => f.url === url.origin)) return { fehler: `${url.origin} steht mehrfach in der Liste` };
    if (firmen.some((f) => f.name === name)) return { fehler: `„${name}“ steht mehrfach in der Liste` };
    firmen.push({ name, url: url.origin });
  }
  return { firmen };
}

/**
 * Teil der Liste für eine Sitzung. Die eigene Firma erkennt Haben an der eigenen Adresse (BETTER_AUTH_URL). Die
 * Steuerberatung sieht nur deren Namen, nicht die übrigen Firmen: Sie kann in jeder Instanz einen eigenen Zugang
 * haben oder keinen.
 */
export function firmenSicht(text: string | undefined, eigeneAdresse: string, rolle: Rolle): FirmenSicht {
  const ergebnis = parseFirmen(text ?? "");
  if ("fehler" in ergebnis || !URL.canParse(eigeneAdresse)) return { aktuell: null, andere: [] };
  const eigene = new URL(eigeneAdresse).origin;
  const aktuell = ergebnis.firmen.find((f) => f.url === eigene)?.name ?? null;
  const andere = rolle === "inhaber" ? ergebnis.firmen.filter((f) => f.url !== eigene) : [];
  return { aktuell, andere };
}
