import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { findContactsByUstIdFn } from "../server/functions/contacts.ts";
import type { UstIdMatch } from "../server/modules/stammdaten/index.ts";

const PICK_NOTE = "Nimm ihn, statt einen zweiten Kontakt anzulegen.";
const OPEN_NOTE = "Prüfe ihn, statt einen zweiten Kontakt anzulegen.";
const ARCHIVED_NOTE = "Stelle ihn unter Kontakte wieder her, statt einen zweiten Kontakt anzulegen.";
const MISSING_ROLE_NOTE = "Ergänze dort die Rolle, statt einen zweiten Kontakt anzulegen.";

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
  const wantsCustomer = Boolean(wanted?.isCustomer);
  const wantsSupplier = Boolean(wanted?.isSupplier);
  const [found, setFound] = useState<UstIdMatch[]>([]);

  useEffect(() => {
    const value = compact(ustId);
    // Kürzer ist keine USt-IdNr.; erst nach einer Pause im Tippen fragen
    if (value.length < 6) {
      setFound([]);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      lookup({ data: { ustId: value, ...(excludeId ? { excludeId } : {}), isCustomer: wantsCustomer, isSupplier: wantsSupplier } })
        .then((matches) => current && setFound(matches))
        .catch(() => current && setFound([]));
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [ustId, excludeId, wantsCustomer, wantsSupplier, lookup]);

  const covers = (c: UstIdMatch) => (!wanted?.isCustomer || c.isCustomer) && (!wanted?.isSupplier || c.isSupplier);
  // Den Kontakt nennen, den man wählen kann; sonst den ersten (der Server stellt die mit den gewünschten Rollen voran)
  const match = found.find((c) => covers(c) && !c.archived) ?? found[0];
  if (!match) return null;
  const canPick = Boolean(onPickExisting) && covers(match) && !match.archived;
  const note = canPick ? PICK_NOTE : match.archived ? ARCHIVED_NOTE : !covers(match) ? MISSING_ROLE_NOTE : OPEN_NOTE;
  return (
    <div className="banner" role="status" style={{ flexWrap: "wrap", alignItems: "center" }}>
      <span>
        Mit der USt-IdNr. {match.ustId} gibt es schon „{match.name}“ ({rollen(match)}
        {match.archived ? ", archiviert" : ""}). {note}
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
