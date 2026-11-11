import { Link, Outlet, createFileRoute, redirect, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ThemePicker } from "../components/ThemePicker.tsx";
import { Icon } from "../components/Icon.tsx";
import { getAuthState } from "../server/functions/setup.ts";
import { currentYear, isKapitalgesellschaft } from "@haben/core";
import { navLinkSichtbar, type NavBedingung } from "../lib/navigation.ts";
import { usePageHeadHeight, useScrolled } from "../lib/use-page-head.ts";
import { ROLLEN_LABEL, STEUERBERATUNG_START, steuerberatungSieht } from "../lib/rollen.ts";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ location }) => {
    const state = await getAuthState();
    if (!state.initialized) throw redirect({ to: "/setup" });
    if (!state.user) throw redirect({ to: "/login" });
    // Die Steuerberatung sieht nur ihre Seiten; die Server Functions prüfen das unabhängig davon selbst
    if (state.user.role !== "inhaber" && !steuerberatungSieht(location.pathname)) throw redirect({ to: STEUERBERATUNG_START });
    return {
      user: state.user,
      oidc: state.oidc,
      rechtsform: state.rechtsform ?? "einzelunternehmen",
      eigeneSeiten: state.eigeneSeiten,
      hatMitarbeiter: state.hatMitarbeiter,
      firma: state.firma,
    };
  },
  component: AppLayout,
});

interface NavLink extends NavBedingung {
  to: string;
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
}

/** Hauptnavigation nach Arbeitsbereichen; Einstellungen stehen unten bei Konto und Abmelden */
const NAV_GROUPS = [
  {
    label: "Verkauf",
    links: [
      { to: "/angebote", icon: "quote", label: "Angebote" },
      { to: "/rechnungen", icon: "invoice", label: "Rechnungen" },
      { to: "/lastschriften", icon: "bank", label: "Lastschriften" },
      { to: "/kontakte", icon: "contacts", label: "Kontakte" },
      { to: "/artikel", icon: "article", label: "Artikel" },
      { to: "/textbausteine", icon: "textblock", label: "Textbausteine" },
    ],
  },
  {
    label: "Ausgaben",
    links: [
      { to: "/belege", icon: "receipt", label: "Belege" },
      { to: "/dauerbelege", icon: "calendar", label: "Dauerbelege" },
      { to: "/ueberweisungen", icon: "bank", label: "Überweisungen" },
      // Pauschalen ersetzen Ausgaben des Inhabers, eine GmbH oder UG hat sie nicht
      { to: "/pauschalen", icon: "pauschale", label: "Pauschalen", nurEinzelunternehmen: true },
      { to: "/anlagen", icon: "assets", label: "Anlagen" },
    ],
  },
  {
    label: "Geld",
    links: [
      { to: "/bank", icon: "bank", label: "Bank" },
      { to: "/kasse", icon: "cash", label: "Kasse" },
      { to: "/darlehen", icon: "bank", label: "Darlehen" },
    ],
  },
  {
    label: "Personal",
    links: [
      { to: "/lohn", icon: "payroll", label: "Lohn" },
      // Lohn bleibt immer sichtbar, dort entsteht der erste Mitarbeiter
      { to: "/sv-meldeportal", icon: "mail", label: "SV-Meldeportal", nurMitMitarbeitern: true },
    ],
  },
  {
    label: "Steuern",
    links: [
      { to: "/umsatzsteuer", icon: "vat", label: "Umsatzsteuer" },
      { to: "/jahreserklaerung", icon: "annual", label: "Jahreserklärung" },
      // Gewinnausschüttung und Kapitalertragsteuer gibt es nur für GmbH und UG
      { to: "/ausschuettungen", icon: "cash", label: "Ausschüttungen", nurKapitalgesellschaft: true },
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
      // Bilanz und Abschluss gibt es nur für GmbH und UG
      { to: "/abschluss", icon: "annual", label: "Jahresabschluss", nurKapitalgesellschaft: true },
      { to: "/archiv", icon: "archive", label: "Archiv" },
    ],
  },
] as const;

/** Navigation der Steuerberatung: nur lesen */
const STEUERBERATUNG_NAV = [
  {
    label: "Steuerberatung",
    links: [
      { to: "/auswertungen", icon: "reports", label: "Auswertungen" },
      { to: "/buchungen", icon: "journal", label: "Buchungen" },
      { to: "/konten", icon: "ledger", label: "Konten" },
      { to: "/belege", icon: "receipt", label: "Belege" },
      { to: "/rechnungen", icon: "invoice", label: "Rechnungen" },
    ],
  },
] as const;

function AppLayout() {
  const { user, rechtsform, eigeneSeiten, hatMitarbeiter, firma } = Route.useRouteContext();
  const gesellschaft = isKapitalgesellschaft(rechtsform);
  const inhaber = user.role === "inhaber";
  const groups = inhaber ? NAV_GROUPS : STEUERBERATUNG_NAV;
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  // Erst wenn die neue Seite steht (resolvedLocation): solange der Loader läuft, ist noch die alte Seite mit dem geklickten Link zu sehen
  const pathname = useRouterState({ select: (state) => (state.resolvedLocation ?? state.location).pathname });
  const main = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const firstPath = useRef(pathname);
  usePageHeadHeight(main);
  const scrolled = useScrolled();

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
    <div className="shell" data-scrolled={scrolled || undefined}>
      <a href="#inhalt" className="skip-link">
        Zum Inhalt springen
      </a>
      <nav className={`nav${menuOpen ? " open" : ""}`} aria-label="Hauptnavigation">
        <Link to={inhaber ? "/" : STEUERBERATUNG_START} className="brand">
          <span className="brand-mark">H</span>
          <span className="brand-text">
            Haben
            {/* Mehrere Firmen (#504): Der Name unter „Haben“ zeigt, in welcher Instanz man gerade arbeitet; ist er zu
                lang, wird er gekürzt, der volle Name steht im Tooltip */}
            {firma && (
              <span className="brand-firma" title={firma}>
                {firma}
              </span>
            )}
          </span>
        </Link>
        <button
          ref={toggle}
          type="button"
          className="nav-toggle"
          aria-expanded={menuOpen}
          aria-controls="hauptmenue"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Icon name={menuOpen ? "close" : "menu"} /> Menü
        </button>
        {/* Auf dem Handy schließt ein Klick auf einen Link das Menü */}
        <div className="nav-body" id="hauptmenue" onClick={(event) => (event.target as HTMLElement).closest("a") && setMenuOpen(false)}>
          <Link to={inhaber ? "/" : STEUERBERATUNG_START} className="nav-link" activeOptions={{ exact: true }}>
            <Icon name="overview" />
            Übersicht
          </Link>
          {groups.map((group) => (
            <div key={group.label} className="nav-group" role="group" aria-label={group.label}>
              <div className="nav-group-label" aria-hidden="true">
                {group.label}
              </div>
              {(group.links as readonly NavLink[])
                .filter((link) => navLinkSichtbar(link, { gesellschaft, hatMitarbeiter }))
                .map((link) => (
                  <Link key={link.to} to={link.to} className="nav-link">
                    <Icon name={link.icon} />
                    {link.label}
                  </Link>
                ))}
            </div>
          ))}
          {/* Eigene Seiten (#199): Seiten außerhalb von Haben, unter Einstellungen angelegt */}
          {eigeneSeiten.length > 0 && (
            <div className="nav-group" role="group" aria-label="Eigene Seiten">
              <div className="nav-group-label" aria-hidden="true">
                Eigene Seiten
              </div>
              {eigeneSeiten.map((seite) => (
                <Link key={seite.id} to="/seiten/$id" params={{ id: seite.id }} className="nav-link">
                  <Icon name="external" />
                  {seite.name}
                </Link>
              ))}
            </div>
          )}
          <div className="nav-spacer" />
          <div className="nav-foot">
            <div className="nav-user">
              <span className="nav-avatar" aria-hidden="true">
                {user.name.trim().charAt(0).toUpperCase() || "?"}
              </span>
              <span className="nav-user-text">
                <span className="nav-user-name">{user.name}</span>
                <span className="nav-user-meta">{inhaber ? `Geschäftsjahr ${currentYear()}` : `${ROLLEN_LABEL[user.role]} · nur lesen`}</span>
              </span>
            </div>
            {inhaber && (
              <Link to="/einstellungen" className="nav-link nav-foot-link">
                <Icon name="settings" />
                Einstellungen
              </Link>
            )}
            <a href="https://haben.app/" target="_blank" rel="noreferrer" className="nav-link nav-foot-link">
              <Icon name="docs" />
              Dokumentation
            </a>
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
            <a className="nav-version" href={`https://github.com/firsttris/haben/releases/tag/v${__HABEN_VERSION__}`} title="Versionshinweise auf GitHub">
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
