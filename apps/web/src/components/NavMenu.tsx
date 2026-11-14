import { Link } from "@tanstack/react-router";
import type { Firma } from "../lib/firmen.ts";
import type { NavBedingung } from "../lib/navigation.ts";
import { STEUERBERATUNG_START } from "../lib/rollen.ts";
import { FirmaListe, FirmaWechsler } from "./FirmaWechsler.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { NavFlyout } from "./NavFlyout.tsx";
import { ThemePicker } from "./ThemePicker.tsx";

export interface NavLink extends NavBedingung {
  to: string;
  icon: IconName;
  label: string;
}

export interface NavGroup {
  label: string;
  icon: IconName;
  links: readonly NavLink[];
}

export interface EigeneSeite {
  id: string;
  name: string;
  url: string;
  openInNewTab: boolean;
}

interface NavBodyProps {
  inhaber: boolean;
  pathname: string;
  firmen: Firma[];
  sichtbareGruppen: readonly NavGroup[];
  eigeneSeiten: readonly EigeneSeite[];
  userName: string;
  userInitial: string;
  userMeta: string;
  openFlyout: string | null;
  onFlyoutToggle: (key: string) => void;
  onFlyoutClose: () => void;
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
  inhaber,
  pathname,
  firmen,
  sichtbareGruppen,
  eigeneSeiten,
  userName,
  userInitial,
  userMeta,
  openFlyout,
  onFlyoutToggle,
  onFlyoutClose,
  onSignOut,
}: NavBodyProps) {
  return (
    <>
      {firmen.length > 0 && (
        <NavFlyout label="Firma wechseln" icon="company" open={openFlyout === "firma"} onToggle={() => onFlyoutToggle("firma")} onClose={onFlyoutClose}>
          <FirmaListe andere={firmen} />
        </NavFlyout>
      )}
      <Link
        to={inhaber ? "/" : STEUERBERATUNG_START}
        className="nav-link nav-rail-link"
        aria-label="Übersicht"
        title="Übersicht"
        activeOptions={{ exact: true }}
      >
        <Icon name="overview" />
      </Link>
      {sichtbareGruppen.map((group) => (
        <NavFlyout
          key={group.label}
          label={group.label}
          icon={group.icon}
          active={group.links.some((link) => routeAktiv(pathname, link.to))}
          open={openFlyout === group.label}
          onToggle={() => onFlyoutToggle(group.label)}
          onClose={onFlyoutClose}
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
        <NavFlyout
          label="Eigene Seiten"
          icon="embed"
          active={pathname.startsWith("/seiten/")}
          open={openFlyout === "eigene-seiten"}
          onToggle={() => onFlyoutToggle("eigene-seiten")}
          onClose={onFlyoutClose}
        >
          <EigeneSeitenLinks seiten={eigeneSeiten} />
        </NavFlyout>
      )}
      <div className="nav-spacer" />
      <div className="nav-foot nav-foot-rail">
        {inhaber && (
          <Link to="/einstellungen" className="nav-link nav-rail-link" aria-label="Einstellungen" title="Einstellungen">
            <Icon name="settings" />
          </Link>
        )}
        <NavFlyout
          label={`${userName} · Konto & Darstellung`}
          icon="info"
          open={openFlyout === "konto"}
          onToggle={() => onFlyoutToggle("konto")}
          onClose={onFlyoutClose}
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
    </>
  );
}

export function NavExpandedBody({
  inhaber,
  firmen,
  sichtbareGruppen,
  eigeneSeiten,
  userName,
  userInitial,
  userMeta,
  onSignOut,
}: Omit<NavBodyProps, "pathname" | "openFlyout" | "onFlyoutToggle" | "onFlyoutClose">) {
  return (
    <>
      {/* Firma wechseln (#504): nur mit anderen Firmen. Als Erstes im Menü, also in der Tab-Reihenfolge gleich nach der Marke */}
      {firmen.length > 0 && <FirmaWechsler andere={firmen} />}
      <Link to={inhaber ? "/" : STEUERBERATUNG_START} className="nav-link" activeOptions={{ exact: true }}>
        <Icon name="overview" />
        Übersicht
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
    </>
  );
}
