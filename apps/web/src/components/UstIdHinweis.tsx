import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { findContactsByUstIdFn } from "../server/functions/contacts.ts";
import type { UstIdMatch } from "../server/modules/stammdaten/index.ts";

const compact = (value: string) => value.replace(/\s/g, "").toUpperCase();

/** Rollen eines Kontakts, wie sie im Hinweis stehen */
const rollen = (c: UstIdMatch) => [c.isCustomer ? "Kunde" : "", c.isSupplier ? "Lieferant" : ""].filter(Boolean).join(", ");

/**
 * Hinweis unter dem Kontaktformular: Gibt es die USt-IdNr. schon bei einem Kontakt, gleich welcher Rolle? Der Server
 * prüft nach dem Tippen über alle Kontakte, auch die archivierten. Ein Kontakt wird nie still zusammengeführt:
 * Hat der vorhandene alle Rollen, die der neue haben soll (wanted), und gibt es onPickExisting, kann man ihn wählen.
 * Fehlt ihm eine Rolle, bleibt nur der Hinweis mit Link: Wer einen Kunden als Lieferanten braucht, ergänzt die Rolle dort.
 */
export function UstIdHinweis({
  ustId,
  excludeId,
  wanted,
  onPickExisting,
}: {
  ustId: string;
  /** Der Kontakt, den das Formular gerade ändert */
  excludeId?: string;
  /** Rollen des neuen Kontakts, soweit schon bekannt (Dialog an einem Beleg oder Entwurf) */
  wanted?: { isCustomer?: boolean; isSupplier?: boolean };
  onPickExisting?: (id: string) => void;
}) {
  const lookup = useServerFn(findContactsByUstIdFn);
  const [match, setMatch] = useState<UstIdMatch | null>(null);

  useEffect(() => {
    const value = compact(ustId);
    // Kürzer ist keine USt-IdNr.; erst nach einer Pause im Tippen fragen
    if (value.length < 6) {
      setMatch(null);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      lookup({ data: { ustId: value, ...(excludeId ? { excludeId } : {}) } })
        .then((found) => current && setMatch(found[0] ?? null))
        .catch(() => current && setMatch(null));
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [ustId, excludeId, lookup]);

  if (!match) return null;
  const covers = (!wanted?.isCustomer || match.isCustomer) && (!wanted?.isSupplier || match.isSupplier);
  const canPick = Boolean(onPickExisting) && covers && !match.archived;
  return (
    <div className="banner" role="status" style={{ flexWrap: "wrap", alignItems: "center" }}>
      <span>
        Mit der USt-IdNr. {match.ustId} gibt es schon „{match.name}“ ({rollen(match)}
        {match.archived ? ", archiviert" : ""}).{" "}
        {canPick ? "Nimm ihn, statt einen zweiten Kontakt anzulegen." : "Ergänze dort die Rolle, statt einen zweiten Kontakt anzulegen."}
      </span>
      {canPick ? (
        <button type="button" className="btn" onClick={() => onPickExisting?.(match.id)}>
          „{match.name}“ wählen
        </button>
      ) : (
        <Link to="/kontakte/$id" params={{ id: match.id }} target="_blank" rel="noopener" className="btn">
          „{match.name}“ öffnen
        </Link>
      )}
    </div>
  );
}
