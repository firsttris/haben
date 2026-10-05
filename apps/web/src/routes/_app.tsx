import { Link, Outlet, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { getAuthState } from "../server/functions/setup.ts";

export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    const state = await getAuthState();
    if (!state.initialized) throw redirect({ to: "/setup" });
    if (!state.user) throw redirect({ to: "/login" });
    return { user: state.user };
  },
  component: AppLayout,
});

/** Hauptnavigation nach Arbeitsbereichen; Einstellungen stehen unten bei Konto und Abmelden */
const NAV_GROUPS = [
  {
    label: "Verkauf",
    links: [
      { to: "/angebote", icon: "quote", label: "Angebote" },
      { to: "/rechnungen", icon: "invoice", label: "Rechnungen" },
      { to: "/kontakte", icon: "contacts", label: "Kontakte" },
    ],
  },
  {
    label: "Ausgaben",
    links: [
      { to: "/belege", icon: "receipt", label: "Belege" },
      { to: "/pauschalen", icon: "pauschale", label: "Pauschalen" },
      { to: "/anlagen", icon: "assets", label: "Anlagen" },
    ],
  },
  {
    label: "Geld",
    links: [
      { to: "/bank", icon: "bank", label: "Bank" },
      { to: "/kasse", icon: "cash", label: "Kasse" },
    ],
  },
  {
    label: "Steuern",
    links: [
      { to: "/umsatzsteuer", icon: "vat", label: "Umsatzsteuer" },
      { to: "/jahreserklaerung", icon: "annual", label: "Jahreserklärung" },
      { to: "/finanzamt", icon: "mail", label: "Finanzamt" },
      { to: "/fristen", icon: "calendar", label: "Fristen" },
    ],
  },
  {
    label: "Buchhaltung",
    links: [
      { to: "/auswertungen", icon: "reports", label: "Auswertungen" },
      { to: "/buchungen", icon: "journal", label: "Buchungen" },
      { to: "/konten", icon: "ledger", label: "Konten" },
      { to: "/archiv", icon: "archive", label: "Archiv" },
    ],
  },
] as const;

function AppLayout() {
  const { user } = Route.useRouteContext();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  async function signOut() {
    // Erst beim Abmelden laden: der Auth-Client bringt den Passkey-Code mit, den nur Anmeldung und Einstellungen brauchen
    const { authClient } = await import("../lib/auth-client.ts");
    await authClient.signOut();
    await router.navigate({ to: "/login" });
  }

  return (
    <div className="shell">
      <nav className={`nav${menuOpen ? " open" : ""}`} aria-label="Hauptnavigation">
        <Link to="/" className="brand">
          <span className="brand-mark">H</span>Haben
        </Link>
        <button type="button" className="nav-toggle" aria-expanded={menuOpen} aria-controls="hauptmenue" onClick={() => setMenuOpen((open) => !open)}>
          <span aria-hidden="true">{menuOpen ? "✕" : "☰"}</span> Menü
        </button>
        {/* Auf dem Handy schließt ein Klick auf einen Link das Menü */}
        <div className="nav-body" id="hauptmenue" onClick={(event) => (event.target as HTMLElement).closest("a") && setMenuOpen(false)}>
        <Link to="/" className="nav-link" activeOptions={{ exact: true }}>
          <Icon name="overview" />
          Übersicht
        </Link>
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="nav-group" role="group" aria-label={group.label}>
            <div className="nav-group-label" aria-hidden="true">
              {group.label}
            </div>
            {group.links.map((link) => (
              <Link key={link.to} to={link.to} className="nav-link">
                <Icon name={link.icon} />
                {link.label}
              </Link>
            ))}
          </div>
        ))}
        <div className="nav-spacer" />
        <div className="nav-foot">
          <span>Geschäftsjahr {new Date().getFullYear()}</span>
          <span>{user.name}</span>
          <Link to="/einstellungen" className="nav-foot-link">
            Einstellungen
          </Link>
          {/* AGPL § 13: Nutzer im Netz bekommen den Quellcode */}
          <a href="https://github.com/firsttris/haben" style={{ color: "inherit" }}>
            Quellcode (AGPL)
          </a>
          <button type="button" onClick={signOut}>
            Abmelden
          </button>
        </div>
        </div>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
