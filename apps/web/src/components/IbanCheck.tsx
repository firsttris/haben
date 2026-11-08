import { gruppierteIban, type IbanAbgleich, type IbanWahl } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState } from "react";
import { errorMessage, formatDateTime } from "../lib/format.ts";
import { decideDocumentIbanFn } from "../server/functions/sepa.ts";
import { Icon } from "./Icon.tsx";

/**
 * IBAN der E-Rechnung (BT-84) gegen die des Kontakts am Beleg (#410). Weicht sie ab, warnt die Seite mit beiden IBANs;
 * die Inhaberin entscheidet je Beleg, welche gilt, auch nach dem Buchen. Kontakt und Beleg bleiben dabei unverändert.
 */
export function IbanCheck({ documentId, check, canDecide }: { documentId: string; check: IbanAbgleich; canDecide: boolean }) {
  const router = useRouter();
  const decide = useServerFn(decideDocumentIbanFn);
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (check.art === "keine" || check.art === "gleich") return null;
  if (check.art === "ungeprueft") {
    return (
      <div className="banner banner-info" role="note">
        <Icon name="info" />
        <span>
          IBAN aus der E-Rechnung: <span className="mono">{gruppierteIban(check.rechnungsIban)}</span>. Ungeprüft, weil der Kontakt des Lieferanten keine IBAN
          hat.
        </span>
      </div>
    );
  }

  const { kontaktIban, rechnungsIban, entscheidung } = check;
  const onDecide = async (wahl: IbanWahl) => {
    setBusy(true);
    setError(null);
    try {
      await decide({ data: { documentId, decision: { wahl, kontaktIban, rechnungsIban } } });
      await router.invalidate();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`banner${entscheidung ? " banner-info" : ""}`} aria-labelledby={headingId} style={{ flexDirection: "column", gap: 8 }}>
      <h2 id={headingId} style={{ margin: 0, fontSize: 15, display: "flex", gap: 8, alignItems: "center" }}>
        <Icon name="alert" />
        Bankverbindung prüfen
      </h2>
      <p style={{ margin: 0 }}>
        Die E-Rechnung nennt eine andere IBAN als der Kontakt des Lieferanten. Eine ausgetauschte Bankverbindung ist ein bekanntes Muster für Betrug: Prüfe sie
        über einen bekannten Weg beim Lieferanten, nicht über Telefonnummer oder E-Mail aus dieser Rechnung.
      </p>
      <dl className="facts" style={{ maxWidth: 520 }}>
        <dt>IBAN im Kontakt</dt>
        <dd className="mono">{gruppierteIban(kontaktIban)}</dd>
        <dt>IBAN in der E-Rechnung</dt>
        <dd className="mono">{gruppierteIban(rechnungsIban)}</dd>
      </dl>
      {entscheidung ? (
        <p style={{ margin: 0 }} role="status">
          {entscheidung.wahl === "kontakt" ? "Es gilt die IBAN des Kontakts." : "Es gilt die IBAN der E-Rechnung, nur für diesen Beleg."} Entschieden von{" "}
          {entscheidung.von} am {formatDateTime(entscheidung.am)}.
        </p>
      ) : (
        <p style={{ margin: 0 }}>Bis du entscheidest, welche gilt, lässt sich der Beleg unter Überweisungen nicht auswählen.</p>
      )}
      {canDecide && (
        <div className="actions">
          <button type="button" className="btn" disabled={busy || entscheidung?.wahl === "kontakt"} onClick={() => void onDecide("kontakt")}>
            IBAN des Kontakts behalten
          </button>
          <button type="button" className="btn" disabled={busy || entscheidung?.wahl === "e-rechnung"} onClick={() => void onDecide("e-rechnung")}>
            IBAN der E-Rechnung nur für diesen Beleg
          </button>
        </div>
      )}
      {canDecide && (
        <p className="small" style={{ margin: 0 }}>
          Der Kontakt bleibt unverändert; ändert sich eine der beiden IBANs, ist neu zu entscheiden.
        </p>
      )}
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
