import { Link, Outlet, createFileRoute, redirect, useRouter, useRouterState } from "@tanstack/react-router";
import { type PointerEvent, type RefObject, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "../components/Icon.tsx";
import { NavExpandedBody, type NavLink, NavRailBody } from "../components/NavMenu.tsx";
import { getAuthState } from "../server/functions/setup.ts";
import { currentYear, isKapitalgesellschaft } from "@haben/core";
import { navLinkSichtbar } from "../lib/navigation.ts";
import { readNavCollapsed, saveNavCollapsed, subscribeNavCollapsed } from "../lib/nav-rail.ts";
import { NavMarkSymbol } from "../components/NavMarkSymbol.tsx";
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
      zeichen: state.zeichen,
      firmen: state.firmen,
    };
  },
  component: AppLayout,
});

/** Hauptnavigation nach Arbeitsbereichen; Einstellungen stehen unten bei Konto und Abmelden */
const NAV_GROUPS = [
  {
    label: "Verkauf",
    icon: "invoice",
    links: [
      { to: "/angebote", icon: "quote", label: "Angebote" },
      { to: "/rechnungen", icon: "invoice", label: "Rechnungen" },
      { to: "/lastschriften", icon: "bank", label: "Lastschriften" },
      { to: "/kontakte", icon: "contacts", label: "Kontakte" },
      { to: "/artikel", icon: "article", label: "Artikel" },
      { to: "/leistungen", icon: "calendar", label: "Leistungen" },
      { to: "/textbausteine", icon: "textblock", label: "Textbausteine" },
    ],
  },
  {
    label: "Ausgaben",
    icon: "receipt",
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
    icon: "bank",
    links: [
      { to: "/bank", icon: "bank", label: "Bank" },
      { to: "/kasse", icon: "cash", label: "Kasse" },
      { to: "/darlehen", icon: "bank", label: "Darlehen" },
    ],
  },
  {
    label: "Personal",
    icon: "payroll",
    links: [
      { to: "/lohn", icon: "payroll", label: "Lohn" },
      // Lohn bleibt immer sichtbar, dort entsteht der erste Mitarbeiter
      { to: "/sv-meldeportal", icon: "mail", label: "SV-Meldeportal", nurMitMitarbeitern: true },
    ],
  },
  {
    label: "Steuern",
    icon: "vat",
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
    icon: "reports",
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
    icon: "ledger",
    links: [
      { to: "/auswertungen", icon: "reports", label: "Auswertungen" },
      { to: "/buchungen", icon: "journal", label: "Buchungen" },
      { to: "/konten", icon: "ledger", label: "Konten" },
      { to: "/belege", icon: "receipt", label: "Belege" },
      { to: "/rechnungen", icon: "invoice", label: "Rechnungen" },
    ],
  },
] as const;

function useFirmaBrand() {
  const firmaRef = useRef<HTMLSpanElement>(null);
  const [firmaVoll, setFirmaVoll] = useState<string | null>(null);
  // Den vollen Namen nur zeigen, wenn die Marke ihn kürzt (zwei Zeilen am Desktop); am Handy gibt es kein Aufklappen
  function firmaAufklappen() {
    const name = firmaRef.current;
    if (name && window.matchMedia("(min-width: 861px)").matches && name.scrollHeight > name.clientHeight + 1) setFirmaVoll(name.textContent);
  }
  const firmaZuklappen = () => setFirmaVoll(null);
  // Der Zeiger schließt den Namen nicht, solange „Haben“ per Tastatur fokussiert ist (WCAG 1.4.13, „persistent“); nach einem Mausklick hat der Link Fokus ohne :focus-visible, dann schließt das Verlassen ihn
  const firmaZeigerWeg = (event: PointerEvent<HTMLAnchorElement>) => {
    if (!event.currentTarget.matches(":focus-visible")) setFirmaVoll(null);
  };
  // Escape schließt den aufgeklappten Namen auch dann, wenn nur der Zeiger darauf steht und der Fokus woanders ist (WCAG 1.4.13)
  useEffect(() => {
    if (firmaVoll === null) return;
    function zu(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Vor den Tasten der Seite (Esc in der Belegansicht geht sonst zurück zur Liste)
      event.preventDefault();
      event.stopPropagation();
      setFirmaVoll(null);
    }
    window.addEventListener("keydown", zu, true);
    return () => window.removeEventListener("keydown", zu, true);
  }, [firmaVoll]);
  return { firmaRef, firmaVoll, firmaAufklappen, firmaZuklappen, firmaZeigerWeg };
}

function useRailState() {
  const collapsed = useSyncExternalStore(subscribeNavCollapsed, readNavCollapsed, () => false);
  const [desktop, setDesktop] = useState(false);
  const [openFlyout, setOpenFlyout] = useState<string | null>(null);
  const railMode = collapsed && desktop;

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 861px)");
    const sync = () => {
      setDesktop(mq.matches);
      if (!mq.matches) setOpenFlyout(null);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!railMode) setOpenFlyout(null);
  }, [railMode]);

  return { collapsed, railMode, openFlyout, setOpenFlyout };
}

function useMobileMenuEscape(menuOpen: boolean, onClose: () => void, toggle: RefObject<HTMLButtonElement | null>) {
  useEffect(() => {
    if (!menuOpen) return;
    function onKey(event: KeyboardEvent) {
      // Ein aufgeklappter Bereich im Menü (Firma wechseln) schließt zuerst sich selbst; der Desktop-Umschalter blockiert Esc nicht
      if (event.key !== "Escape" || document.querySelector('#hauptmenue [aria-expanded="true"]:not(.nav-collapse-btn)')) return;
      // Vor den Tasten der Seite (Esc in der Belegansicht geht sonst zurück zur Liste)
      event.preventDefault();
      onClose();
      toggle.current?.focus();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [menuOpen, onClose, toggle]);
}

function AppLayout() {
  const { user, rechtsform, eigeneSeiten, hatMitarbeiter, firma, firmen, zeichen } = Route.useRouteContext();
  const gesellschaft = isKapitalgesellschaft(rechtsform);
  const inhaber = user.role === "inhaber";
  const groups = inhaber ? NAV_GROUPS : STEUERBERATUNG_NAV;
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const { collapsed, railMode, openFlyout, setOpenFlyout } = useRailState();
  // Erst wenn die neue Seite steht (resolvedLocation): solange der Loader läuft, ist noch die alte Seite mit dem geklickten Link zu sehen
  const pathname = useRouterState({ select: (state) => (state.resolvedLocation ?? state.location).pathname });
  const main = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const { firmaRef, firmaVoll, firmaAufklappen, firmaZuklappen, firmaZeigerWeg } = useFirmaBrand();
  const firstPath = useRef(pathname);
  const sichtbareGruppen = groups
    .map((group) => ({
      ...group,
      links: (group.links as readonly NavLink[]).filter((link) => navLinkSichtbar(link, { gesellschaft, hatMitarbeiter })),
    }))
    .filter((group) => group.links.length > 0);
  const userInitial = user.name.trim().charAt(0).toUpperCase() || "?";
  const userMeta = inhaber ? `Geschäftsjahr ${currentYear()}` : `${ROLLEN_LABEL[user.role]} · nur lesen`;
  usePageHeadHeight(main);
  const scrolled = useScrolled();

  // Nach dem Seitenwechsel steht der Fokus am Anfang des Inhalts, nicht mehr auf dem geklickten Link;
  // Filter und Suche (nur Suchparameter) lassen ihn, wo er ist
  useEffect(() => {
    if (pathname === firstPath.current) return;
    firstPath.current = pathname;
    setOpenFlyout(null);
    if (!main.current?.contains(document.activeElement)) main.current?.focus({ preventScroll: true });
  }, [pathname, setOpenFlyout]);

  useMobileMenuEscape(menuOpen, () => setMenuOpen(false), toggle);

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
        <Link
          to={inhaber ? "/" : STEUERBERATUNG_START}
          className="brand"
          onPointerEnter={firmaAufklappen}
          onFocus={firmaAufklappen}
          onPointerLeave={firmaZeigerWeg}
          onBlur={firmaZuklappen}
        >
          <NavMarkSymbol mark={zeichen} />
          <span className="brand-text">
            Haben
            {/* Mehrere Firmen (#504): Der Name unter „Haben“ zeigt, in welcher Instanz man gerade arbeitet. Ist er länger
                als zwei Zeilen, klappt er beim Überfahren und mit Fokus nach unten ganz auf (nur am Desktop); das
                Element dafür ist für Hilfstechnik verborgen, der Name steht schon in der Marke */}
            {firma && (
              <span className="brand-firma" ref={firmaRef}>
                {firma}
              </span>
            )}
            {firmaVoll !== null && (
              <span className="brand-firma-voll" aria-hidden="true">
                {firmaVoll}
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
          {(() => {
            const bodyProps = {
              collapsed,
              onToggleCollapse: () => saveNavCollapsed(!collapsed),
              inhaber,
              firmen,
              sichtbareGruppen,
              eigeneSeiten,
              userName: user.name,
              userInitial,
              userMeta,
              onSignOut: signOut,
            };
            return railMode ? (
              <NavRailBody
                {...bodyProps}
                pathname={pathname}
                openFlyout={openFlyout}
                onFlyoutToggle={(key) => setOpenFlyout((cur) => (cur === key ? null : key))}
                onFlyoutClose={() => setOpenFlyout(null)}
              />
            ) : (
              <NavExpandedBody {...bodyProps} />
            );
          })()}
        </div>
      </nav>
      <main className="main" id="inhalt" ref={main} tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
