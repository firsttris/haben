import { Link, useLocation, useRouter } from "@tanstack/react-router";
import type { MouseEvent } from "react";
import type { SettingsArea } from "../lib/settings-areas.ts";
import { Icon } from "./Icon.tsx";

/** Im Verlauf am Eintrag des Bereichs: geöffnet aus der Liste aller Bereiche (/einstellungen ohne ?bereich). Ohne
    eigenen Typ, weil HistoryState in @tanstack/history liegt, das Haben nicht direkt einbindet */
const ausListeMerken = <T extends object>(state: T) => ({ ...state, ausEinstellungsliste: true });

type Area = { id: SettingsArea; label: string; hint: string };

/* Typen der View Transition (styles.css): am Handy schiebt sich der Bereich von rechts über die Liste und beim Zurück
   wieder hinaus. Wischen am Rand geht ohne sie zurück, das animiert der Browser selbst. */
const VOR = { types: ["einstellungen-vor"] };
const ZURUECK = { types: ["einstellungen-zurueck"] };

/**
 * Kopf der Einstellungen. Am Desktop „Einstellungen“; am Handy in einem Bereich dessen Name mit „Einstellungen“ als
 * Zurück darüber, wie in den Einstellungen von iOS und Android. Ein h1, die Fassung fürs Gerät wählt CSS.
 */
export function SettingsHead({ area, uebersicht }: { area: Area; uebersicht: boolean }) {
  const router = useRouter();
  const ausListe = useLocation({ select: (l) => (l.state as { ausEinstellungsliste?: boolean }).ausEinstellungsliste === true });
  // Aus der Liste geöffnet: Zurück geht im Verlauf zurück, sonst stünde die Liste danach zweimal darin und Wischen
  // nach rechts führte wieder in den Bereich
  const zurueck = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!ausListe || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    router.shouldViewTransition = ZURUECK;
    router.history.back();
  };
  return (
    <div className="page-head settings-head" data-uebersicht={uebersicht || undefined}>
      <div>
        <div className="eyebrow">Haben</div>
        <Link to="/einstellungen" search={{}} className="settings-back" viewTransition={ZURUECK} onClick={zurueck}>
          <Icon name="chevron-left" size={20} />
          Einstellungen
        </Link>
        <h1>
          <span className="settings-title">Einstellungen</span>
          <span className="settings-title-area">{area.label}</span>
        </h1>
      </div>
    </div>
  );
}

/** Bereiche: am Desktop links neben dem Inhalt, am Handy als eigene Seite unter /einstellungen */
export function SettingsNav({ areas, current, uebersicht }: { areas: Area[]; current: SettingsArea; uebersicht: boolean }) {
  return (
    <nav className="settings-nav" aria-label="Bereiche der Einstellungen">
      {areas.map((a) => (
        <Link
          key={a.id}
          to="/einstellungen"
          search={{ bereich: a.id }}
          state={uebersicht ? ausListeMerken : undefined}
          viewTransition={uebersicht ? VOR : undefined}
          className="settings-nav-link"
          // Ohne ?bereich ist am Handy nur die Liste offen, kein Bereich; am Desktop steht daneben die Firma, die
          // data-standard nur hervorhebt (styles.css)
          aria-current={!uebersicht && a.id === current ? "page" : undefined}
          data-standard={(uebersicht && a.id === current) || undefined}
        >
          <span className="settings-nav-label">{a.label}</span>
          <span className="settings-nav-hint">{a.hint}</span>
          <Icon name="chevron-right" size={18} />
        </Link>
      ))}
    </nav>
  );
}
