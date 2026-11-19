import { Link } from "@tanstack/react-router";
import { Icon } from "./Icon.tsx";

/** Hinweis auf Seiten, die an ELSTER senden, solange ERiC fehlt und alles simuliert läuft; der Aufrufer prüft `mode === "simuliert"`; `empfaenger` ist das Amt, an das die Seite sendet */
export function EricHinweis({ empfaenger = "Finanzamt" }: { empfaenger?: string }) {
  return (
    <div className="banner banner-info eric-hinweis" role="status">
      <Icon name="info" />
      <span>
        ERiC ist nicht eingerichtet. Prüfen und Senden laufen simuliert, nichts geht an das {empfaenger}.{" "}
        <Link to="/einstellungen" search={{ bereich: "elster" }}>
          ERiC einrichten
        </Link>
      </span>
    </div>
  );
}
