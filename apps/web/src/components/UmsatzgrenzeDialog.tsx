import { formatEuro, VORJAHRESGRENZE } from "@haben/core";
import type { ReactNode } from "react";
import type { UmsatzgrenzeBestaetigung } from "../lib/kleinunternehmer.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

const ACTION = {
  festschreiben: { verb: "festschreiben", noun: "Festschreiben" },
  übernehmen: { verb: "übernehmen", noun: "Übernehmen" },
} as const;

/**
 * Rückfrage, wenn eine Rechnung eines Kleinunternehmers die Umsatzgrenze überschreiten könnte oder der Vorjahresumsatz sie
 * schon überschritt: beim Festschreiben einer eigenen Rechnung und beim Übernehmen einer aus einem Fremdsystem.
 */
export function UmsatzgrenzeDialog({
  warnung,
  action,
  onClose,
  onConfirm,
  children,
}: {
  warnung: UmsatzgrenzeBestaetigung;
  action: keyof typeof ACTION;
  onClose: () => void;
  onConfirm: () => void;
  /** Was bei Abbruch geschieht */
  children?: ReactNode;
}) {
  const { verb, noun } = ACTION[action];
  return (
    <ConfirmDialog
      open
      title={
        warnung.vorjahresumsatz === undefined
          ? `Rechnung trotz möglicher Überschreitung der Umsatzgrenze ${verb}?`
          : "Kleinunternehmerregelung wegen Vorjahresumsatz prüfen"
      }
      confirmLabel={`Trotzdem ${verb}`}
      facts={[
        ...(warnung.vorjahresumsatz === undefined
          ? [
              { label: "Dieses Jahr laut Buchungen vereinnahmt", value: formatEuro(warnung.umsatz) },
              { label: "Bei vollständiger Zahlung in diesem Jahr", value: formatEuro(warnung.umsatz + warnung.rechnung), strong: true },
            ]
          : [{ label: "Im Vorjahr laut Buchungen vereinnahmt", value: formatEuro(warnung.vorjahresumsatz), strong: true }]),
      ]}
      onClose={onClose}
      onConfirm={onConfirm}
    >
      {warnung.umsatz + warnung.rechnung > warnung.grenze && (
        <p>
          Bei vollständiger Zahlung in diesem Jahr könnte die Grenze von {formatEuro(warnung.grenze)} überschritten werden. Ab dem Umsatz, der die Grenze
          überschreitet, entfällt die Befreiung.
        </p>
      )}
      {warnung.vorjahresumsatz !== undefined && (
        <p>Lag dein Gesamtumsatz im Vorjahr über {formatEuro(VORJAHRESGRENZE)}, entfällt die Kleinunternehmerregelung ab dem 1. Januar des laufenden Jahres.</p>
      )}
      <p>Prüfe vor dem {noun}, ob du Umsatzsteuer ausweisen musst. Als normale Rechnung erfasste Anlagenverkäufe können im Betrag enthalten sein.</p>
      {children}
    </ConfirmDialog>
  );
}
