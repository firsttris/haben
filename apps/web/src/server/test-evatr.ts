/*
 * Nachgebauter eVatR-Dienst des BZSt für Tests (#1385); keine echte Abfrage. Die Antworten haben die Form der Testabfrage
 * vom 2026-11-18 mit den Beispielwerten der OpenAPI-Beschreibung. Jede Antwort wird einmal verbraucht, eine weitere
 * Abfrage wirft.
 */

export type EvatrTestAntwort = { status: number; body: unknown } | "kein-netz";

export function evatrDienst(...antworten: EvatrTestAntwort[]) {
  const anfragen: Record<string, string>[] = [];
  // Form von EvatrVerbindung (stammdaten/ustid-bestaetigung.ts); gemeinsame Infrastruktur importiert kein Modul
  const via: { fetch: typeof fetch; url: string } = {
    url: "http://evatr.test/app/v1/abfrage",
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
      anfragen.push(JSON.parse(String(init?.body)));
      const antwort = antworten.shift();
      if (!antwort) throw new Error("unerwartete Abfrage");
      if (antwort === "kein-netz") throw new TypeError("fetch failed");
      return new Response(JSON.stringify(antwort.body), { status: antwort.status, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  };
  return { via, anfragen };
}

/** Gültig; zeitpunkt ohne Angabe wie in der Testabfrage */
export const evatrOk = (id: string, erg?: Record<string, string>, zeitpunkt = "2026-11-18T14:34:36.318854732+01:00"): EvatrTestAntwort => ({
  status: 200,
  body: { id, anfrageZeitpunkt: zeitpunkt, status: "evatr-0000", ...erg },
});

export const evatrFehler = (status: number, code: string, zeitpunkt = "2026-11-18T14:34:44.75460082+01:00"): EvatrTestAntwort => ({
  status,
  body: { id: "f1", anfrageZeitpunkt: zeitpunkt, status: code },
});
