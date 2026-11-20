import type { FinTSClient } from "lib-fints";

/*
 * lib-fints 1.5.3 setzt einen Auftrag bei einem entkoppelten TAN-Verfahren immer mit einer Statusabfrage fort (HKTAN
 * Prozess S, dist/dialog.js, createCurrentTanMessage), auch wenn eine TAN mitkommt. Die Consorsbank führt ihr App-Verfahren
 * in den BPD als entkoppelt, verlangt bei der Anmeldung aber eine TAN aus der App zum Eintippen (0030 ohne 3955) und lehnt
 * die Statusabfrage mit 9010 ab (Speicherstadt/haben#654, so auch python-fints#218). Kommt eine TAN, gilt das Verfahren
 * deshalb nur für die Fortsetzung als nicht entkoppelt, und lib-fints schickt sie mit Prozess 2.
 * Die Datei fällt weg, sobald lib-fints mit einer TAN selbst Prozess 2 schickt.
 */

/** Führt die Fortsetzung aus; mit TAN bei einem entkoppelten Verfahren so, dass die TAN mit Prozess 2 an die Bank geht */
export async function mitEingetippterTan<T>(client: FinTSClient, tan: string | undefined, fortsetzen: () => Promise<T>): Promise<T> {
  const verfahren = client.config.selectedTanMethod;
  if (!tan || !verfahren?.isDecoupled) return fortsetzen();
  verfahren.isDecoupled = false;
  try {
    return await fortsetzen();
  } finally {
    // Das Verfahren gehört zu den BPD, die Haben mit der Verbindung speichert: Dort bleibt es entkoppelt
    verfahren.isDecoupled = true;
  }
}
