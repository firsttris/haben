import { formatEuro } from "@haben/core";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Field } from "./Field.tsx";

/** Was die Rückfrage über die Zuordnung wissen muss */
export type AufzuhebendeZuordnung = {
  id: string;
  /** „Rechnung 2026-001“ oder bei einer Aufteilung die Zahl der Teile */
  bezeichnung: string;
  /** Bei einer Aufteilung die Summe aller Teile, in Cents */
  betrag: number;
  aufteilung: boolean;
  /** Nur an einer Rechnung oder einem Beleg kann ein mit der Zahlung ausgebuchter Rest hängen */
  mitBeleg: boolean;
  /** Buchungsdatum des Umsatzes (YYYY-MM-DD): früher kann die Aufhebung nicht wirken */
  tag: string;
};

/** Rückfrage vor dem Aufheben im Bankabgleich (#404): Die Gegenbuchungen bleiben in den Büchern stehen */
export function ZuordnungAufheben({
  ziel,
  onConfirm,
  onClose,
}: {
  ziel: AufzuhebendeZuordnung | null;
  onConfirm: (id: string, date: string) => void;
  onClose: () => void;
}) {
  if (!ziel) return null;
  // Eigener Abschnitt, damit das Datum mit dem Dialog entsteht und wieder verschwindet
  return <AufhebenDialog ziel={ziel} onConfirm={onConfirm} onClose={onClose} />;
}

function AufhebenDialog({ ziel, onConfirm, onClose }: { ziel: AufzuhebendeZuordnung; onConfirm: (id: string, date: string) => void; onClose: () => void }) {
  const aktion = ziel.aufteilung ? "Aufteilung aufheben" : "Zuordnung aufheben";
  // Eine Aufhebung wirkt an dem Tag, an dem sie erklärt wird, nicht am Buchungsdatum des Umsatzes (#782)
  const [heute] = useState(() => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }));
  const [datum, setDatum] = useState(heute);
  const [fehler, setFehler] = useState<string | null>(null);
  // ConfirmDialog hat kein <form> und ruft onClose vor onConfirm; deshalb prüft der Dialog das Datum selbst, statt sich
  // auf required/min zu verlassen. Schließt er wirklich, gibt er die Rückfrage frei; bei einem Verstoß bleibt er offen.
  const [offen, setOffen] = useState(true);
  useEffect(() => {
    if (!offen) onClose();
  }, [offen, onClose]);

  /** Was am gewählten Tag nicht geht; null heißt in Ordnung. Dieselben Grenzen prüft der Server. */
  function problem(tag: string): string | null {
    if (!tag) return "Bitte den Tag der Aufhebung angeben.";
    if (tag > heute) return "Der Tag der Aufhebung liegt in der Zukunft.";
    if (tag < ziel.tag) {
      return `Das Datum liegt vor dem Buchungsdatum der Zahlung (${ziel.tag}). Eine Aufhebung wirkt an dem Tag, an dem sie erklärt wird.`;
    }
    return null;
  }

  return (
    <ConfirmDialog
      open={offen}
      title={`${aktion}?`}
      confirmLabel={aktion}
      danger
      facts={[
        { label: "Zuordnung", value: ziel.bezeichnung },
        { label: "Betrag", value: formatEuro(Math.abs(ziel.betrag)), strong: true },
      ]}
      onConfirm={() => {
        const meldung = problem(datum);
        // ConfirmDialog ruft onClose vor onConfirm; der Fehler öffnet den Dialog deshalb wieder
        if (meldung) {
          setFehler(meldung);
          setOffen(true);
          return;
        }
        onConfirm(ziel.id, datum);
      }}
      onClose={() => setOffen(false)}
    >
      <p>
        Haben erzeugt dafür eine Gegenbuchung{ziel.aufteilung ? ", und zwar für alle Teile der Aufteilung" : ""}. Der Umsatz ist danach wieder offen, die
        aufgehobene Zuordnung bleibt sichtbar.
      </p>
      {ziel.mitBeleg && <p>Ein mit dieser Zahlung ausgebuchter Rest wie Skonto wird mit aufgehoben.</p>}
      <Field label="Tag der Aufhebung" hint="die Aufhebung wirkt an diesem Tag, nicht rückwirkend" error={fehler} announceError>
        {(control) => (
          <input
            {...control}
            type="date"
            // Nur eine Hilfe für den Datumswähler; geprüft wird oben, weil die Attribute ohne <form> nicht greifen
            min={ziel.tag}
            max={heute}
            value={datum}
            onChange={(event) => {
              setDatum(event.target.value);
              setFehler(null);
            }}
          />
        )}
      </Field>
    </ConfirmDialog>
  );
}
