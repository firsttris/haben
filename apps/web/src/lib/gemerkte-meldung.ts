import { useSyncExternalStore } from "react";
import type { Notice } from "./use-action.ts";

/*
 * Meldung einer Aktion, die einen Neuaufbau der Komponente übersteht. Nach router.invalidate() baut der Router die Seite
 * gelegentlich neu auf (in der CI belegt: die React-Ids der Seite wechseln von „:R…“ auf „:r…“); eine Meldung im Zustand
 * der Komponente ginge dabei verloren, obwohl die Aktion gelungen ist. Die Meldung steht deshalb hier, je Schlüssel. Der
 * Aufrufer nimmt den Eintrag in der Browser-Historie in den Schlüssel; so gehört die Meldung zu diesem Besuch der Seite
 * und ist nach dem nächsten Aufruf weg.
 */

const meldungen = new Map<string, { notice: Exclude<Notice, null>; besuch: string }>();
const hoerer = new Set<() => void>();

export function merkeMeldung(schluessel: string, besuch: string, notice: Notice): void {
  if (notice) meldungen.set(schluessel, { notice, besuch });
  else meldungen.delete(schluessel);
  for (const hoeren of hoerer) hoeren();
}

export function gemerkteMeldung(schluessel: string, besuch: string): Notice {
  const eintrag = meldungen.get(schluessel);
  return eintrag && eintrag.besuch === besuch ? eintrag.notice : null;
}

function abonnieren(hoeren: () => void) {
  hoerer.add(hoeren);
  return () => {
    hoerer.delete(hoeren);
  };
}

/** Meldung zum Schlüssel in diesem Besuch der Seite und ihr Setzer; übersteht den Neuaufbau der Komponente */
export function useGemerkteMeldung(schluessel: string, besuch: string): [Notice, (notice: Notice) => void] {
  const notice = useSyncExternalStore(
    abonnieren,
    () => gemerkteMeldung(schluessel, besuch),
    () => null,
  );
  return [notice, (next) => merkeMeldung(schluessel, besuch, next)];
}
