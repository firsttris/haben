/**
 * Schalter „Heute“ / „31.12.“ über den offenen Posten der Auswertungen (#1110). Absichtlich zwei <a> statt Link: Der
 * Router setzt an einem Link, dessen Suche in der aktuellen enthalten ist, selbst aria-current, dann bliebe „Heute“
 * neben „31.12.“ als aktiv markiert. Der Stand ist ein Zustand in der Adresse; so setzt ihn die Seite, und der
 * Schalter funktioniert ohne JavaScript.
 */
export function StandSchalter({ year, stichtag }: { year: number; stichtag: string | null }) {
  return (
    <div className="mode-switch" role="group" aria-label="Stand der offenen Posten">
      <a href={`/auswertungen?jahr=${year}`} className={stichtag ? "chip" : "chip active"} aria-current={stichtag ? undefined : "page"}>
        Heute
      </a>
      <a href={`/auswertungen?jahr=${year}&stichtag=31.12.`} className={stichtag ? "chip active" : "chip"} aria-current={stichtag ? "page" : undefined}>
        31.12.{year}
      </a>
    </div>
  );
}

/** Hinweis unter der Kopfzeile, solange der Abschlussstand gilt */
export function StandHinweis({ year }: { year: number }) {
  return (
    <p className="small muted stand-hinweis">
      Stand 31.12.{year}: Die offenen Posten aller drei Tabellen rechnen zum Jahresende; Zahlungen und Belege danach zählen nicht.
    </p>
  );
}
