import { formatEuro } from "@haben/core";
import { useState } from "react";
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
  const [datum, setDatum] = useState(() => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }));
  return (
    <ConfirmDialog
      open
      title={`${aktion}?`}
      confirmLabel={aktion}
      danger
      facts={[
        { label: "Zuordnung", value: ziel.bezeichnung },
        { label: "Betrag", value: formatEuro(Math.abs(ziel.betrag)), strong: true },
      ]}
      onConfirm={() => onConfirm(ziel.id, datum)}
      onClose={onClose}
    >
      <p>
        Haben erzeugt dafür eine Gegenbuchung{ziel.aufteilung ? ", und zwar für alle Teile der Aufteilung" : ""}. Der Umsatz ist danach wieder offen, die
        aufgehobene Zuordnung bleibt sichtbar.
      </p>
      {ziel.mitBeleg && <p>Ein mit dieser Zahlung ausgebuchter Rest wie Skonto wird mit aufgehoben.</p>}
      <Field label="Tag der Aufhebung" hint="die Aufhebung wirkt an diesem Tag, nicht rückwirkend">
        {(control) => <input {...control} type="date" required min={ziel.tag} value={datum} onChange={(event) => setDatum(event.target.value)} />}
      </Field>
    </ConfirmDialog>
  );
}
