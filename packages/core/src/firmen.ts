/*
 * Firmen wechseln (#504): Jede Firma ist eine eigene Instanz von Haben mit eigener Adresse. Haben (HABEN_FIRMEN) und das
 * Portal (PORTAL_FIRMEN, apps/portal) kennen dabei nur Namen, Adressen und Gruppen, keine Daten der Firmen. Ohne
 * Serverbezug, damit beide dieselben Regeln prüfen.
 */

export interface Firma {
  name: string;
  /** Origin der Instanz, z. B. https://nord.example.de */
  url: string;
}

/** Eine Firma im Portal: wer in `gruppe` ist (die Inhaber-Gruppe der Instanz beim Anmeldedienst), sieht sie */
export interface PortalFirma extends Firma {
  gruppe: string;
}

const MAX_FIRMEN = 50;
const MAX_NAME = 60;
/** Gruppennamen beim Anmeldedienst; Authelia, Keycloak und Co. lassen längere zu, Haben braucht sie nicht */
const MAX_GRUPPE = 100;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
// Zeichen einer Domain (Umlaute stehen nach new URL als Punycode da). Die URL-Norm lässt im Host auch ' " ! und
// ähnliche zu; so bliebe ein Anführungszeichen aus der .env unbemerkt an der letzten Adresse hängen
const DOMAIN = /^[a-z0-9._-]+$/;

/**
 * Die Origin einer Instanz oder des Portals: nur https://domain ohne Pfad, Query, Fragment und Zugangsdaten, HTTP nur
 * für localhost. `null`, wenn die Adresse das nicht ist.
 */
export function parseOrigin(adresse: string): string | null {
  if (!URL.canParse(adresse)) return null;
  const url = new URL(adresse);
  const https = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
  const host = DOMAIN.test(url.hostname) || LOOPBACK.has(url.hostname);
  if (!https || !host || url.username || url.password || url.search || url.hash || url.pathname !== "/" || adresse.includes("?") || adresse.includes("#")) {
    return null;
  }
  return url.origin;
}

const ORIGIN_FEHLER = "nur https://domain ohne Pfad, Query und Zugangsdaten (http nur für localhost)";

function eintraegeVon(text: string): string[] {
  return text
    .split(";")
    .map((e) => e.trim())
    .filter((e) => e !== "");
}

/** Name und Adresse eines Eintrags prüfen, wie sie in HABEN_FIRMEN und PORTAL_FIRMEN stehen */
function firmaAus(eintrag: string, nameRoh: string, adresseRoh: string, firmen: readonly Firma[]): Firma | { fehler: string } {
  const name = nameRoh.trim();
  const adresse = adresseRoh.trim();
  // Steuerzeichen würden in der Navigation unsichtbar oder verschoben erscheinen
  if (name === "" || name.length > MAX_NAME || /\p{Cc}/u.test(name)) return { fehler: `„${eintrag}“: Name mit 1 bis ${MAX_NAME} Zeichen` };
  if (!URL.canParse(adresse)) return { fehler: `„${name}“: keine gültige Adresse` };
  const url = parseOrigin(adresse);
  if (!url) return { fehler: `„${name}“: ${ORIGIN_FEHLER}` };
  if (firmen.some((f) => f.url === url)) return { fehler: `${url} steht mehrfach in der Liste` };
  if (firmen.some((f) => f.name === name)) return { fehler: `„${name}“ steht mehrfach in der Liste` };
  return { name, url };
}

/**
 * Liest HABEN_FIRMEN: Einträge „Name|https://adresse“, getrennt durch „;“. Nur die Adresse der Instanz (Origin) ohne
 * Pfad, Query, Fragment und Zugangsdaten; HTTP nur für localhost. Namen und Adressen je einmal.
 */
export function parseFirmen(text: string): { firmen: Firma[] } | { fehler: string } {
  const firmen: Firma[] = [];
  const eintraege = eintraegeVon(text);
  if (eintraege.length > MAX_FIRMEN) return { fehler: `höchstens ${MAX_FIRMEN} Firmen` };
  for (const eintrag of eintraege) {
    const teile = eintrag.split("|");
    if (teile.length !== 2) return { fehler: `„${eintrag}“: je Firma Name|Adresse, getrennt durch ;` };
    const firma = firmaAus(eintrag, teile[0]!, teile[1]!, firmen);
    if ("fehler" in firma) return firma;
    firmen.push(firma);
  }
  return { firmen };
}

/**
 * Liest PORTAL_FIRMEN: Einträge „Name|https://adresse|gruppe“, getrennt durch „;“. Name und Adresse wie in
 * HABEN_FIRMEN; die Gruppe ist die Inhaber-Gruppe der Instanz (OIDC_GROUP_INHABER dort), ohne Leerraum und je Firma
 * eine eigene. Teilten sich zwei Firmen eine Gruppe, wäre jedes Mitglied Inhaber in beiden (#504, „Mit SSO“).
 */
export function parsePortalFirmen(text: string): { firmen: PortalFirma[] } | { fehler: string } {
  const firmen: PortalFirma[] = [];
  const eintraege = eintraegeVon(text);
  if (eintraege.length > MAX_FIRMEN) return { fehler: `höchstens ${MAX_FIRMEN} Firmen` };
  for (const eintrag of eintraege) {
    const teile = eintrag.split("|");
    if (teile.length !== 3) return { fehler: `„${eintrag}“: je Firma Name|Adresse|Gruppe, getrennt durch ;` };
    const firma = firmaAus(eintrag, teile[0]!, teile[1]!, firmen);
    if ("fehler" in firma) return firma;
    const gruppe = teile[2]!.trim();
    if (gruppe === "" || gruppe.length > MAX_GRUPPE || /[\s\p{Cc}]/u.test(gruppe)) {
      return { fehler: `„${firma.name}“: Gruppe mit 1 bis ${MAX_GRUPPE} Zeichen ohne Leerzeichen` };
    }
    if (firmen.some((f) => f.gruppe === gruppe)) return { fehler: `Gruppe „${gruppe}“ steht mehrfach in der Liste` };
    firmen.push({ ...firma, gruppe });
  }
  return { firmen };
}

/** fehlt: kein Claim; ungueltig: kein Array aus Zeichenketten */
export type GruppenFehler = "fehlt" | "ungueltig";

/**
 * Die Gruppen aus dem Profil des Anmeldedienstes (UserInfo oder ID-Token): `claim` wörtlich nachgeschlagen, nie als
 * Pfad ausgewertet, und nur ein Array aus Zeichenketten, wie es etwa Authelia liefert
 * (https://www.authelia.com/integration/openid-connect/openid-connect-1.0-claims/#groups).
 */
export function gruppenAus(profile: Record<string, unknown>, claim: string): { gruppen: string[] } | { fehler: GruppenFehler } {
  if (!Object.hasOwn(profile, claim)) return { fehler: "fehlt" };
  const gruppen = profile[claim];
  if (!Array.isArray(gruppen) || !gruppen.every((gruppe) => typeof gruppe === "string")) return { fehler: "ungueltig" };
  return { gruppen };
}

/**
 * Die Firmen, die das Portal einer Person zeigt: genau die, in deren Gruppe sie ist (exakt und
 * groß-/kleinschreibungssensitiv), nach Namen sortiert.
 */
export function portalFirmenFuer(gruppen: readonly string[], firmen: readonly PortalFirma[]): Firma[] {
  return firmen
    .filter((firma) => gruppen.includes(firma.gruppe))
    .map(({ name, url }) => ({ name, url }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}
