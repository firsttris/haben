import { useLocation } from "@tanstack/react-router";
import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

/** Die einklappbaren Abschnitte der Firmendaten; der Schlüssel ist zugleich die Anker-ID (`#company-dunning`) */
export const FIRMA_ABSCHNITTE = ["company-register", "company-currency", "company-private", "company-dunning"] as const;
export type FirmaAbschnitt = (typeof FIRMA_ABSCHNITTE)[number];
export type OffeneAbschnitte = Record<FirmaAbschnitt, boolean>;

/** Der Abschnitt, den die Adresse per `#company-…` anspringt, sonst null */
export const abschnittAusAnker = (hash: string): FirmaAbschnitt | null => FIRMA_ABSCHNITTE.find((id) => id === hash) ?? null;

/**
 * Welche Abschnitte der Firmendaten offen stehen. Fehlen einer Gesellschaft Pflichtangaben, steht das Handelsregister offen,
 * damit der Hinweis darin nicht verborgen bleibt. `abschnitt(id)` gibt einem Abschnitt `offen` und `onOffen`.
 */
export function useOffeneAbschnitte(angabenFehlen: boolean) {
  const [offen, setOffen] = useState<OffeneAbschnitte>({
    "company-register": angabenFehlen,
    "company-currency": false,
    "company-private": false,
    "company-dunning": false,
  });
  useAnkerAufklappen(setOffen);
  const abschnitt = (id: FirmaAbschnitt) => ({ offen: offen[id], onOffen: (neu: boolean) => setOffen((aktuell) => ({ ...aktuell, [id]: neu })) });
  return { abschnitt, aufklappen: (ids: FirmaAbschnitt[]) => setOffen((aktuell) => ({ ...aktuell, ...Object.fromEntries(ids.map((id) => [id, true])) })) };
}

/**
 * Klappt den Abschnitt auf, den ein Link per `#company-…` anspringt (Mahnwesen, Handelsregister). Erst nach dem Laden im
 * Browser: Der Server kennt den Anker nicht, ein anderer Anfangszustand stünde der Hydration im Weg.
 */
export function useAnkerAufklappen(setOffen: Dispatch<SetStateAction<OffeneAbschnitte>>) {
  const hash = useLocation({ select: (location) => location.hash });
  useEffect(() => {
    const abschnitt = abschnittAusAnker(hash);
    if (abschnitt) setOffen((offen) => ({ ...offen, [abschnitt]: true }));
  }, [hash, setOffen]);
}

/**
 * Aufklappbarer Abschnitt eines Formulars für Seltenes (#1253). `offen` und `onOffen` hält die Seite selbst, damit sie den
 * Abschnitt aufklappen kann, wenn ein Feld darin einen Fehler hat oder ein Link es anspringt: Ein Fehler im zugeklappten
 * Abschnitt fände weder Fokus noch Auge. Die Felder bleiben auch zugeklappt im Formular und gehen beim Speichern mit. Gesetztes
 * steht als `kurz` in der Überschrift.
 */
export function EinklappAbschnitt({
  id,
  titel,
  kurz,
  offen,
  onOffen,
  children,
}: {
  id: FirmaAbschnitt;
  titel: string;
  kurz?: string;
  offen: boolean;
  onOffen: (offen: boolean) => void;
  children: ReactNode;
}) {
  return (
    <section className="form-section form-section-zu" aria-labelledby={id}>
      <details open={offen} onToggle={(event) => onOffen(event.currentTarget.open)}>
        <summary
          onClick={(event) => {
            // Der Zustand gehört der Seite: Der Browser meldet das Umschalten erst im nächsten Bild, bis dahin hinkte `offen` hinterher
            event.preventDefault();
            onOffen(!offen);
          }}
        >
          <h3 id={id}>{titel}</h3>
          {kurz && <span className="form-section-kurz">{kurz}</span>}
        </summary>
        <div className="form-section-inhalt">{children}</div>
      </details>
    </section>
  );
}
