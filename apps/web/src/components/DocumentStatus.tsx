import { formatDayMonth } from "../lib/format.ts";
import { Status } from "./Status.tsx";

export function DocumentStatus({
  status,
  extractionStatus,
  cancelled = false,
  cancelledOn,
  lockedAt,
  uploadedAt,
}: {
  status: "neu" | "gebucht";
  extractionStatus: "keine" | "laeuft" | "fertig" | "fehler";
  /** Gebucht und per Gegenbuchung storniert (#237) */
  cancelled?: boolean;
  /** Für die Auskunft unter dem Status, soweit bekannt */
  cancelledOn?: string | null;
  lockedAt?: string | Date | null;
  uploadedAt?: string | Date | null;
}) {
  if (status === "gebucht" && cancelled)
    return (
      <Status tone="danger" detail={cancelledOn ? `am ${formatDayMonth(cancelledOn)}` : null}>
        Storniert
      </Status>
    );
  if (status === "gebucht")
    return (
      <Status tone="ok" detail={lockedAt ? `am ${formatDayMonth(lockedAt)}` : null}>
        Gebucht
      </Status>
    );
  if (extractionStatus === "laeuft") return <Status tone="info">Wird ausgelesen</Status>;
  // Ohne Auslesung bleibt der Beleg liegen, bis jemand die Angaben von Hand einträgt
  if (extractionStatus === "fehler")
    return (
      <Status tone="warn" emphasis="urgent" detail="Auslesen fehlgeschlagen">
        Prüfen
      </Status>
    );
  return <Status detail={uploadedAt ? `hochgeladen ${formatDayMonth(uploadedAt)}` : null}>Zu prüfen</Status>;
}

export const SOURCE_LABEL = { zugferd: "ZUGFeRD", xrechnung: "XRechnung", ki: "KI", manuell: "Hand" } as const;
