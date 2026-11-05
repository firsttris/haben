/*
 * Gemeinsame Bausteine der Prüfungen: das Ergebnis (Befunde und Warnungen) und der Abruf einer Quelle. Der Abruf
 * bekommt `fetch` von außen, damit die Tests Antworten nachstellen können.
 */

/** Etwas, das in Haben zu aktualisieren ist; wird zu einem Issue mit der Kennung im Titel */
export interface Befund {
  /** Feste Kennung, z. B. `pap-2027`; ein offenes Issue mit derselben Kennung bekommt kein zweites */
  schluessel: string;
  titel: string;
  /** Markdown: Quelle, was zu tun ist, Verweis auf docs/entwicklung.md */
  text: string;
}

/** Was eine Prüfung liefert; eine Quelle, die gerade nicht antwortet, ist eine Warnung, kein Befund */
export interface Ergebnis {
  befunde: Befund[];
  warnungen: string[];
}

export type Holen = (url: string, init?: RequestInit) => Promise<Response>;

/** Antwort einer Quelle, auf das reduziert, was die Prüfungen auswerten */
export type Abruf = { art: "antwort"; status: number; ort: string | null; inhalt: Uint8Array<ArrayBuffer>; typ: string } | { art: "fehler"; meldung: string };

export const LEER: Ergebnis = { befunde: [], warnungen: [] };

export const zusammen = (ergebnisse: readonly Ergebnis[]): Ergebnis => ({
  befunde: ergebnisse.flatMap((e) => e.befunde),
  warnungen: ergebnisse.flatMap((e) => e.warnungen),
});

export const warnung = (meldung: string): Ergebnis => ({ befunde: [], warnungen: [meldung] });
export const befund = (b: Befund): Ergebnis => ({ befunde: [b], warnungen: [] });

const ZEITLIMIT_MS = 30_000;
const PAUSE_VOR_WIEDERHOLUNG_MS = 2_000;

/**
 * `holen`, das bei einem Netzwerkfehler oder 5xx nach einer Pause einmal wiederholt: gesetze-im-internet.de setzt
 * gelegentlich die Verbindung zurück, bundesfinanzministerium.de antwortet oft kurz mit 503. Antwortet die Quelle
 * auch dann nicht, wird daraus eine Warnung.
 */
export const mitWiederholung =
  (holen: Holen, pause = PAUSE_VOR_WIEDERHOLUNG_MS): Holen =>
  async (url, init) => {
    try {
      const antwort = await holen(url, init);
      if (antwort.status < 500) return antwort;
      await antwort.body?.cancel();
    } catch {
      // ein zweiter Versuch folgt
    }
    await new Promise((fertig) => setTimeout(fertig, pause));
    return holen(url, init);
  };

/**
 * Ruft eine URL ohne Weiterleitung ab (die Quellen melden „gibt es nicht“ teils mit 302/303 auf eine Fehlerseite).
 * Ohne `mitInhalt` wird der Körper verworfen, ohne ihn zu lesen: Das ERiC-Paket hat rund 500 MB, falls ein Server
 * `Range` nicht beachtet.
 */
export async function abrufen(holen: Holen, url: string, init: RequestInit = {}, mitInhalt = true): Promise<Abruf> {
  try {
    const antwort = await holen(url, { redirect: "manual", signal: AbortSignal.timeout(ZEITLIMIT_MS), ...init });
    const inhalt = mitInhalt ? new Uint8Array(await antwort.arrayBuffer()) : new Uint8Array();
    if (!mitInhalt) await antwort.body?.cancel();
    return { art: "antwort", status: antwort.status, ort: antwort.headers.get("location"), inhalt, typ: antwort.headers.get("content-type") ?? "" };
  } catch (e) {
    return { art: "fehler", meldung: e instanceof Error ? e.message : String(e) };
  }
}

/** Kurzbeschreibung für eine Warnung: Status oder Fehlermeldung */
export const beschreibe = (a: Abruf): string => (a.art === "fehler" ? a.meldung : `HTTP ${a.status}`);

const CHARSET = /charset=["']?([\w-]+)/i;

/**
 * Text einer Antwort; gesetze-im-internet.de liefert ISO-8859-1, die übrigen Quellen UTF-8. Der Zeichensatz kommt aus
 * dem Content-Type, sonst aus dem meta-Element am Anfang der Seite: gesetze-im-internet.de sendet bei 200 nur
 * `text/html` ohne charset, hat aber rohe ISO-8859-1-Bytes in den Überschriften („Bürgerliches Gesetzbuch“).
 */
export function text(a: Abruf & { art: "antwort" }): string {
  const kopf = new TextDecoder("windows-1252").decode(a.inhalt.subarray(0, 1024));
  const zeichensatz = (CHARSET.exec(a.typ) ?? CHARSET.exec(kopf))?.[1]?.toLowerCase() ?? "utf-8";
  const latin1 = zeichensatz === "iso-8859-1" || zeichensatz === "latin1" || zeichensatz === "windows-1252";
  return new TextDecoder(latin1 ? "windows-1252" : "utf-8").decode(a.inhalt);
}

export async function sha256(inhalt: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", inhalt);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Führt `aufgaben` mit höchstens `parallel` gleichzeitigen Abrufen aus, Ergebnisse in der Reihenfolge der Eingabe */
export async function begrenzt<T, E>(eingaben: readonly T[], parallel: number, aufgabe: (t: T) => Promise<E>): Promise<E[]> {
  const ergebnisse: E[] = new Array(eingaben.length);
  let naechste = 0;
  const arbeiter = async () => {
    while (naechste < eingaben.length) {
      const i = naechste++;
      ergebnisse[i] = await aufgabe(eingaben[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, eingaben.length) }, arbeiter));
  return ergebnisse;
}

/** Fußzeile jedes Befunds: wo das Vorgehen beschrieben ist */
export const DOKU = "https://firsttris.github.io/haben/entwicklung.html";
export const DOKU_JAHRESWERTE = `${DOKU}#jahreswerte-erinnerung-per-workflow`;
