import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ustIdVorFestschreibenFn } from "../server/functions/ustid-bestaetigung.ts";

/**
 * Hinweis in der Rückfrage zum Festschreiben einer Rechnung mit Reverse Charge oder innergemeinschaftlicher Lieferung (#1385).
 * Beim Öffnen fragt der Server das BZSt, wenn die letzte Antwort zur Nummer des Kunden nicht gültig oder älter als 30 Tage ist.
 * Ein Hinweis sperrt das Festschreiben nicht.
 */
export function UstIdVorFestschreiben({ open, contactId }: { open: boolean; contactId: string }) {
  const pruefe = useServerFn(ustIdVorFestschreibenFn);
  const [stand, setStand] = useState<"laeuft" | { hinweis: string | null } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: nur das Öffnen und der Kunde lösen eine Prüfung aus
  useEffect(() => {
    if (!open || !contactId) {
      setStand(null);
      return;
    }
    let offen = true;
    setStand("laeuft");
    pruefe({ data: { contactId } }).then(
      (ergebnis) => offen && setStand(ergebnis),
      () => offen && setStand(null),
    );
    return () => {
      offen = false;
    };
  }, [open, contactId]);
  if (stand === "laeuft") {
    return (
      <p className="small muted" role="status">
        Frage beim BZSt, ob die USt-IdNr. des Kunden gültig ist …
      </p>
    );
  }
  if (!stand?.hinweis) return null;
  return (
    <div className="banner banner-warn" role="status">
      <span>
        {stand.hinweis} Festschreiben geht trotzdem; alle Antworten stehen beim{" "}
        <Link to="/kontakte/$id" params={{ id: contactId }}>
          Kontakt
        </Link>
        .
      </span>
    </div>
  );
}
