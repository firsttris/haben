import { formatEuro } from "@haben/core";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

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
};

/** Rückfrage vor dem Aufheben im Bankabgleich (#404): Die Gegenbuchungen bleiben in den Büchern stehen */
export function ZuordnungAufheben({ ziel, onConfirm, onClose }: { ziel: AufzuhebendeZuordnung | null; onConfirm: (id: string) => void; onClose: () => void }) {
  if (!ziel) return null;
  const aktion = ziel.aufteilung ? "Aufteilung aufheben" : "Zuordnung aufheben";
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
      onConfirm={() => onConfirm(ziel.id)}
      onClose={onClose}
    >
      <p>
        Haben erzeugt dafür eine Gegenbuchung{ziel.aufteilung ? ", und zwar für alle Teile der Aufteilung" : ""}. Der Umsatz ist danach wieder offen, die
        aufgehobene Zuordnung bleibt sichtbar.
      </p>
      {ziel.mitBeleg && <p>Ein mit dieser Zahlung ausgebuchter Rest wie Skonto wird mit aufgehoben.</p>}
    </ConfirmDialog>
  );
}
