/* Hilfsfunktionen des FastBill-Clients (client.ts): Host, Inhaltstyp, Abbruch, Warten und Fehlertexte. */

export function isFastbillHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "fastbill.com" || host.endsWith(".fastbill.com");
}

export function contentType(headers: Headers): string {
  return (headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}

export function abortableSleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function errorMessage(status: number, service: string): string {
  if (status === 401) return "Login-E-Mail oder API-Schlüssel falsch";
  if (status === 403) return "Kein Zugriff – das FastBill-Konto erlaubt keinen API-Zugriff";
  if (status === 429) return `Aufruflimit der FastBill-API überschritten (${service}), auch nach mehreren Versuchen`;
  return `FastBill-API-Fehler ${status} bei ${service}`;
}
