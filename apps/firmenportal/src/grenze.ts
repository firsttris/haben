/*
 * Begrenzung der Anmeldewege je Client-Adresse, wie Haben (rateLimit in apps/web/src/server/auth.ts: 20 je Minute). Das
 * Firmenportal hat keine Datenbank, die Zähler liegen im Speicher und gelten je Prozess; nach einem Neustart beginnen
 * sie neu. Hinter dem Reverse Proxy kommt die Adresse aus X-Forwarded-For (docs/installation.md: genau eine Adresse,
 * die des Clients); hängt ein Proxy an, gilt die letzte, die er selbst gesetzt hat.
 */

export const GRENZE_ANZAHL = 20;
export const GRENZE_FENSTER_MS = 60_000;
/** Mehr Schlüssel hält der Speicher nicht; abgelaufene fallen vorher heraus */
const HOECHSTENS = 10_000;

export type Begrenzer = (schluessel: string, jetzt: number) => { erlaubt: true } | { erlaubt: false; wiederInSekunden: number };

/** Festes Fenster je Schlüssel: höchstens `anzahl` Anfragen je `fensterMs` */
export function begrenzer(anzahl = GRENZE_ANZAHL, fensterMs = GRENZE_FENSTER_MS): Begrenzer {
  const zaehler = new Map<string, { bis: number; anzahl: number }>();
  return (schluessel, jetzt) => {
    if (zaehler.size >= HOECHSTENS) {
      for (const [k, z] of zaehler) if (z.bis <= jetzt) zaehler.delete(k);
      // Viele Adressen zugleich: lieber alle Zähler verwerfen als unbegrenzt Speicher belegen
      if (zaehler.size >= HOECHSTENS) zaehler.clear();
    }
    const z = zaehler.get(schluessel);
    if (!z || z.bis <= jetzt) {
      zaehler.set(schluessel, { bis: jetzt + fensterMs, anzahl: 1 });
      return { erlaubt: true };
    }
    if (z.anzahl >= anzahl) return { erlaubt: false, wiederInSekunden: Math.max(1, Math.ceil((z.bis - jetzt) / 1000)) };
    z.anzahl++;
    return { erlaubt: true };
  };
}

/** Die Client-Adresse: letzte aus X-Forwarded-For, sonst die der Verbindung, sonst eine für alle */
export function clientAdresse(request: Request, verbindung?: string): string {
  const weitergeleitet = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return weitergeleitet || verbindung || "unbekannt";
}
