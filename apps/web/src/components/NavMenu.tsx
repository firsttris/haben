import { Link } from "@tanstack/react-router";
import type { Firma } from "../lib/firmen.ts";
import type { EigeneSeiteNav as EigeneSeite, NavGroup } from "../lib/navigation.ts";
import { STEUERBERATUNG_START } from "../lib/rollen.ts";
import { FirmaListe, FirmaWechsler, ZumFirmenportal } from "./FirmaWechsler.tsx";
import { Icon } from "./Icon.tsx";
import { type FlyoutWeg, NavFlyout } from "./NavFlyout.tsx";
import { ThemePicker } from "./ThemePicker.tsx";

/** Name eines Symbols der eingeklappten Leiste, beim Überfahren und mit Fokus (styles.css, .nav-tip); der Name für
 * Hilfstechnik steht im aria-label des Elements */
export function NavTip({ children }: { children: string }) {
  return (
    <span className="nav-tip" aria-hidden="true">
      {children}
    </span>
  );
}

interface CollapseButtonProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

function CollapseSidebarButton({ collapsed, onToggleCollapse }: CollapseButtonProps) {
  return (
    <button
      type="button"
      className="nav-link nav-collapse-btn nav-tip-anker"
      aria-expanded={!collapsed}
      aria-label={collapsed ? "Seitenleiste ausklappen" : "Seitenleiste einklappen"}
      onClick={onToggleCollapse}
    >
      <Icon name={collapsed ? "sidebar-open" : "sidebar-close"} />
      <span className="nav-collapse-label">Einklappen</span>
      {collapsed && <NavTip>Seitenleiste ausklappen</NavTip>}
    </button>
  );
}

interface NavBodyProps extends CollapseButtonProps {
  inhaber: boolean;
  /** Name aus den Firmendaten; eingeklappt steht er im Kopf von „Firma wechseln“ (#504) */
  firma: string | null;
  pathname: string;
  firmen: Firma[];
  /** HABEN_FIRMENPORTAL_URL, nur für den Inhaber (#504, Stufe 2); dann statt der Liste ein Link dorthin */
  firmenportal: string | null;
  sichtbareGruppen: readonly NavGroup[];
  eigeneSeiten: readonly EigeneSeite[];
  userName: string;
  userInitial: string;
  userMeta: string;
  openFlyout: { key: string; weg: FlyoutWeg } | null;
  onFlyoutOpen: (key: string, weg: FlyoutWeg) => void;
  /** Schließt nur das Flyout mit diesem Schlüssel, nie ein inzwischen geöffnetes anderes */
  onFlyoutClose: (key: string) => void;
  onSignOut: () => void;
}

function routeAktiv(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

function EigeneSeitenLinks({ seiten }: { seiten: readonly EigeneSeite[] }) {
  return seiten.map((seite) =>
    // Seiten, die das Einbetten verbieten, öffnen in einem neuen Tab (#636); noreferrer wie der Rahmen
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
  );
}

function NavAccountActions({ onSignOut }: { onSignOut: () => void }) {
  return (
    <>
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
      <a className="nav-version" href={`https://github.com/firsttris/haben/releases/tag/v${__HABEN_VERSION__}`} title="Versionshinweise auf GitHub">
        Haben {__HABEN_VERSION__}
      </a>
    </>
  );
}

export function NavRailBody({
  collapsed,
  onToggleCollapse,
  inhaber,
  pathname,
  firmen,
  firmenportal,
  sichtbareGruppen,
  eigeneSeiten,
  userName,
  userInitial,
  userMeta,
  firma,
  openFlyout,
  onFlyoutOpen,
  onFlyoutClose,
  onSignOut,
}: NavBodyProps) {
  const flyout = (key: string) => ({
    open: openFlyout?.key === key ? openFlyout.weg : null,
    onOpen: (weg: FlyoutWeg) => onFlyoutOpen(key, weg),
    onClose: () => onFlyoutClose(key),
  });
  return (
    <>
      {firmenportal ? (
        // Kein Flyout: Der Link führt aus Haben hinaus, die Liste der Firmen kennt nur das Ziel
        <a href={firmenportal} className="nav-link nav-rail-link nav-tip-anker" aria-label="Firma wechseln">
          <Icon name="company" />
          <NavTip>Firma wechseln</NavTip>
        </a>
      ) : (
        firmen.length > 0 && (
          <NavFlyout label="Firma wechseln" icon="company" zusatz={firma} {...flyout("firma")}>
            <FirmaListe key={openFlyout?.key === "firma" ? "open" : "closed"} andere={firmen} />
          </NavFlyout>
        )
      )}
      <Link to={inhaber ? "/" : STEUERBERATUNG_START} className="nav-link nav-rail-link nav-tip-anker" aria-label="Übersicht" activeOptions={{ exact: true }}>
        <Icon name="overview" />
        <NavTip>Übersicht</NavTip>
      </Link>
      {sichtbareGruppen.map((group) => (
        <NavFlyout
          key={group.label}
          label={group.label}
          icon={group.icon}
          active={group.links.some((link) => routeAktiv(pathname, link.to))}
          {...flyout(group.label)}
        >
          {group.links.map((link) => (
            <Link key={link.to} to={link.to} className="nav-link">
              <Icon name={link.icon} />
              {link.label}
            </Link>
          ))}
        </NavFlyout>
      ))}
      {eigeneSeiten.length > 0 && (
        <NavFlyout label="Eigene Seiten" icon="embed" active={pathname.startsWith("/seiten/")} {...flyout("eigene-seiten")}>
          <EigeneSeitenLinks seiten={eigeneSeiten} />
        </NavFlyout>
      )}
      <div className="nav-spacer" />
      <div className="nav-foot nav-foot-rail">
        {inhaber && (
          <Link to="/einstellungen" className="nav-link nav-rail-link nav-tip-anker" aria-label="Einstellungen">
            <Icon name="settings" />
            <NavTip>Einstellungen</NavTip>
          </Link>
        )}
        <NavFlyout
          label={`${userName} · Konto & Darstellung`}
          icon="info"
          {...flyout("konto")}
          triggerContent={
            <span className="nav-avatar" aria-hidden="true">
              {userInitial}
            </span>
          }
        >
          <div className="nav-user nav-flyout-user">
            <span className="nav-avatar" aria-hidden="true">
              {userInitial}
            </span>
            <span className="nav-user-text">
              <span className="nav-user-name">{userName}</span>
              <span className="nav-user-meta">{userMeta}</span>
            </span>
          </div>
          <NavAccountActions onSignOut={onSignOut} />
        </NavFlyout>
      </div>
      {/* Ganz unten, an derselben Stelle wie ausgeklappt */}
      <CollapseSidebarButton collapsed={collapsed} onToggleCollapse={onToggleCollapse} />
    </>
  );
}

export function NavExpandedBody({
  collapsed,
  onToggleCollapse,
  inhaber,
  firmen,
  firmenportal,
  sichtbareGruppen,
  eigeneSeiten,
  userName,
  userInitial,
  userMeta,
  onSignOut,
}: Omit<NavBodyProps, "pathname" | "firma" | "openFlyout" | "onFlyoutOpen" | "onFlyoutClose">) {
  return (
    <>
      {/* Firma wechseln (#504), mit HABEN_FIRMENPORTAL_URL stattdessen der Link „Firma wechseln“; sonst nur mit anderen Firmen. Als Erstes im rollenden Menü */}
      {firmenportal ? <ZumFirmenportal url={firmenportal} /> : firmen.length > 0 && <FirmaWechsler andere={firmen} />}
      <Link to={inhaber ? "/" : STEUERBERATUNG_START} className="nav-link" activeOptions={{ exact: true }}>
        <Icon name="overview" />
        <span className="nav-collapse-label">Übersicht</span>
      </Link>
      {sichtbareGruppen.map((group) => (
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
      {/* Eigene Seiten (#199): Seiten außerhalb von Haben, unter Einstellungen angelegt */}
      {eigeneSeiten.length > 0 && (
        <div className="nav-group" role="group" aria-label="Eigene Seiten">
          <div className="nav-group-label" aria-hidden="true">
            Eigene Seiten
          </div>
          <EigeneSeitenLinks seiten={eigeneSeiten} />
        </div>
      )}
      <div className="nav-spacer" />
      <div className="nav-foot">
        <div className="nav-user">
          <span className="nav-avatar" aria-hidden="true">
            {userInitial}
          </span>
          <span className="nav-user-text">
            <span className="nav-user-name">{userName}</span>
            <span className="nav-user-meta">{userMeta}</span>
          </span>
        </div>
        {inhaber && (
          <Link to="/einstellungen" className="nav-link nav-foot-link">
            <Icon name="settings" />
            Einstellungen
          </Link>
        )}
        <NavAccountActions onSignOut={onSignOut} />
      </div>
      {/* Ganz unten, wie eingeklappt; am Handy verborgen */}
      <CollapseSidebarButton collapsed={collapsed} onToggleCollapse={onToggleCollapse} />
    </>
  );
}

/** Beide Fassungen im DOM, CSS zeigt eine (display: contents, die Kinder bleiben Teil von .nav-body); so liefert der
 * Server die eingeklappte Leiste schon fertig */
export function NavVarianten(props: NavBodyProps) {
  return (
    <>
      <div className="nav-variante nav-variante-voll">
        <NavExpandedBody {...props} />
      </div>
      <div className="nav-variante nav-variante-rail">
        <NavRailBody {...props} />
      </div>
    </>
  );
}
