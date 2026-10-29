import { Link, Outlet, createFileRoute, redirect, useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ThemePicker } from "../components/ThemePicker.tsx";
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
      { to: "/artikel", icon: "article", label: "Artikel" },
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
  const pathname = useLocation({ select: (location) => location.pathname });
  const main = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const firstPath = useRef(pathname);

  // Nach dem Seitenwechsel steht der Fokus am Anfang des Inhalts, nicht mehr auf dem geklickten Link;
  // Filter und Suche (nur Suchparameter) lassen ihn, wo er ist
  useEffect(() => {
    if (pathname === firstPath.current) return;
    firstPath.current = pathname;
    if (!main.current?.contains(document.activeElement)) main.current?.focus({ preventScroll: true });
  }, [pathname]);

  // Escape schließt das Menü auf dem Handy und gibt den Fokus an den Menüknopf zurück
  useEffect(() => {
    if (!menuOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Vor den Tasten der Seite (Esc in der Belegansicht geht sonst zurück zur Liste)
      event.preventDefault();
      setMenuOpen(false);
      toggle.current?.focus();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [menuOpen]);

  async function signOut() {
    // Erst beim Abmelden laden: der Auth-Client bringt den Passkey-Code mit, den nur Anmeldung und Einstellungen brauchen
    const { authClient } = await import("../lib/auth-client.ts");
    await authClient.signOut();
    await router.navigate({ to: "/login" });
  }

  return (
    <div className="shell">
      <a href="#inhalt" className="skip-link">
        Zum Inhalt springen
      </a>
      <nav className={`nav${menuOpen ? " open" : ""}`} aria-label="Hauptnavigation">
        <Link to="/" className="brand">
          <span className="brand-mark">H</span>Haben
        </Link>
        <button ref={toggle} type="button" className="nav-toggle" aria-expanded={menuOpen} aria-controls="hauptmenue" onClick={() => setMenuOpen((open) => !open)}>
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
          <div className="nav-user">
            <span className="nav-avatar" aria-hidden="true">
              {user.name.trim().charAt(0).toUpperCase() || "?"}
            </span>
            <span className="nav-user-text">
              <span className="nav-user-name">{user.name}</span>
              <span className="nav-user-meta">Geschäftsjahr {new Date().getFullYear()}</span>
            </span>
          </div>
          <Link to="/einstellungen" className="nav-link nav-foot-link">
            <Icon name="settings" />
            Einstellungen
          </Link>
          {/* AGPL § 13: Nutzer im Netz bekommen den Quellcode */}
          <a href="https://github.com/firsttris/haben" className="nav-link nav-foot-link">
            <Icon name="code" />
            Quellcode (AGPL)
          </a>
          <button type="button" className="nav-link nav-foot-link" onClick={signOut}>
            <Icon name="logout" />
            Abmelden
          </button>
          <ThemePicker />
          <a
            className="nav-version"
            href={`https://github.com/firsttris/haben/releases/tag/v${__HABEN_VERSION__}`}
            title="Versionshinweise auf GitHub"
          >
            Haben {__HABEN_VERSION__}
          </a>
        </div>
        </div>
      </nav>
      <main className="main" id="inhalt" ref={main} tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
