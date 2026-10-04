import { Link, Outlet, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { authClient } from "../lib/auth-client.ts";
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


function AppLayout() {
  const { user } = Route.useRouteContext();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  async function signOut() {
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
        <Link to="/angebote" className="nav-link">
          <Icon name="quote" />
          Angebote
        </Link>
        <Link to="/rechnungen" className="nav-link">
          <Icon name="invoice" />
          Rechnungen
        </Link>
        <Link to="/belege" className="nav-link">
          <Icon name="receipt" />
          Belege
        </Link>
        <Link to="/pauschalen" className="nav-link">
          <Icon name="pauschale" />
          Pauschalen
        </Link>
        <Link to="/bank" className="nav-link">
          <Icon name="bank" />
          Bank
        </Link>
        <Link to="/kasse" className="nav-link">
          <Icon name="cash" />
          Kasse
        </Link>
        <Link to="/anlagen" className="nav-link">
          <Icon name="assets" />
          Anlagen
        </Link>
        <Link to="/buchungen" className="nav-link">
          <Icon name="journal" />
          Buchungen
        </Link>
        <Link to="/konten" className="nav-link">
          <Icon name="ledger" />
          Konten
        </Link>
        <Link to="/umsatzsteuer" className="nav-link">
          <Icon name="vat" />
          Umsatzsteuer
        </Link>
        <Link to="/jahreserklaerung" className="nav-link">
          <Icon name="annual" />
          Jahreserklärung
        </Link>
        <Link to="/fristen" className="nav-link">
          <Icon name="calendar" />
          Fristen
        </Link>
        <Link to="/finanzamt" className="nav-link">
          <Icon name="mail" />
          Finanzamt
        </Link>
        <Link to="/auswertungen" className="nav-link">
          <Icon name="reports" />
          Auswertungen
        </Link>
        <Link to="/kontakte" className="nav-link">
          <Icon name="contacts" />
          Kontakte
        </Link>
        <Link to="/archiv" className="nav-link">
          <Icon name="archive" />
          Archiv
        </Link>
        <Link to="/einstellungen" className="nav-link">
          <Icon name="settings" />
          Einstellungen
        </Link>
        <div className="nav-spacer" />
        <div className="nav-foot">
          <span>Geschäftsjahr {new Date().getFullYear()}</span>
          <span>{user.name}</span>
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
