import { Status, Tag } from "./Status.tsx";

const FEHLER = (
  <Status tone="danger" emphasis="urgent" inline>
    Fehler
  </Status>
);

/** Zustand einer wiederkehrenden Rechnung, in ihrer Liste und in der Schnellsuche: „inaktiv“ als Merkmal, ein Fehler dringend */
export function RecurringInvoiceStatus({ active, lastError }: { active: boolean; lastError: string | null }) {
  return (
    <span className="status-gruppe">
      {!active && <Tag>inaktiv</Tag>}
      {lastError && FEHLER}
    </span>
  );
}

const DAUERBELEG_MERKMAL = { aktiv: null, pausiert: "pausiert", beendet: "beendet" } as const;

/** Zustand eines Dauerbelegs, in seiner Liste und in der Schnellsuche: pausiert oder beendet als Merkmal, ein Fehler dringend */
export function RecurringDocumentStatus({ status, lastError }: { status: keyof typeof DAUERBELEG_MERKMAL; lastError: string | null }) {
  const merkmal = DAUERBELEG_MERKMAL[status];
  return (
    <span className="status-gruppe">
      {merkmal && <Tag>{merkmal}</Tag>}
      {lastError && FEHLER}
    </span>
  );
}
