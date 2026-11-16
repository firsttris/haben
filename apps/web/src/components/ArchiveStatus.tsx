import type { DeliveryStatus } from "../server/modules/ablage/index.ts";
import { formatDateTime } from "../lib/format.ts";
import { Status } from "./Status.tsx";

/** Zeilen „Festgeschrieben“ und, wenn die Rechnung ins Dokumentenarchiv geht, „Archiv“ in den Eckdaten der Rechnung */
export function LockedAndArchived({ lockedAt, ablage }: { lockedAt: Date | null; ablage: DeliveryStatus | null }) {
  return (
    <>
      <dt>Festgeschrieben</dt>
      <dd>{lockedAt ? formatDateTime(lockedAt) : "–"}</dd>
      {ablage && (
        <>
          <dt>Archiv</dt>
          <dd>
            <ArchiveStatus ablage={ablage} />
          </dd>
        </>
      )}
    </>
  );
}

/** Weitergabe einer festgeschriebenen Rechnung an das Dokumentenarchiv (Einstellungen › Export › Ablage) */
function ArchiveStatus({ ablage }: { ablage: DeliveryStatus }) {
  if (ablage.status === "wartet")
    return (
      <Status tone="info" inline>
        Wird übertragen
      </Status>
    );
  if (ablage.status === "fehler")
    return (
      <span className="stack" style={{ gap: 2, alignItems: "flex-end" }}>
        <Status tone="danger" emphasis="urgent" inline detail={`${ablage.attempts} ${ablage.attempts === 1 ? "Versuch" : "Versuche"}`}>
          Fehlgeschlagen
        </Status>
        {ablage.error && (
          <span className="small muted" style={{ overflowWrap: "anywhere" }}>
            {ablage.error}
          </span>
        )}
      </span>
    );
  return (
    <span className="stack" style={{ gap: 2, alignItems: "flex-end" }}>
      <Status tone="ok" inline detail={`am ${formatDateTime(ablage.deliveredAt)}`}>
        Übertragen
      </Status>
      {ablage.link && (
        <a href={ablage.link} target="_blank" rel="noreferrer">
          Im Archiv öffnen
        </a>
      )}
    </span>
  );
}
