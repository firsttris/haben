import { inCentRange, parseEuroSearchRange } from "@haben/core";
import { Link } from "@tanstack/react-router";

/** Filter der Belegliste in der Adresse; ohne Angabe „Alle“. „Gebucht“ zählt auch stornierte Belege, die im Code „gebucht“ bleiben. */
export type BelegFilter = "pruefen" | "gebucht";

const FILTER: { filter: BelegFilter | undefined; label: string }[] = [
  { filter: undefined, label: "Alle" },
  { filter: "pruefen", label: "Zu prüfen" },
  { filter: "gebucht", label: "Gebucht" },
];

/** Name des Filters wie auf dem Chip */
export const filterName = (filter: BelegFilter) => FILTER.find((f) => f.filter === filter)?.label ?? "";

/** „Zu prüfen“ sind alle Belege mit Status „neu“, wie die Zahl im Seitenkopf */
export function filterBelege<T extends { status: "neu" | "gebucht" }>(documents: T[], filter: BelegFilter | undefined): T[] {
  if (!filter) return documents;
  return documents.filter((doc) => doc.status === (filter === "pruefen" ? "neu" : "gebucht"));
}

/** Suchfeld über der Liste: Lieferant, Belegnummer, Dateiname oder Betrag (auch als Spanne) */
export function sucheBelege<T extends { supplierName: string; invoiceNumber: string | null; filename: string; gross: number }>(
  documents: T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return documents;
  const range = parseEuroSearchRange(query);
  return documents.filter(
    (doc) =>
      [doc.supplierName, doc.invoiceNumber, doc.filename].some((v) => v?.toLowerCase().includes(needle)) || (range !== null && inCentRange(range, doc.gross)),
  );
}

/** Chips wie in der Bank und bei den Kontakten; Suche und Sortierung bleiben beim Wechsel in der Adresse */
export function BelegFilterChips({ openCount }: { openCount: number }) {
  return (
    <nav aria-label="Filter" className="chip-row">
      {FILTER.map((f) => (
        <Link
          key={f.label}
          to="/belege"
          search={(prev: Record<string, unknown>) => ({ ...prev, status: f.filter }) as { status?: BelegFilter }}
          // exact: Sonst gälte „Alle“ (Adresse ohne Filter) auch bei „Zu prüfen“ als aktuell, mit Klasse „active“ und aria-current
          activeOptions={{ exact: true }}
          className="chip"
        >
          {f.filter === "pruefen" ? `${f.label} · ${openCount}` : f.label}
        </Link>
      ))}
    </nav>
  );
}

/** Der Satz der leeren Liste; ohne Aussage über die Auslesung, die hängt davon ab, ob eine KI eingerichtet ist */
export function leerSatz(filter: BelegFilter | undefined, inhaber: boolean): string {
  if (filter === "pruefen") return "Alles geprüft. Kein Beleg wartet auf dich.";
  if (filter === "gebucht") return "Noch kein Beleg gebucht. Gebucht wird, sobald du einen Beleg prüfst und bestätigst.";
  if (!inhaber) return "Noch keine Belege.";
  return "Noch keine Belege. Lege den ersten oben ab, zum Beispiel die PDF einer Stromrechnung oder ein Foto vom Tankbeleg. Danach prüfst du die Angaben und buchst den Beleg.";
}

/** Leere Liste: der erste Schritt mit Beispiel und der zweite Weg (Postfach); mit Filter der Satz zum Filter */
export function BelegeLeer({ filter, inhaber, hatPostfach }: { filter: BelegFilter | undefined; inhaber: boolean; hatPostfach: boolean }) {
  return (
    <>
      <p className="muted" style={{ margin: 0 }}>
        {leerSatz(filter, inhaber)}
      </p>
      {!filter && inhaber && !hatPostfach && (
        <div style={{ margin: "12px 0 0" }}>
          <Link to="/einstellungen" search={{ bereich: "email" }} className="btn">
            Postfach für Belege einrichten
          </Link>
          <p className="small muted" style={{ margin: "6px 0 0" }}>
            Dann holt Haben Rechnungen aus deinem E-Mail-Postfach selbst ab.
          </p>
        </div>
      )}
    </>
  );
}
