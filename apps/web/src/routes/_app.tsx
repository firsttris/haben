import { Link, Outlet, createFileRoute, redirect, useRouter, useRouterState } from "@tanstack/react-router";
import { type PointerEvent, type RefObject, useEffect, useRef, useState } from "react";
import { ThemePicker } from "../components/ThemePicker.tsx";
import { Icon } from "../components/Icon.tsx";
import { getAuthState } from "../server/functions/setup.ts";
import { currentYear, isKapitalgesellschaft } from "@haben/core";
import { CommandPalette } from "../components/CommandPalette.tsx";
import { NAV_GROUPS, STEUERBERATUNG_NAV, type NavLink, navLinkSichtbar } from "../lib/navigation.ts";
import { NavMarkSymbol } from "../components/NavMarkSymbol.tsx";
import { FirmaWechsler } from "../components/FirmaWechsler.tsx";
import { usePageHeadHeight, useScrolled } from "../lib/use-page-head.ts";
import { releaseNotesUrl } from "../lib/release-notes.ts";
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

function useFirmaBrand() {
  const firmaRef = useRef<HTMLSpanElement>(null);
  const [firmaVoll, setFirmaVoll] = useState<string | null>(null);
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

function useShortcutLabel() {
  const [shortcutLabel, setShortcutLabel] = useState("Strg K");
  useEffect(() => {
    if (/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)) setShortcutLabel("⌘ K");
  }, []);
  return shortcutLabel;
}

function useMobileMenuEscape(menuOpen: boolean, paletteOpen: boolean, onClose: () => void, toggle: RefObject<HTMLButtonElement | null>) {
  useEffect(() => {
    if (!menuOpen || paletteOpen) return;
    function onKey(event: KeyboardEvent) {
      // Ein aufgeklappter Bereich im Menü (Firma wechseln) schließt zuerst sich selbst
      if (event.key !== "Escape" || document.querySelector('#hauptmenue [aria-expanded="true"]')) return;
      // Vor den Tasten der Seite (Esc in der Belegansicht geht sonst zurück zur Liste)
      event.preventDefault();
      onClose();
      toggle.current?.focus();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [menuOpen, paletteOpen, onClose, toggle]);
}

function AppLayout() {
  const { user, rechtsform, eigeneSeiten, hatMitarbeiter, firmen, oidc } = Route.useRouteContext();
  const gesellschaft = isKapitalgesellschaft(rechtsform);
  const inhaber = user.role === "inhaber";
  const groups = inhaber ? NAV_GROUPS : STEUERBERATUNG_NAV;
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
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

  useMobileMenuEscape(menuOpen, paletteOpen, () => setMenuOpen(false), toggle);

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
        <NavBrand inhaber={inhaber} />
        <NavSearch onOpen={() => setPaletteOpen(true)} />
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
          {/* Firma wechseln (#504): nur mit anderen Firmen. Als Erstes im rollenden Menü */}
          {firmen.length > 0 && <FirmaWechsler andere={firmen} />}
          <Link to={inhaber ? "/" : STEUERBERATUNG_START} className="nav-link" activeOptions={{ exact: true }}>
            <Icon name="overview" />
            Übersicht
          </Link>
          <NavGroups groups={groups} gesellschaft={gesellschaft} hatMitarbeiter={hatMitarbeiter} eigeneSeiten={eigeneSeiten} />
          <div className="nav-spacer" />
          <NavFoot user={user} inhaber={inhaber} onSignOut={signOut} />
        </div>
      </nav>
      <main className="main" id="inhalt" ref={main} tabIndex={-1}>
        <Outlet />
      </main>
      <CommandPalette
        open={paletteOpen}
        oidcOnly={oidc.only}
        onOpen={() => setPaletteOpen(true)}
        onClose={() => setPaletteOpen(false)}
        onNavigate={() => setMenuOpen(false)}
        inhaber={inhaber}
        gesellschaft={gesellschaft}
        hatMitarbeiter={hatMitarbeiter}
        eigeneSeiten={eigeneSeiten}
      />
    </div>
  );
}

function NavBrand({ inhaber }: { inhaber: boolean }) {
  const { firma, zeichen } = Route.useRouteContext();
  const { firmaRef, firmaVoll, firmaAufklappen, firmaZuklappen, firmaZeigerWeg } = useFirmaBrand();
  return (
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
  );
}

function NavSearch({ onOpen }: { onOpen: () => void }) {
  const shortcutLabel = useShortcutLabel();
  return (
    <button
      type="button"
      className="btn btn-icon nav-search-btn"
      onClick={(event) => {
        event.currentTarget.focus();
        onOpen();
      }}
      aria-keyshortcuts="Control+K Meta+K"
    >
      <Icon name="search" size={18} />
      <span className="nav-search-label">Schnellsuche</span>
      <kbd className="nav-kbd" aria-hidden="true">
        {shortcutLabel}
      </kbd>
    </button>
  );
}

function NavFoot({ user, inhaber, onSignOut }: { user: { name: string; role: keyof typeof ROLLEN_LABEL }; inhaber: boolean; onSignOut: () => void }) {
  return (
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
      <button type="button" className="nav-link nav-foot-link" onClick={onSignOut}>
        <Icon name="logout" />
        Abmelden
      </button>
      <ThemePicker />
      <a className="nav-version" href={releaseNotesUrl(__HABEN_VERSION__)} title="Versionshinweise auf GitHub">
        Haben {__HABEN_VERSION__}
      </a>
    </div>
  );
}

function NavGroups({
  groups,
  gesellschaft,
  hatMitarbeiter,
  eigeneSeiten,
}: {
  groups: typeof NAV_GROUPS | typeof STEUERBERATUNG_NAV;
  gesellschaft: boolean;
  hatMitarbeiter: boolean;
  eigeneSeiten: readonly { id: string; name: string; url: string; openInNewTab: boolean }[];
}) {
  return (
    <>
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
          {eigeneSeiten.map((seite) =>
            seite.openInNewTab ? (
              <a key={seite.id} href={seite.url} target="_blank" rel="noreferrer" className="nav-link">
                <Icon name="external" />
                {seite.name}
                <span className="visually-hidden"> (öffnet in neuem Tab)</span>
              </a>
            ) : (
              <Link key={seite.id} to="/seiten/$id" params={{ id: seite.id }} className="nav-link">
                <Icon name="embed" />
                {seite.name}
              </Link>
            ),
          )}
        </div>
      )}
    </>
  );
}
