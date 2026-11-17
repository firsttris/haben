import { Link } from "@tanstack/react-router";

/** Filter der Belegliste in der Adresse; ohne Angabe „Alle“. „Gebucht“ zählt auch stornierte Belege, die im Code „gebucht“ bleiben. */
export type BelegFilter = "pruefen" | "gebucht";

/** „Zu prüfen“ sind alle Belege mit Status „neu“, wie die Zahl im Seitenkopf */
export function filterBelege<T extends { status: "neu" | "gebucht" }>(documents: T[], filter: BelegFilter | undefined): T[] {
  if (!filter) return documents;
  return documents.filter((doc) => doc.status === (filter === "pruefen" ? "neu" : "gebucht"));
}

const FILTER: { filter: BelegFilter | undefined; label: string }[] = [
  { filter: undefined, label: "Alle" },
  { filter: "pruefen", label: "Zu prüfen" },
  { filter: "gebucht", label: "Gebucht" },
];

/** Chips wie in der Bank und bei den Kontakten; Suche und Sortierung bleiben beim Wechsel in der Adresse */
export function BelegFilterChips({ filter, openCount }: { filter: BelegFilter | undefined; openCount: number }) {
  return (
    <nav aria-label="Filter" className="chip-row">
      {FILTER.map((f) => (
        <Link
          key={f.label}
          to="/belege"
          search={(prev: Record<string, unknown>) => ({ ...prev, status: f.filter }) as { status?: BelegFilter }}
          // activeProps leer: Sonst setzt der Link „active“ auch an „Alle“, weil die Adresse ohne Filter zu jedem Filter passt
          activeProps={{}}
          className={filter === f.filter ? "chip active" : "chip"}
          aria-current={filter === f.filter ? "page" : undefined}
        >
          {f.filter === "pruefen" ? `${f.label} · ${openCount}` : f.label}
        </Link>
      ))}
    </nav>
  );
}

/** Leere Liste: der erste Schritt mit Beispiel und der zweite Weg (Postfach); mit Filter der Satz zum Filter */
export function BelegeLeer({ filter, inhaber, hatPostfach }: { filter: BelegFilter | undefined; inhaber: boolean; hatPostfach: boolean }) {
  if (filter === "pruefen")
    return (
      <p className="muted" style={{ margin: 0 }}>
        Alles geprüft. Kein Beleg wartet auf dich.
      </p>
    );
  if (filter === "gebucht")
    return (
      <p className="muted" style={{ margin: 0 }}>
        Noch kein Beleg gebucht. Gebucht wird, sobald du einen Beleg prüfst und bestätigst.
      </p>
    );
  if (!inhaber)
    return (
      <p className="muted" style={{ margin: 0 }}>
        Noch keine Belege.
      </p>
    );
  return (
    <>
      <p className="muted" style={{ margin: 0 }}>
        Noch keine Belege. Lege den ersten oben ab: Ziehe eine Rechnung oder Quittung auf das Feld oder wähle „Dateien auswählen“, zum Beispiel die PDF einer
        Stromrechnung oder ein Foto vom Tankbeleg. Haben liest die Angaben aus; du prüfst und buchst sie.
      </p>
      {!hatPostfach && (
        <p style={{ margin: "12px 0 0" }}>
          <Link to="/einstellungen" search={{ bereich: "email" }} className="btn">
            Postfach für Belege einrichten
          </Link>{" "}
          <span className="small muted">Dann holt Haben Rechnungen aus deinem E-Mail-Postfach selbst ab.</span>
        </p>
      )}
    </>
  );
}
