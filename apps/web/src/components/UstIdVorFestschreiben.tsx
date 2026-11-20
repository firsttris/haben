import type { SelfAssessedTax } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ustIdVorBuchenFn, ustIdVorFestschreibenFn } from "../server/functions/ustid-bestaetigung.ts";

type Stand = "laeuft" | { hinweis: string | null } | null;

/** Prüft beim Öffnen der Rückfrage und bei jedem neuen Schlüssel; ohne Schlüssel nichts */
function usePruefung(open: boolean, schluessel: string | null, pruefe: () => Promise<{ hinweis: string | null }>): Stand {
  const [stand, setStand] = useState<Stand>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: nur das Öffnen und der Schlüssel lösen eine Prüfung aus
  useEffect(() => {
    if (!open || !schluessel) {
      setStand(null);
      return;
    }
    let offen = true;
    setStand("laeuft");
    pruefe().then(
      (ergebnis) => offen && setStand(ergebnis),
      () => offen && setStand(null),
    );
    return () => {
      offen = false;
    };
  }, [open, schluessel]);
  return stand;
}

function Hinweis({ stand, wer, trotzdem, contactId }: { stand: Stand; wer: string; trotzdem: string; contactId: string | null }) {
  if (stand === "laeuft") {
    return (
      <p className="small muted" role="status">
        Frage beim BZSt, ob die USt-IdNr. {wer} gültig ist …
      </p>
    );
  }
  if (!stand?.hinweis) return null;
  return (
    <div className="banner banner-warn" role="status">
      <span>
        {stand.hinweis} {trotzdem}
        {contactId ? (
          <>
            ; alle Antworten stehen beim{" "}
            <Link to="/kontakte/$id" params={{ id: contactId }}>
              Kontakt
            </Link>
            .
          </>
        ) : (
          "."
        )}
      </span>
    </div>
  );
}

/**
 * Hinweis in der Rückfrage zum Festschreiben einer Rechnung mit Reverse Charge oder innergemeinschaftlicher Lieferung (#1385).
 * Beim Öffnen fragt der Server das BZSt, wenn die Nummer des Kunden nicht frisch bestätigt ist (bei Reverse Charge mit Name und Ort).
 * Ein Hinweis sperrt das Festschreiben nicht.
 */
export function UstIdVorFestschreiben({ open, contactId, behandlung }: { open: boolean; contactId: string; behandlung: "reverse_charge" | "ig_lieferung" }) {
  const pruefe = useServerFn(ustIdVorFestschreibenFn);
  const stand = usePruefung(open, contactId && `${contactId}:${behandlung}`, () => pruefe({ data: { contactId, behandlung } }));
  return <Hinweis stand={stand} wer="des Kunden" trotzdem="Festschreiben geht trotzdem" contactId={contactId} />;
}

/** Nur beim innergemeinschaftlichen Erwerb und bei § 13b für eine EU-Leistung; Drittland und normale Belege nicht (#1490) */
export const ustIdVorBuchenNoetig = (reverseCharge: SelfAssessedTax | null) => reverseCharge === "ig_erwerb" || reverseCharge === "eu";

/**
 * Hinweis in der Rückfrage zum Buchen eines Belegs (#1490), mit dem Stand im Formular: Ist die USt-IdNr. des Lieferanten
 * nicht frisch bestätigt, fragt der Server das BZSt einfach. Ein Hinweis sperrt das Buchen nicht.
 */
export function UstIdVorBuchen({
  open,
  reverseCharge,
  contactId,
  ustId,
}: {
  open: boolean;
  reverseCharge: SelfAssessedTax | null;
  contactId: string | null;
  ustId: string;
}) {
  const pruefe = useServerFn(ustIdVorBuchenFn);
  const schluessel = ustIdVorBuchenNoetig(reverseCharge) && (contactId || ustId.trim()) ? `${contactId}:${ustId}` : null;
  const stand = usePruefung(open, schluessel, () => pruefe({ data: { contactId, ustId } }));
  return <Hinweis stand={stand} wer="des Lieferanten" trotzdem="Buchen geht trotzdem" contactId={contactId} />;
}
