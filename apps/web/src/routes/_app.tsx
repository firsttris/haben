import { Link, Outlet, createFileRoute, redirect, useRouter, useRouterState } from "@tanstack/react-router";
import { type PointerEvent, type RefObject, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "../components/Icon.tsx";
import { NavTip, NavVarianten } from "../components/NavMenu.tsx";
import type { FlyoutWeg } from "../components/NavFlyout.tsx";
import { getAuthState } from "../server/functions/setup.ts";
import { currentYear, isKapitalgesellschaft } from "@haben/core";
import { CommandPalette, PALETTE_KUERZEL } from "../components/CommandPalette.tsx";
import { Kuerzel } from "../components/Kuerzel.tsx";
import { ariaKuerzel } from "../lib/tastatur.ts";
import { NAV_GROUPS, STEUERBERATUNG_NAV, navLinkSichtbar } from "../lib/navigation.ts";
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
      firmenportal: state.firmenportal,
    };
  },
  component: AppLayout,
});

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

/**
 * Zustand der eingeklappten Leiste. Welche Fassung zu sehen ist, entscheidet allein CSS ([data-nav] und die Breite),
 * damit der Server beide liefert und beim Laden nichts nachrückt.
 */
function useRailState() {
  const collapsed = useSyncExternalStore(subscribeNavCollapsed, readNavCollapsed, () => false);
  const [openFlyout, setOpenFlyout] = useState<{ key: string; weg: FlyoutWeg } | null>(null);

  useEffect(() => {
    if (!collapsed) setOpenFlyout(null);
    const mq = window.matchMedia("(min-width: 861px)");
    const zu = () => setOpenFlyout(null);
    mq.addEventListener("change", zu);
    return () => mq.removeEventListener("change", zu);
  }, [collapsed]);

  return { collapsed, openFlyout, setOpenFlyout };
}

/** Esc blendet den Hinweis unter Zeiger oder Fokus aus, bis beides weiterzieht (WCAG 1.4.13, „dismissible“) */
function useNavTipEscape() {
  useEffect(() => {
    const root = document.documentElement;
    // Hinweise gibt es nur eingeklappt am Desktop (styles.css); schmal bleibt Esc für die Seite
    const desktop = window.matchMedia("not all and (max-width: 860px)");
    // Die Symbole, deren Hinweis Esc ausgeblendet hat
    let ausgeblendet: Element[] = [];
    const taste = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || root.dataset.navTip === "aus" || !root.dataset.nav || !desktop.matches) return;
      const anker = [...document.querySelectorAll(".nav-tip-anker:is(:hover, :focus-visible)")];
      if (anker.length === 0) return;
      // Vor den Tasten der Seite (Esc in der Belegansicht geht sonst zurück zur Liste)
      event.preventDefault();
      event.stopPropagation();
      ausgeblendet = anker;
      root.dataset.navTip = "aus";
    };
    const wieder = () => {
      ausgeblendet = [];
      delete root.dataset.navTip;
    };
    // Erst wenn der Zeiger das Symbol verlässt (nicht beim Wechsel vom Knopf auf sein svg) und es keinen Fokus mehr hat
    const zeigerRaus = (event: globalThis.PointerEvent) => {
      const ziel = event.relatedTarget as Node | null;
      if (ausgeblendet.some((anker) => anker.contains(ziel) || anker.matches(":focus-visible"))) return;
      wieder();
    };
    window.addEventListener("keydown", taste, true);
    document.addEventListener("focusin", wieder);
    document.addEventListener("pointerout", zeigerRaus);
    return () => {
      window.removeEventListener("keydown", taste, true);
      document.removeEventListener("focusin", wieder);
      document.removeEventListener("pointerout", zeigerRaus);
    };
  }, []);
}

function useMobileMenuEscape(menuOpen: boolean, paletteOpen: boolean, onClose: () => void, toggle: RefObject<HTMLButtonElement | null>) {
  useEffect(() => {
    if (!menuOpen || paletteOpen) return;
    function onKey(event: KeyboardEvent) {
      // Ein aufgeklappter Bereich im Menü (Firma wechseln) schließt zuerst sich selbst; der Desktop-Umschalter und die
      // verborgene schmale Leiste blockieren Esc nicht
      if (event.key !== "Escape" || document.querySelector('#hauptmenue .nav-variante-voll [aria-expanded="true"]:not(.nav-collapse-btn)')) return;
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
  const { user, rechtsform, eigeneSeiten, hatMitarbeiter, firmen, firmenportal, firma, oidc } = Route.useRouteContext();
  const gesellschaft = isKapitalgesellschaft(rechtsform);
  const inhaber = user.role === "inhaber";
  const groups = inhaber ? NAV_GROUPS : STEUERBERATUNG_NAV;
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { collapsed, openFlyout, setOpenFlyout } = useRailState();
  useNavTipEscape();
  // Erst wenn die neue Seite steht (resolvedLocation): solange der Loader läuft, ist noch die alte Seite mit dem geklickten Link zu sehen
  const pathname = useRouterState({ select: (state) => (state.resolvedLocation ?? state.location).pathname });
  const main = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const firstPath = useRef(pathname);
  const sichtbareGruppen = groups
    .map((group) => ({ ...group, links: group.links.filter((link) => navLinkSichtbar(link, { gesellschaft, hatMitarbeiter })) }))
    .filter((group) => group.links.length > 0);
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
          <NavVarianten
            collapsed={collapsed}
            onToggleCollapse={() => saveNavCollapsed(!collapsed)}
            inhaber={inhaber}
            pathname={pathname}
            firma={firma ?? null}
            firmen={firmen}
            firmenportal={firmenportal ?? null}
            sichtbareGruppen={sichtbareGruppen}
            eigeneSeiten={eigeneSeiten}
            userName={user.name}
            userInitial={user.name.trim().charAt(0).toUpperCase() || "?"}
            userMeta={inhaber ? `Geschäftsjahr ${currentYear()}` : `${ROLLEN_LABEL[user.role]} · nur lesen`}
            openFlyout={openFlyout}
            onFlyoutOpen={(key, weg) => setOpenFlyout({ key, weg })}
            onFlyoutClose={(key) => setOpenFlyout((offen) => (offen?.key === key ? null : offen))}
            onSignOut={signOut}
          />
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
      className="brand nav-tip-anker"
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
  return (
    <button
      type="button"
      className="btn btn-icon nav-search-btn nav-tip-anker"
      onClick={(event) => {
        event.currentTarget.focus();
        onOpen();
      }}
      aria-keyshortcuts={ariaKuerzel(PALETTE_KUERZEL)}
    >
      <Icon name="search" size={18} />
      <span className="nav-search-label">Schnellsuche</span>
      <NavTip>Schnellsuche</NavTip>
      <Kuerzel tasten={PALETTE_KUERZEL} className="nav-kbd" aria-hidden="true" />
    </button>
  );
}
