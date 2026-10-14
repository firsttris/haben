import { Link } from "@tanstack/react-router";

const TABS = [
  { to: "/rechnungen", label: "Alle Rechnungen", exact: true },
  { to: "/rechnungen/wiederkehrend", label: "Wiederkehrend", exact: false },
  { to: "/rechnungen/mahnwesen", label: "Mahnwesen", exact: false },
] as const;

/** Reiter der Rechnungsseiten; Kopf und Reiter bleiben beim Wechsel stehen, nur der Inhalt darunter ändert sich */
export function InvoiceTabs() {
  return (
    <nav className="tabs" aria-label="Bereiche der Rechnungen">
      {TABS.map((tab) => (
        <Link key={tab.to} to={tab.to} className="tab" activeOptions={{ exact: tab.exact }} activeProps={{ className: "active" }}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
