/*
 * Nachgestellte sevDesk-API für Tests (#472). Ein Test beantwortet nur die Pfade, auf die es ihm ankommt; alles andere
 * beantwortet diese Grundlage wie ein leeres Konto in Buchhaltungsversion 1.0:
 * - jede Sammlung (`/Contact`, `/TaxSet`, …) und die Positionen einer Rechnung oder eines Auftrags als leere Liste,
 * - GET /AccountingType/{id} als gewöhnliches Aufwandskonto (Sonstiger Betriebsbedarf, SKR03 4980, SKR04 6850),
 * - übrige Unterpfade (Dateien, einzelne Objekte) mit 404.
 * So bricht ein neuer Abrufschritt nicht die Tests der anderen Schritte. Die Antwort des Tests kommt immer zuerst; gibt
 * er `undefined` zurück, antwortet die Grundlage.
 */

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export type SevdeskFakeRequest = {
  /** Pfad ohne `/api/v1`, etwa `/Voucher/ID_1` */
  path: string;
  url: URL;
  method: string;
  headers: Headers;
  /** Liste wie sevDesk: die Objekte auf der ersten Seite (`offset=0`), danach leer */
  list: (objects: unknown[]) => Response;
};

export type SevdeskFakeAnswer = (request: SevdeskFakeRequest) => Response | undefined | Promise<Response | undefined>;

export function sevdeskFakeFetch(answer: SevdeskFakeAnswer = () => undefined): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const list = (objects: unknown[]) => json({ objects: url.searchParams.get("offset") === "0" ? objects : [] });
    const own = await answer({ path, url, method: init?.method ?? "GET", headers: new Headers(init?.headers), list });
    if (own) return own;
    if (path === "/Tools/bookkeepingSystemVersion") return json({ objects: { version: "1.0" } });
    const account = /^\/AccountingType\/([^/]+)$/.exec(path);
    if (account) return json({ objects: [{ id: account[1], objectName: "AccountingType", skr03: "4980", skr04: "6850" }] });
    if (/^\/[A-Za-z]+$/.test(path) || /^\/(Invoice|Order)\/[^/]+\/getPositions$/.test(path)) return list([]);
    return json({ error: { message: `unbekannt ${path}` } }, 404);
  }) as typeof fetch;
}
